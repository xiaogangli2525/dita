"""Local browser frontend for the existing offline HTML reader."""
import base64
from concurrent.futures import CancelledError, ThreadPoolExecutor
from functools import lru_cache
import gzip
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import re
from threading import Lock

from .book import MAX_ARCHIVE, flatten, read_book
from .search import Search


def serve(path):
    if not path.is_dir() and path.suffix.lower() == ".zip":
        raise ValueError("请先解压知识库，再用 --kb 指向 docs 目录")
    directory = path if path.is_dir() else path.parent
    docs = (directory / "docs" if (directory / "docs/index.html").is_file() else directory).resolve()
    html, book = (read_book(docs / name) for name in ("index.html", "knowledge.json"))

    def identity(value):
        return (value["model"], value["sdkVersion"],
                [(row["manualId"], row["anchor"], row["title"], row["text"]) for row in flatten(value)])

    if identity(html) != identity(book):
        raise ValueError("阅读页与知识库正文版本不一致，请重新解压同一份包")
    bodies = {manual["id"]: manual.pop("body").encode("utf-8") for manual in html["manuals"]}
    manuals = {manual["id"] for manual in book["manuals"]}
    pending_lock = Lock()
    pending = None
    search = None

    def initialize():
        nonlocal search
        search = Search([book])
        if not all(search.compatible):
            raise ValueError("请使用附带兼容语义索引的知识库")
        return search.rules.call("page", html).encode("utf-8")

    def warm():
        try:
            search.warm()
            print("本机语义模型已就绪。", flush=True)
        except (ValueError, ImportError, OSError) as error:
            print(f"语义预热未完成，查询时可重试。{error}", flush=True)

    @lru_cache(maxsize=32)
    def resource(key):
        body = page if key == "index" else bodies[key]
        return body, gzip.compress(body, compresslevel=5, mtime=0), 'W/"' + hashlib.sha256(body).hexdigest() + '"'

    def query_in_worker(payload):
        mode, hits = search.search(payload["query"], "auto", dict(
            manualId=payload.get("manualId", ""), module=payload.get("module", ""),
            mode=payload.get("mode", ""), limit=40))
        return {"hits": hits, "searchMode": mode}

    class Handler(BaseHTTPRequestHandler):
        timeout = 10

        def log_message(self, _format, *_args):
            pass

        def respond(self, status, content, media="application/json", **headers):
            body = content if isinstance(content, bytes) else json.dumps(content).encode("utf-8")
            try:
                self.send_response(status)
                self.send_header("Content-Type", media)
                if status != 304:
                    self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Cross-Origin-Resource-Policy", "same-origin")
                self.send_header("X-Frame-Options", "DENY")
                for key, value in headers.items():
                    self.send_header(key.replace("_", "-"), value)
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def send_resource(self, key, **headers):
            body, compressed, tag = resource(key)
            headers.update(ETag=tag, Cache_Control="private, no-cache", Vary="Accept-Encoding")
            tags = [value.strip() for value in self.headers.get("If-None-Match", "").split(",")]
            if tag in tags or "*" in tags:
                self.respond(304, b"", **headers)
                return
            for encoding in self.headers.get("Accept-Encoding", "").split(","):
                name, _, quality = encoding.strip().partition(";")
                if name.lower() != "gzip":
                    continue
                try:
                    accepted = not quality or float(quality.strip().removeprefix("q=")) > 0
                except ValueError:
                    accepted = False
                if accepted:
                    body = compressed
                    headers["Content_Encoding"] = "gzip"
            self.respond(200, body, "text/html; charset=utf-8", **headers)

        def local_host(self):
            if self.headers.get("Host") == authority:
                return True
            self.respond(403, {"error": "仅支持本机阅读地址"})
            return False

        def do_GET(self):
            if not self.local_host():
                return
            if self.path in ("/", "/index.html"):
                self.send_resource("index", Content_Security_Policy=csp)
                return
            match = re.fullmatch(r"/content/(m-[a-f0-9]{12,64})\.html", self.path)
            if match and match[1] in bodies:
                self.send_resource(match[1], Content_Security_Policy="default-src 'none'; frame-ancestors 'none'")
                return
            match = re.fullmatch(r"/manuals/(m-[a-f0-9]{12,64})\.html", self.path)
            if match and match[1] in manuals:
                file = docs / self.path.lstrip("/")
                if file.is_file() and file.resolve() == file and file.stat().st_size <= MAX_ARCHIVE:
                    self.respond(200, file.read_bytes(), "text/html; charset=utf-8",
                                 Content_Disposition=f'attachment; filename="{file.name}"')
                    return
            self.respond(404, {"error": "未找到页面"})

        def do_POST(self):
            nonlocal pending
            if not self.local_host():
                return
            if self.path != "/search":
                self.respond(404, {"error": "未找到页面"})
                return
            if self.headers.get("Origin") != url or self.headers.get("Content-Type") != "application/json":
                self.respond(403, {"error": "请求必须来自本机阅读页"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise ValueError()
                data = json.loads(self.rfile.read(length))
                query = data["query"]
                if not isinstance(query, str) or not query.strip() or len(query) > 200:
                    raise ValueError()
                scopes = [data.get(key, "") for key in ("manualId", "module", "mode")]
                if not all(isinstance(value, str) and len(value) <= 160 for value in scopes):
                    raise ValueError()
                if scopes[0] and scopes[0] not in manuals:
                    raise ValueError()
            except (ValueError, TypeError, KeyError, OSError):
                self.respond(400, {"error": "搜索条件无效"})
                return
            # One active inference and one replaceable pending query. All QuickJS
            # calls stay on the same worker that created the context.
            with pending_lock:
                if pending is not None:
                    pending.cancel()
                future = worker.submit(query_in_worker, data)
                pending = future
            try:
                self.respond(200, future.result())
            except CancelledError:
                self.respond(200, {"superseded": True})
            except (ValueError, ImportError, OSError) as error:
                self.respond(500, {"error": str(error)})
            finally:
                with pending_lock:
                    if pending is future:
                        pending = None

    with ThreadPoolExecutor(max_workers=1) as worker, ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        page = worker.submit(initialize).result()
        script = page.rsplit(b"<script>", 1)[1].rsplit(b"</script>", 1)[0].replace(b"\r\n", b"\n").replace(b"\r", b"\n")
        csp = "script-src 'sha256-" + base64.b64encode(hashlib.sha256(script).digest()).decode() + "'; frame-ancestors 'none'"
        authority = f"127.0.0.1:{server.server_port}"
        url = f"http://{authority}"
        print(f"打开本机离线阅读页 {url}\n按 Ctrl+C 退出。", flush=True)
        worker.submit(warm)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass

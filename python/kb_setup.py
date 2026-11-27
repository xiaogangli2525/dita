"""Windows package setup. The bootstrap portion uses only the standard library."""
from contextlib import ExitStack
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from tempfile import NamedTemporaryFile, TemporaryDirectory
import time
from urllib.request import ProxyHandler, Request, build_opener
from zipfile import ZipFile

from blink_kb.model_files import FILES, MODEL, manifest, matches

DLL_HELP = ("请确认使用 Windows x64 运行包；如提示 DLL 加载失败，请由 IT 安装或修复 "
            "Microsoft Visual C++ v14 x64 运行库，然后重试。官方下载：https://aka.ms/vc14/vc_redist.x64.exe")


def install_dependencies(root):
    # The complete editions already include their pinned native dependencies.
    if (root / "_vendor").is_dir() or Path(sys.executable).resolve() == portable_python(root).resolve():
        return
    env = root / ".venv"
    python = env / "Scripts/python.exe"
    if not python.is_file():
        subprocess.run([sys.executable, "-I", "-m", "venv", str(env)], check=True)
    command = [str(python), "-I", "-m", "pip", "--disable-pip-version-check", "install",
               "--only-binary=:all:", "--require-hashes", "-r", str(root / "requirements-kb-win.lock")]
    wheels = root / "wheelhouse"
    if wheels.is_dir():
        command.extend(["--no-index", "--find-links", str(wheels)])
    print("正在检查专用 Python 环境中的检索依赖…", flush=True)
    subprocess.run(command, check=True)
    subprocess.run([str(python), "-I", "-m", "pip", "check"], check=True)


def portable_python(root):
    return root.parent / "blink-kb-runtime/python/python.exe"


def model_source(root, destination):
    setting = os.environ.get("BLINK_MODEL_PACKAGE")
    if setting:
        return Path(setting).expanduser().resolve()
    for folder in (root.parent / "blink-kb-runtime", root.parent / "blink-kb-model"):
        if (folder / "models" / MODEL).is_dir():
            return folder
    default_zip = root.parent / "Blink-KB-Models-bge-small-zh-v1.5.zip"
    if default_zip.is_file():
        return default_zip
    if (root / "models").resolve() != destination and (root / "models" / MODEL).is_dir():
        return root
    raise ValueError("找不到模型来源。请在 blink-kb 同级解压完整运行包，或将 BLINK_MODEL_PACKAGE "
                     "指向原始模型 ZIP，再运行 install-deps.cmd。")


def install_model(root, destination):
    assets = manifest(root / "blink_kb/_rules/semantic-model-assets.json")
    # Resolve the chosen base once; disallow redirected descendants in the managed model tree.
    base = destination.resolve()
    def target(name):
        intended = base / MODEL / name
        if intended.resolve() != intended:
            raise ValueError(f"模型子目录包含重定向，请检查：{intended}")
        return intended

    missing = [name for name in FILES if not matches(target(name), assets[name])]
    if not missing:
        print("模型文件校验通过。")
        return
    source = model_source(root, base)
    print(f"正在从 {source} 修复 {len(missing)} 个模型文件。", flush=True)
    with ExitStack() as stack:
        if source.is_file():
            archive = stack.enter_context(ZipFile(source))
            suffix = "models/" + MODEL.as_posix() + "/"
            def open_asset(name):
                items = [i for i in archive.infolist() if i.filename == suffix + name
                         or i.filename.endswith("/" + suffix + name)]
                if len(items) != 1 or not 0 < items[0].file_size <= 64 * 1024 * 1024:
                    raise ValueError(f"模型 ZIP 中文件缺失、重复或大小无效：{name}")
                return archive.open(items[0])
        else:
            def open_asset(name):
                return (source / "models" / MODEL / name).open("rb")
        staged = []
        for name in missing:
            file = target(name)
            file.parent.mkdir(parents=True, exist_ok=True)
            with open_asset(name) as src, NamedTemporaryFile(dir=file.parent, delete=False) as tmp:
                temp = Path(tmp.name)
                stack.callback(temp.unlink, missing_ok=True)
                shutil.copyfileobj(src, tmp)
            if not matches(temp, assets[name]):
                raise ValueError(f"模型来源文件校验失败：{name}。请重新获取模型包。")
            staged.append((temp, name))
        for temp, name in staged:
            os.replace(temp, target(name))


def probe_reader(root, docs, query, expected):
    # Start exactly the reader shipped in the package and never use a system HTTP proxy for loopback.
    http = build_opener(ProxyHandler({}))
    with TemporaryDirectory() as folder, (Path(folder) / "reader.log").open("wb") as log:
        process = subprocess.Popen([sys.executable, "-I", "-X", "utf8", "-u", str(root / "launch-kb.py"),
                                    "--serve", "--kb", str(docs)], stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                # Open the log by a separate handle instead of moving the child's write position.
                if process.poll() is not None:
                    break
                output = Path(log.name).read_bytes()
                address = re.search(rb"http://127\.0\.0\.1:\d+", output)
                if address:
                    break
                time.sleep(0.1)
            else:
                raise ValueError("本机阅读服务启动超时")
            if process.poll() is not None:
                raise ValueError("本机阅读服务启动失败：" + Path(log.name).read_bytes().decode("utf-8", "replace")[-1000:])
            url = address[0].decode()
            payload = json.dumps({"query": query}).encode()
            req = Request(url + "/search", data=payload, headers={"Origin": url, "Content-Type": "application/json"})
            with http.open(req, timeout=90) as response:
                answer = json.load(response)
            hits = answer.get("hits")
            if answer.get("searchMode") != "hybrid" or not isinstance(hits, list):
                raise ValueError("本机阅读页没有返回混合检索结果")
            if expected is not None and not any(hit["position"] == expected for hit in hits[:3]):
                raise ValueError(f"本机阅读页未命中预期章节。查询：{query}")
        finally:
            if process.poll() is None:
                process.terminate()
            process.wait(timeout=10)


def check(root, dest):
    from blink_kb.book import flatten, read_book
    from blink_kb.search import Search

    docs = (root / "docs").resolve()
    configured = Path(os.environ["BLINK_KB"]).resolve()
    if configured not in (docs, docs / "knowledge.json", docs / "index.html", root):
        raise ValueError(f"BLINK_KB 当前指向 {configured}。请清除该变量，再验证本包 {docs}。")
    book = read_book(docs / "knowledge.json")
    rows = flatten(book)
    print(f"正在验证 {book['model']} · {len(book['manuals'])} 本手册 · {len(rows)} 章", flush=True)
    search = Search([book], dest)
    # The UART acceptance query applies only to an edition that actually publishes that resource table.
    expected = next((i for i, row in enumerate(rows) if "MR380R" in book["model"].upper()
                     and row["title"].strip() == "外设资源" and "UART" in row["text"].upper()), None)
    if expected is not None:
        query = "支持多少串口"
    else:
        query = next((row["title"].strip() for row in rows if 2 <= len(row["title"].strip()) <= 60
                      and not search.rules.call("constraints", row["title"])["requiresLexical"]), "使用说明")
    mode, hits = search.search(query, "semantic", dict(manualId="", module="", mode="", limit=3))
    if mode != "semantic":
        raise ValueError("验证查询未执行向量推理")
    if expected is not None and not any(hit["position"] == expected and "UART" in hit["excerpt"].upper()
                                        for hit in hits):
        raise ValueError(f"向量检索未命中《外设资源》的 UART 片段。查询：{query}")
    print(f"向量推理通过。查询「{query}」" + ("命中《外设资源》。" if expected is not None else "。"), flush=True)
    if (docs / "index.html").is_file():
        probe_reader(root, docs, query, expected)
        print("本机阅读页 /search 混合检索验证通过。")


def setup(root, dest):
    print(f"Python：{sys.executable}\n本次使用的模型目录：{dest}", flush=True)
    install_dependencies(root)
    python = root / ".venv/Scripts/python.exe"
    if not (root / "_vendor").is_dir() and not portable_python(root).is_file() and python.is_file():
        if Path(sys.executable).resolve() != python.resolve():
            return subprocess.call([str(python), "-I", "-X", "utf8", str(root / "launch-kb.py"), "--verify-install"])
    verify(root, dest)
    return 0


def verify(root, dest):
    try:
        import numpy
        import onnxruntime
        import quickjs
        import tokenizers
    except (ImportError, OSError) as error:
        raise ValueError(f"检索依赖未能加载：{error}。{DLL_HELP}") from error
    install_model(root, dest)
    check(root, dest)
    print("安装验证完成，可以运行 blink-kb.cmd 或 blink-reader.cmd。")

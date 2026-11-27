"""Python-only command tests. Run with PYTHONPATH=python."""
import json
import gzip
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest
from urllib.request import Request, urlopen
from zipfile import ZipFile

from blink_kb.__main__ import get_args, run
from blink_kb.book import parse_html, read_book


class OfflineKB(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "中文 offline.zip"
        book = {"title": "SDK", "model": "SAMPLE", "sdkVersion": "v1", "schema": 1,
                "manuals": [{"id": "m-a", "title": "开发指南", "source": {"commit": "example"},
                             "entries": [{"anchor": "a", "title": "AT+MHTTPCFG 参数",
                                          "text": "配置请求。错误码 -17。"},
                                         {"anchor": "b", "title": "外设资源", "text": "UART 最大组数：4。"}]}]}
        with ZipFile(self.path, "w") as archive:
            archive.writestr("docs/knowledge.json", json.dumps(book))

    def command(self, *args):
        return run(get_args(["--kb", str(self.path), *args]))

    def test_queries_and_where_to_read_the_original(self):
        for query in ("AT+MHTTPCFG", "-17", "错误码-17"):
            with self.subTest(query=query):
                result = self.command(query, "--search", "semantic")
                self.assertEqual(result["searchMode"], "lexical")
                self.assertEqual(result["results"][0]["id"], "m-a#a")
        self.assertEqual(self.command("错误码 9999")["results"], [])
        self.assertEqual(self.command("串口")["results"][0]["title"], "外设资源")
        self.assertEqual(self.command("UART", "--manual", "开发指南")["results"][0]["id"], "m-a#b")
        self.assertEqual(self.command("--info")["chapterCount"], 2)
        self.assertEqual(self.command("--list")["manuals"][0]["id"], "m-a")
        reading = self.command("--get", "m-a#a")
        self.assertIn("错误码 -17", reading["text"])
        self.assertEqual(reading["source"]["commit"], "example")

    def test_repeated_archive_members_are_rejected(self):
        with ZipFile(self.path, "a") as archive:
            with self.assertWarns(UserWarning):
                archive.writestr("docs/knowledge.json", "{}")
        with self.assertRaisesRegex(ValueError, "重复"):
            read_book(self.path)

    def test_duplicate_merge_rejected(self):
        with self.assertRaisesRegex(ValueError, "重复手册"):
            self.command("UART", "--merge", str(self.path))

    def test_old_and_new_html_data_formats(self):
        value = {"title": "</script> 中文", "schema": 1}
        data = json.dumps(value).replace("<", "\\u003c")
        for page in ('<script>(function(){})(' + data + ',{});</script>',
                     '<script type="application/json" id="kbData">' + data + '</script>'):
            self.assertEqual(parse_html(page), value)

    @unittest.skipUnless(os.environ.get("BLINK_TEST_KB"), "requires a generated semantic fixture")
    def test_local_reader_lazy_cache_and_latest_query(self):
        program = '''
import time
from pathlib import Path
from blink_kb.search import Search
from blink_kb.reader import serve
original = Search.search
def delayed(self, *args):
    time.sleep(0.25)
    return original(self, *args)
Search.search = delayed
import os
serve(Path(os.environ["BLINK_TEST_KB"]))
'''
        env = dict(os.environ, PYTHONPATH=str(Path(__file__).parent) + os.pathsep + os.environ.get("PYTHONPATH", ""))
        process = subprocess.Popen([sys.executable, "-u", "-c", program], env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, encoding="utf-8")
        try:
            line = process.stdout.readline()
            match = re.search(r"http://127\.0\.0\.1:\d+", line)
            self.assertIsNotNone(match, line)
            url = match[0]
            with urlopen(Request(url, headers={"Accept-Encoding": "gzip"}), timeout=30) as response:
                self.assertEqual(response.headers["Content-Encoding"], "gzip")
                page = gzip.decompress(response.read()).decode()
                etag = response.headers["ETag"]
            data = parse_html(page)
            self.assertTrue(all("body" not in manual for manual in data["manuals"]))
            from urllib.error import HTTPError
            with self.assertRaises(HTTPError) as unchanged:
                urlopen(Request(url, headers={"If-None-Match": etag}), timeout=30)
            self.assertEqual(unchanged.exception.code, 304)
            with urlopen(url + "/content/" + data["manuals"][0]["id"] + ".html", timeout=30) as response:
                self.assertGreater(len(response.read()), 10)
            query = os.environ.get("BLINK_TEST_QUERY", "日志抓取方法")
            def post(_):
                request = Request(url + "/search", data=json.dumps({"query": query}).encode(),
                                  headers={"Origin": url, "Content-Type": "application/json"})
                with urlopen(request, timeout=60) as response:
                    return json.load(response)
            with ThreadPoolExecutor(max_workers=6) as clients:
                results = list(clients.map(post, range(6)))
            self.assertTrue(any(result.get("superseded") for result in results))
            self.assertTrue(any(result.get("hits") for result in results))
            self.assertTrue(post(0)["hits"])
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            process.stdout.close()
            process.stderr.close()

    @unittest.skipUnless(os.environ.get("BLINK_TEST_KB"), "requires a generated semantic fixture")
    def test_shared_index_and_vector_model(self):
        args = ["--kb", os.environ["BLINK_TEST_KB"]]
        query = os.environ.get("BLINK_TEST_QUERY", "日志抓取方法")
        title = os.environ.get("BLINK_TEST_TITLE", query)
        for mode in ("semantic", "hybrid"):
            with self.subTest(mode=mode):
                result = run(get_args([*args, query, "--search", mode]))
                self.assertEqual(result["searchMode"], mode)
                self.assertEqual(result["results"][0]["title"], title)
                if mode == "semantic":
                    self.assertIn("semanticScore", result["results"][0])
                if block := result["results"][0].get("chunk", {}).get("blockId"):
                    reading = run(get_args([*args, "--get", result["results"][0]["id"], "--block", block]))
                    self.assertEqual(reading["block"]["id"], block)


if __name__ == "__main__":
    unittest.main()

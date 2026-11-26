"""Python-only command tests. Run with PYTHONPATH=python."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from blink_kb.__main__ import get_args, run
from blink_kb.book import read_book


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
                self.assertIn("semanticScore", result["results"][0])
                if block := result["results"][0].get("chunk", {}).get("blockId"):
                    reading = run(get_args([*args, "--get", result["results"][0]["id"], "--block", block]))
                    self.assertEqual(reading["block"]["id"], block)


if __name__ == "__main__":
    unittest.main()

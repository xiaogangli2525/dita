"""Read the existing DITA publication formats. Only read known ZIP members."""
import json
import os
from pathlib import Path
from zipfile import ZipFile

MAX_ARCHIVE = 64 * 1024 * 1024
MAX_DATA = 128 * 1024 * 1024
MEMBERS = ("docs/knowledge.json", "knowledge.json", "docs/index.html", "index.html")


def limited_read(stream, limit):
    data = stream.read(limit + 1)
    if len(data) > limit:
        raise ValueError("知识库文件超过离线读取容量上限")
    return data.decode("utf-8-sig")


def parse_html(data):
    marker = data.find("})({", max(0, data.find("<script>")))
    if marker < 0:
        raise ValueError("找不到知识库 HTML 中的结构化数据")
    return json.JSONDecoder().raw_decode(data[marker + 3:])[0]


def read_book(path):
    if path.is_dir():
        path = next((path / name for name in MEMBERS if (path / name).is_file()), path)
    if not path.is_file():
        raise ValueError(f"找不到知识库文件：{path}")
    if path.stat().st_size > MAX_ARCHIVE:
        raise ValueError("知识库文件超过 64 MiB 读取上限")
    if path.suffix.lower() == ".zip":
        with ZipFile(path) as archive:
            entries = {}
            for info in archive.infolist():
                if info.filename in MEMBERS:
                    if info.filename in entries:
                        raise ValueError(f"知识库 ZIP 有重复文件：{info.filename}")
                    entries[info.filename] = info
            name = next((item for item in MEMBERS if item in entries), None)
            if not name:
                raise ValueError("ZIP 中缺少 docs/knowledge.json 或 docs/index.html")
            with archive.open(entries[name]) as stream:
                data = limited_read(stream, MAX_DATA)
    else:
        name = path.name
        with path.open("rb") as stream:
            data = limited_read(stream, MAX_ARCHIVE)
    book = parse_html(data) if name.lower().endswith(".html") else json.loads(data)
    manuals = book.get("manuals") if isinstance(book, dict) else None
    if not isinstance(manuals, list) or not 1 <= len(manuals) <= 30 or book.get("schema") != 1:
        raise ValueError("知识库格式无效")
    manual_ids = set()
    for manual in manuals:
        manual_id = manual["id"]
        entries = manual.get("entries")
        if manual_id in manual_ids or not isinstance(entries, list) or not entries:
            raise ValueError("知识库存在重复手册或空手册")
        manual_ids.add(manual_id)
        anchors = set()
        for entry in entries:
            anchor = entry["anchor"]
            if anchor in anchors or not all(isinstance(entry[key], str) for key in ("anchor", "title", "text")):
                raise ValueError("知识库章节格式无效或锚点重复")
            anchors.add(anchor)
    return book


def default_path():
    setting = os.environ.get("BLINK_KB")
    if setting:
        return Path(setting)
    cwd = Path.cwd()
    for name in MEMBERS:
        target = cwd / name
        if target.is_file():
            return target
    matches = [path for path in cwd.iterdir() if path.is_file() and
               path.suffix.lower() == ".zip" and "knowledge" in path.name.lower()]
    if len(matches) == 1:
        return matches[0]
    raise ValueError("找不到知识库，请用 --kb 指定 ZIP 或目录，或设置 BLINK_KB")


def flatten(book):
    return [dict(entry, manualId=manual["id"], manualTitle=manual["title"],
                 module=manual.get("module") or manual["title"], mode=manual.get("mode") or "other")
            for manual in book["manuals"] for entry in manual["entries"]]


def source_of(manual):
    source = manual.get("source") or {}
    return {"repository": source.get("repository") or "", "commit": source.get("commit") or None,
            "dirty": source.get("dirty")}

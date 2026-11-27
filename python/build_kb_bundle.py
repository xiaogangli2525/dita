"""Build a Windows x64, Python 3.12 offline KB bundle from an existing publication."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

from blink_kb.book import read_book
from blink_kb.search import MODULES

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent


def write_command(path, text):
    path.write_bytes((text.strip().replace("\n", "\r\n") + "\r\n").encode("ascii"))


def build(source, models, output):
    docs = source / "docs" if (source / "docs/knowledge.json").is_file() else source
    book = read_book(docs / "knowledge.json")
    if not book.get("semantic"):
        raise ValueError("请指定已附带语义索引的 docs 目录")
    if (docs / "index.html").is_file():
        html = read_book(docs / "index.html")
        identify = lambda b: [(m["id"], [(e["anchor"], e["title"], e["text"]) for e in m["entries"]])
                              for m in b["manuals"]]
        if identify(html) != identify(book) or (html["model"], html["sdkVersion"]) != (book["model"], book["sdkVersion"]):
            raise ValueError("阅读页与知识库正文版本不一致")
    assets_file = PROJECT / "public/knowledge/semantic-model-assets.json"
    model = models / "Xenova/bge-small-zh-v1.5"
    assets = json.loads(assets_file.read_text(encoding="utf-8"))
    with TemporaryDirectory(prefix="blink-kb-") as temp:
        root = Path(temp) / "blink-kb"
        dependencies = root / "_vendor"
        wheelhouse = Path(temp) / "wheels"
        platform = ["--only-binary=:all:", "--platform", "win_amd64", "--python-version", "3.12",
                    "--implementation", "cp", "--abi", "cp312"]
        subprocess.run([sys.executable, "-m", "pip", "download", *platform, "--dest", str(wheelhouse),
                        "-r", str(HERE / "requirements-kb.txt")], check=True)
        from lock_windows_wheels import wheel_lock
        print("WINDOWS_WHEEL_LOCK_BEGIN" + chr(10) + wheel_lock(wheelhouse) + "WINDOWS_WHEEL_LOCK_END", flush=True)
        subprocess.run([sys.executable, "-m", "pip", "install", "--no-index", "--no-deps", "--no-compile", *platform,
                        "--target", str(dependencies), *map(str, sorted(wheelhouse.glob("*.whl")))], check=True)
        shutil.rmtree(dependencies / "bin", ignore_errors=True)
        shutil.rmtree(dependencies / "Scripts", ignore_errors=True)
        package = root / "blink_kb"
        rules = package / "_rules"
        rules.mkdir(parents=True)
        for filename in (*MODULES, assets_file.name):
            shutil.copy2(assets_file.parent / filename, rules)
        for source_file in (HERE / "blink_kb").iterdir():
            if source_file.suffix in (".py", ".js"):
                shutil.copy2(source_file, package)
        for name, expected in assets.items():
            target = root / "models/Xenova/bge-small-zh-v1.5" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with (model / name).open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                    raise ValueError(f"模型文件校验失败：{name}")
            shutil.copy2(model / name, target)
        shutil.copytree(PROJECT / "docs/licenses", root / "licenses")
        shutil.copytree(docs, root / "docs")
        shutil.copy2(HERE / "README-windows.txt", root / "README.txt")
        (root / "launch-kb.py").write_text("""import os
from pathlib import Path
import sys

if sys.version_info[:2] != (3, 12) or sys.platform != "win32" or sys.maxsize <= 2**32:
    sys.exit("This bundle requires Windows x64 Python 3.12.")
root = Path(__file__).resolve().parent
sys.path.insert(1, str(root / "_vendor"))
os.environ.setdefault("BLINK_KB", str(root / "docs"))
os.environ.setdefault("BLINK_MODELS", str(root / "models"))

from blink_kb.__main__ import main

raise SystemExit(main(command=r".\\blink-kb.cmd"))
""", encoding="utf-8")
        write_command(root / "blink-kb.cmd", r'''
@echo off
setlocal
if defined BLINK_PYTHON (
  "%BLINK_PYTHON%" -X utf8 "%~dp0launch-kb.py" %*
) else (
  py -3.12 -X utf8 "%~dp0launch-kb.py" %*
)
exit /b %ERRORLEVEL%
''')
        if (docs / "index.html").is_file():
            write_command(root / "blink-reader.cmd", r'''
@echo off
call "%~dp0blink-kb.cmd" --serve
''')
        output.parent.mkdir(parents=True, exist_ok=True)
        with ZipFile(output, "x", compression=ZIP_DEFLATED, compresslevel=6) as archive:
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(root.parent).as_posix())
    print(f"{output.resolve()} ({output.stat().st_size / 2**20:.2f} MiB)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="包含 knowledge.json 的 docs 目录，或其父目录")
    parser.add_argument("models", type=Path, help="包含 Xenova 模型目录的路径")
    parser.add_argument("output", type=Path, help="新建目标 ZIP 文件")
    args = parser.parse_args()
    build(args.source, args.models, args.output)


if __name__ == "__main__":
    main()

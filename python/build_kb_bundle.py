"""Build a Windows x64, Python 3.12 offline KB bundle from an existing publication."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile

from blink_kb.book import read_book
from blink_kb.search import MODULES
from blink_kb.model_files import MODEL, manifest, matches

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent


def write_command(path, text):
    path.write_bytes((text.strip().replace("\n", "\r\n") + "\r\n").encode("ascii"))


def copy_client(root):
    assets_file = PROJECT / "public/knowledge/semantic-model-assets.json"
    package = root / "blink_kb"
    rules = package / "_rules"
    rules.mkdir(parents=True)
    for name in (*MODULES, assets_file.name):
        shutil.copy2(assets_file.parent / name, rules)
    for file in (HERE / "blink_kb").iterdir():
        if file.suffix in (".py", ".js"):
            shutil.copy2(file, package)
    for name in ("launch-kb.py", "kb_setup.py", "requirements-kb-win.lock"):
        shutil.copy2(HERE / name, root)
    shutil.copy2(HERE / "README-windows.txt", root / "README.txt")
    shutil.copytree(PROJECT / "docs/licenses", root / "licenses")
    write_command(root / "blink-kb.cmd", (HERE / "blink-kb.cmd").read_text(encoding="ascii"))
    for name, option in (("blink-reader", "--serve"), ("install-deps", "--setup"),
                         ("install-model", "--install-model")):
        write_command(root / (name + ".cmd"), '@echo off\n"%~dp0blink-kb.cmd" ' + option)
    write_command(root / "setup-reader.cmd", '@echo off\ncall "%~dp0install-deps.cmd"\n'
                  'set "result=%errorlevel%"\npause\nexit /b %result%')


def copy_model(models, destination):
    for name, digest in manifest(PROJECT / "public/knowledge/semantic-model-assets.json").items():
        source = models / MODEL / name
        if not matches(source, digest):
            raise ValueError(f"模型文件校验失败：{source}")
        target = destination / MODEL / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def install_wheels(dependencies, wheelhouse):
    platform = ["--only-binary=:all:", "--platform", "win_amd64", "--python-version", "3.12",
                "--implementation", "cp", "--abi", "cp312"]
    # The lock contains the complete target-platform closure, including Windows-only wheels.
    locked = ["--no-deps", "--require-hashes", "-r", str(HERE / "requirements-kb-win.lock")]
    subprocess.run([sys.executable, "-m", "pip", "download", *platform, *locked, "--dest", str(wheelhouse)],
                   check=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "--no-index", "--no-compile", *platform, *locked,
                    "--find-links", str(wheelhouse), "--target", str(dependencies)], check=True)
    shutil.rmtree(dependencies / "bin", ignore_errors=True)
    shutil.rmtree(dependencies / "Scripts", ignore_errors=True)


def build(source, models, output, lite=False):
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
    with TemporaryDirectory(prefix="blink-kb-") as temp:
        root = Path(temp) / "blink-kb"
        copy_client(root)
        if not lite:
            install_wheels(root / "_vendor", Path(temp) / "wheels")
            copy_model(models, root / "models")
        shutil.copytree(docs, root / "docs")
        if not (docs / "index.html").is_file():
            (root / "blink-reader.cmd").unlink()
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
    parser.add_argument("--lite", action="store_true", help="只打包文档和启动器，复用单独的运行环境")
    args = parser.parse_args()
    build(args.source, args.models, args.output, args.lite)


if __name__ == "__main__":
    main()

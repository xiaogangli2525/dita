"""Build the reusable, air-gapped Windows reader kit. Build inputs contain no manuals."""
import argparse
import hashlib
from pathlib import Path
import shutil
import tarfile
from tempfile import TemporaryDirectory
from urllib.request import urlopen

from build_kb_bundle import copy_client, copy_model, install_wheels, write_command

RUNTIME_URL = ("https://github.com/astral-sh/python-build-standalone/releases/download/20261124/"
               "cpython-3.12.16%2B20261124-x86_64-pc-windows-msvc-install_only_stripped.tar.gz")
RUNTIME_SHA256 = "96694b50dcfde13d56e40346ddaa552a9cd650290e9b933cecf83c1d82226960"


def build(models, output):
    if output.exists():
        raise FileExistsError(output)
    with TemporaryDirectory() as temp:
        staging = Path(temp)
        runtime = staging / "blink-kb-runtime"
        runtime.mkdir()
        archive = staging / "python.tar.gz"
        with urlopen(RUNTIME_URL, timeout=90) as source, archive.open("wb") as target:
            shutil.copyfileobj(source, target)
        with archive.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != RUNTIME_SHA256:
                raise ValueError("Windows Python archive failed SHA-256 verification")
        with tarfile.open(archive) as tar:
            tar.extractall(runtime, filter="data")
        if not (runtime / "python/python.exe").is_file():
            raise ValueError("Unexpected CPython layout")
        install_wheels(runtime / "packages", staging / "wheels")
        copy_model(models, runtime / "models")
        copy_client(staging / "blink-kb")
        # Upgrade the previous standalone model install shortcut when it is extracted alongside the docs.
        legacy = staging / "blink-kb-model"
        legacy.mkdir()
        write_command(legacy / "install-model.cmd", '@echo off\n"%~dp0..\\blink-kb\\setup-reader.cmd"')
        output.mkdir(parents=True)
        for item in ("blink-kb", "blink-kb-runtime", "blink-kb-model"):
            shutil.move(staging / item, output / item)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("models", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.models, args.output)

"""Bootstrap the extracted Windows KB; also invoked by the install and check shortcuts."""
import os
from pathlib import Path
import subprocess
import sys
import sysconfig
from zipfile import BadZipFile


def main():
    if (sys.implementation.name != "cpython" or sys.version_info[:2] != (3, 12)
            or sysconfig.get_platform() != "win-amd64"):
        sys.exit(f"需要 Windows x64 CPython 3.12。当前为 {sys.executable}，"
                 f"{sys.version.split()[0]} ({sysconfig.get_platform()})。可解压配套运行包。")
    root = Path(__file__).resolve().parent
    sys.path.insert(0, str(root))
    if (root / "_vendor").is_dir():
        sys.path.insert(1, str(root / "_vendor"))
    runtime = root.parent / "blink-kb-runtime"
    if Path(sys.executable).resolve() == (runtime / "python/python.exe").resolve():
        sys.path.insert(1, str(runtime / "packages"))
    from blink_kb.model_files import model_root

    dest = model_root(root)
    os.environ["BLINK_MODELS"] = str(dest)
    if not os.environ.get("BLINK_KB"):
        os.environ["BLINK_KB"] = str(root / "docs")
    if sys.argv[1:] in (["--setup"], ["--verify-install"]):
        import kb_setup

        if sys.argv[1] == "--setup":
            return kb_setup.setup(root, dest)
        kb_setup.verify(root, dest)
        return 0
    from blink_kb.__main__ import main as cli
    return cli(command=r".\blink-kb.cmd")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, RuntimeError, ImportError, BadZipFile, subprocess.SubprocessError) as error:
        print(f"运行失败：{error}", file=sys.stderr)
        raise SystemExit(1)

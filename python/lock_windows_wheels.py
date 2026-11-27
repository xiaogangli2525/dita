"""Refresh the Windows CPython 3.12 wheel lock on a Windows x64 build machine."""
import hashlib
from pathlib import Path
import subprocess
import sys
import sysconfig
from tempfile import TemporaryDirectory

HERE = Path(__file__).resolve().parent


def wheel_lock(wheels):
    lines = []
    for wheel in sorted(wheels.glob("*.whl")):
        name, version, *_ = wheel.name.split("-")
        with wheel.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        lines.append(f"{name}=={version} --hash=sha256:{digest}")
    if not lines:
        raise ValueError("No Windows wheels resolved")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    if sys.version_info[:2] != (3, 12) or sysconfig.get_platform() != "win-amd64":
        sys.exit("Run with Windows x64 CPython 3.12")
    with TemporaryDirectory() as temp:
        subprocess.run([sys.executable, "-m", "pip", "download", "--only-binary=:all:", "-d", temp,
                        "-r", str(HERE / "requirements-kb.txt")], check=True)
        (HERE / "requirements-kb-win.lock").write_text(wheel_lock(Path(temp)), encoding="ascii")

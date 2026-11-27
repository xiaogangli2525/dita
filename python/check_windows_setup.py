"""Exercise the distributed Windows setup using a fresh profile and no working network index."""
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from zipfile import ZipFile

from blink_kb.model_files import MODEL, manifest


def run(program, args, env, success=True):
    result = subprocess.run([str(program), *args], env=env, stdin=subprocess.DEVNULL, capture_output=True,
                            text=True, encoding="utf-8", errors="replace", timeout=240)
    if (result.returncode == 0) != success:
        raise AssertionError(f"{program.name} {args} ({result.returncode})\n{result.stdout}\n{result.stderr}")
    return result.stdout if success else result.stdout + result.stderr


def test(kit, docs, uart_docs):
    with TemporaryDirectory(prefix="Blink 安装 ") as temp:
        parent = Path(temp)
        root = parent / "blink-kb"
        shutil.copytree(kit / root.name, root)
        # Keep vendor files and bytecode created during the test out of the published artifact.
        shutil.copytree(kit / "blink-kb-runtime", parent / "blink-kb-runtime")
        env = {k: v for k, v in os.environ.items() if not k.startswith(("BLINK_", "PYTHON", "PIP_"))}
        env.update(LOCALAPPDATA=str(parent / "profile"), PIP_NO_INDEX="1", HF_HUB_OFFLINE="1",
                   BLINK_PYTHON=str(parent / "no-system-python.exe"))
        setup, cli = root / "install-deps.cmd", root / "blink-kb.cmd"
        selected = Path(env["LOCALAPPDATA"]) / "Blink/models"
        model_env = dict(env, BLINK_MODELS=str(parent / "只装模型"))
        report = run(root / "install-model.cmd", [], model_env)
        assert "模型文件已就绪" in report and "安装验证完成" not in report
        assert (Path(model_env["BLINK_MODELS"]) / MODEL / "tokenizer.json").is_file()
        shutil.copytree(docs, root / "docs")
        assert "安装验证完成" in run(setup, [], env)
        asset = selected / MODEL / "tokenizer.json"
        touched = asset.stat().st_mtime_ns
        assert "安装验证完成" in run(setup, [], env)
        assert asset.stat().st_mtime_ns == touched
        result = json.loads(run(cli, ["日志抓取方法", "--search", "semantic", "--json"], env))
        assert result["searchMode"] == "semantic" and result["results"][0]["title"] == "日志抓取方法"
        # A pre-existing override must work from initial install through reader startup.
        custom = parent / "custom 模型"
        env["BLINK_MODELS"] = str(custom)
        report = run(setup, [], env)
        printed = re.search(r"本次使用的模型目录：(.+)", report)
        assert printed and Path(printed[1].strip()).samefile(custom), report
        file = custom / MODEL / "tokenizer.json"
        file.write_bytes(b"incomplete")
        assert "安装验证完成" in run(setup, [], env)
        assert file.read_bytes() == asset.read_bytes()
        env["BLINK_MODELS"] = "relative-models"
        assert "绝对路径" in run(setup, [], env, success=False)
        env["BLINK_MODELS"] = str(custom)
        env["BLINK_KB"] = str(parent / "unrelated")
        assert "BLINK_KB" in run(setup, [], env, success=False)
        env.pop("BLINK_KB")
        shutil.rmtree(root / "docs")
        shutil.copytree(uart_docs, root / "docs")
        assert "命中《外设资源》" in run(setup, [], env)
        result = json.loads(run(cli, ["支持多少串口", "--search", "semantic", "--json"], env))
        assert "4" in result["results"][0]["excerpt"] and result["results"][0]["title"] == "外设资源"

        # Exercise the lightweight setup with a stock interpreter, local wheels and the separate model ZIP.
        shutil.rmtree(parent / "blink-kb-runtime")
        env.pop("BLINK_MODELS")
        env["BLINK_PYTHON"] = sys.executable
        shutil.rmtree(selected)
        with ZipFile(parent / "Blink-KB-Models-bge-small-zh-v1.5.zip", "w") as zipfile:
            for path in (kit / "blink-kb-runtime/models").rglob("*"):
                if path.is_file():
                    zipfile.write(path, "blink-kb-model/" + path.relative_to(kit / "blink-kb-runtime").as_posix())
        subprocess.run([sys.executable, "-m", "pip", "download", "--require-hashes", "--only-binary=:all:",
                        "-r", str(root / "requirements-kb-win.lock"), "-d", str(root / "wheelhouse")], check=True)
        assert "命中《外设资源》" in run(setup, [], env)
        assert (root / ".venv/Scripts/python.exe").is_file() and (selected / MODEL / "config.json").is_file()
        result = json.loads(run(cli, ["支持多少串口", "--search", "semantic", "--json"], env))
        assert result["results"][0]["title"] == "外设资源"
        # The manifest must declare exactly the supported model files.
        path = root / "blink_kb/_rules/semantic-model-assets.json"
        bad = manifest(path)
        bad["unrelated.txt"] = "0" * 64
        path.write_text(json.dumps(bad))
        assert "清单无效" in run(setup, [], env, success=False)
    print("Windows first install, normal CLI/HTTP inference, overrides, repeat setup and repair passed.")


if __name__ == "__main__":
    test(*(Path(arg).resolve() for arg in sys.argv[1:]))

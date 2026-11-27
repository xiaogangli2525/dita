"""Exercise the distributed Windows setup using a fresh profile and no working network index."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

from blink_kb.model_files import MODEL, manifest


def run(program, args, env, success=True):
    result = subprocess.run([str(program), *args], env=env, stdin=subprocess.DEVNULL, capture_output=True,
                            text=True, encoding="utf-8", errors="replace", timeout=240)
    if (result.returncode == 0) != success:
        raise AssertionError(f"{program.name} {args} ({result.returncode})\n{result.stdout}\n{result.stderr}")
    return result.stdout + result.stderr


def test(kit, docs):
    with TemporaryDirectory(prefix="Blink 安装 ") as temp:
        parent = Path(temp)
        root = parent / "blink-kb"
        shutil.copytree(kit / root.name, root)
        # Keep vendor files and bytecode created during the test out of the published artifact.
        shutil.copytree(kit / "blink-kb-runtime", parent / "blink-kb-runtime")
        shutil.copytree(docs, root / "docs")
        env = {k: v for k, v in os.environ.items() if not k.startswith(("BLINK_", "PYTHON", "PIP_"))}
        env.update(LOCALAPPDATA=str(parent / "profile"), PIP_NO_INDEX="1", HF_HUB_OFFLINE="1",
                   BLINK_PYTHON=str(parent / "no-system-python.exe"))
        setup, cli = root / "install-deps.cmd", root / "blink-kb.cmd"
        selected = Path(env["LOCALAPPDATA"]) / "Blink/models"
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
        assert str(custom) in run(setup, [], env)
        file = custom / MODEL / "tokenizer.json"
        file.write_bytes(b"incomplete")
        assert "安装验证完成" in run(setup, [], env)
        assert file.read_bytes() == asset.read_bytes()
        env["BLINK_MODELS"] = "relative-models"
        assert "绝对路径" in run(setup, [], env, success=False)
        env["BLINK_MODELS"] = str(custom)
        env["BLINK_KB"] = str(parent / "unrelated")
        assert "BLINK_KB" in run(setup, [], env, success=False)
        # The manifest must declare exactly the supported model files.
        path = root / "blink_kb/_rules/semantic-model-assets.json"
        bad = manifest(path)
        bad["unrelated.txt"] = "0" * 64
        path.write_text(json.dumps(bad))
        env.pop("BLINK_KB")
        assert "清单无效" in run(setup, [], env, success=False)
    print("Windows first install, normal CLI/HTTP inference, overrides, repeat setup and repair passed.")


if __name__ == "__main__":
    test(*(Path(arg).resolve() for arg in sys.argv[1:]))

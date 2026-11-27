"""Locate and verify the model shared by the CLI, reader and Windows installer."""
import hashlib
import json
import os
from pathlib import Path
import re

MODEL = Path("Xenova/bge-small-zh-v1.5")
FILES = ("config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
         "onnx/model_quantized.onnx")


def model_root(bundle=None):
    override = os.environ.get("BLINK_MODELS")
    if override:
        path = Path(override).expanduser()
        if bundle is not None and not path.is_absolute():
            raise ValueError(f"请将 BLINK_MODELS 设为绝对路径，或清除后重试：{override}")
        return path.resolve()
    package = Path(__file__).resolve().parent.parent if bundle is None else bundle
    if (package / "models" / MODEL).is_dir():
        return package / "models"
    project = package.parent
    if (project / "public/knowledge/semantic-model-assets.json").is_file():
        return project / "models"
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA")
        if local and Path(local).is_absolute():
            return Path(local) / "Blink/models"
        raise ValueError("找不到用户模型目录。请设置绝对路径 BLINK_MODELS。")
    return project / "models"


def manifest(path):
    assets = json.loads(path.read_text(encoding="utf-8"))
    if (not isinstance(assets, dict) or set(assets) != set(FILES)
            or not all(isinstance(v, str) and re.fullmatch("[0-9a-f]{64}", v) for v in assets.values())):
        raise ValueError(f"模型文件清单无效，请重新解压运行包：{path}")
    return assets


def matches(path, digest):
    if not path.is_file():
        return False
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest() == digest

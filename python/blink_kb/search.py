"""Python inference with the same retrieval rules used by the editor and Node CLI."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import unicodedata

from .book import flatten

MODULES = ("knowledge-search-profile.js", "knowledge-retrieval.js", "knowledge-search.js",
           "knowledge-structure.js", "knowledge-semantic.js", "knowledge-ranking.js", "knowledge-reader.js")
ENTITY = re.compile(r"\b(?:https?|ftp|mqtt|webui|gpio|pdp|apn|ssl|tls|tcp|udp|dns|ntp)\b", re.I | re.ASCII)


class Rules:
    def __init__(self, records):
        import quickjs

        directory = Path(__file__).parent / "_rules"
        if not directory.is_dir():
            directory = Path(__file__).resolve().parents[2] / "public/knowledge"
        self.directory = directory
        self.context = quickjs.Context()
        self.context.set_memory_limit(512 * 1024 * 1024)
        self.context.set_time_limit(20)
        for name in MODULES:
            self.context.eval((directory / name).read_text(encoding="utf-8"))
        self.context.eval(Path(__file__).with_name("rules.js").read_text(encoding="utf-8"))
        self.context.get("configure")(json.dumps(records))
        self.invoke = self.context.get("invoke")
        self.js_error = quickjs.JSException

    def call(self, name, *args):
        try:
            return json.loads(self.invoke(name, json.dumps(args)))
        except self.js_error as error:
            raise ValueError(str(error).splitlines()[0]) from error


class VectorSearch:
    def __init__(self, profile, assets_file, model_root):
        import numpy
        import onnxruntime
        from tokenizers import Tokenizer

        self.np = numpy
        self.profile = profile
        directory = model_root / profile["model"]
        assets = json.loads(assets_file.read_text(encoding="utf-8"))
        for name, expected in assets.items():
            asset = directory / name
            if not asset.is_file():
                raise ValueError(f"本地向量模型文件缺失：{asset}，请检查 BLINK_MODELS")
            with asset.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                    raise ValueError(f"本地向量模型校验失败：{name}")
        self.tokenizer = Tokenizer.from_file(str(directory / "tokenizer.json"))
        self.tokenizer.no_padding()
        self.tokenizer.no_truncation()
        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = 2
        self.session = onnxruntime.InferenceSession(str(directory / "onnx/model_quantized.onnx"),
                                                    sess_options=options, providers=["CPUExecutionProvider"])

    def scores(self, values, query):
        np = self.np
        model_input = unicodedata.normalize("NFKC", self.profile["queryPrefix"] + query)
        model_input = re.sub("[A-Z]", lambda match: match[0].lower(), model_input)
        tokens = self.tokenizer.encode(model_input)
        if len(tokens.ids) > self.profile["tokenLimit"]:
            raise ValueError("搜索内容超出模型 Token 预算，请缩短问题")
        inputs = {"input_ids": tokens.ids, "attention_mask": tokens.attention_mask, "token_type_ids": tokens.type_ids}
        inputs = {field.name: np.array([inputs[field.name]], dtype=np.int64) for field in self.session.get_inputs()}
        vector = self.session.run(["last_hidden_state"], inputs)[0][0, 0].astype(np.float64)
        vector /= np.linalg.norm(vector)
        return (values @ vector.astype(np.float32)).tolist()

    def read_vectors(self, indexes):
        np = self.np
        matrices = []
        for index in indexes:
            encoded = re.sub(r"[\t\n\f\r ]", "", index["vectors"])
            data = base64.b64decode(encoded + "=" * (-len(encoded) % 4), validate=True)
            dtype = np.int8 if index["schema"] == 2 else "<f4"
            if len(data) != len(index["chunks"]) * self.profile["dimensions"] * np.dtype(dtype).itemsize:
                raise ValueError("语义向量数据长度无效")
            values = np.frombuffer(data, dtype=dtype).reshape(-1, self.profile["dimensions"]).astype(np.float64)
            if not np.isfinite(values).all():
                raise ValueError("语义向量数据含无效数值")
            if index["schema"] == 2:
                if not (np.max(np.abs(values), axis=1) == 127).all():
                    raise ValueError("Int8 向量未按约定编码，请重新生成")
                values /= np.linalg.norm(values, axis=1)[:, None]
            elif not (np.abs(np.sum(values ** 2, axis=1) - 1) <= 0.01).all():
                raise ValueError("语义向量未按约定归一化，请重新生成")
            matrices.append(values.astype(np.float32))
        return matrices[0] if len(matrices) == 1 else np.concatenate(matrices)


class Search:
    def __init__(self, books, model_root=None):
        self.books = books
        self.records = [row for book in books for row in flatten(book)]
        self.rules = Rules(self.records)
        self.vector = None
        self.chunks = None
        self.indexes = [book.get("semantic") for book in books]
        self.compatible = [bool(index and self.rules.call("compatible", {"profile": index["profile"],
                                                                        "schema": index["schema"]}))
                           for index in self.indexes]
        root = model_root or os.environ.get("BLINK_MODELS")
        self.model_root = Path(root) if root else Path(__file__).resolve().parents[2] / "models"

    def search(self, query, mode, options):
        limit = options["limit"]
        if self.rules.call("constraints", query)["requiresLexical"]:
            mode = "lexical"
        elif mode == "auto":
            mode = "hybrid" if all(self.compatible) else "lexical"
        lexical = self.rules.call("lexical", query, options)
        if mode == "lexical":
            return mode, lexical[:limit]
        self.prepare_vectors()
        scores = self.vector.scores(self.values, self.rules.call("normalizeQuery", query))
        return mode, self.rules.call("rank", self.chunks, scores, query, lexical,
                                     dict(options, semanticOnly=mode == "semantic"))

    def warm(self):
        self.rules.call("lexical", "", dict(limit=1))
        self.prepare_vectors()
        self.vector.scores(self.values, self.rules.call("normalizeQuery", "初始化"))

    def prepare_vectors(self):
        if not all(self.compatible):
            raise ValueError("需要附有兼容语义索引的知识库，请重新导出或在工作台生成索引")
        profile = self.indexes[0]["profile"]
        if self.chunks is None:
            offset = 0
            chunks = []
            for book, index in zip(self.books, self.indexes):
                if index["profile"]["id"] != profile["id"]:
                    raise ValueError("合并包的分片配置不一致，请先统一重建")
                rows = flatten(book)
                self.rules.call("validateChunks", rows, {"profile": index["profile"], "schema": index["schema"],
                                                        "chunks": index["chunks"]})
                chunks.extend(dict(chunk, position=chunk["position"] + offset) for chunk in index["chunks"])
                offset += len(rows)
            if len(chunks) > 12000:
                raise ValueError("语义索引超过 12000 个片段")
            self.chunks = chunks
        if self.vector is None:
            vector = VectorSearch(profile, self.rules.directory / "semantic-model-assets.json", self.model_root)
            self.values = vector.read_vectors(self.indexes)
            self.vector = vector

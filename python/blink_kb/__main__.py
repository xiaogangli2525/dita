"""CLI and integration entry point. Pass kb arguments without the subcommand."""
import argparse
import json
from pathlib import Path
import re
import shlex
import sys
from zipfile import BadZipFile

from .book import default_path, read_book, source_of
from .search import ENTITY, Search


def get_args(argv):
    parser = argparse.ArgumentParser(prog="blink-cli kb", description="离线 DITA 知识库检索")
    parser.add_argument("query", nargs="*", help="搜索问题")
    parser.add_argument("--kb", type=Path, help="知识库 ZIP、解压目录、knowledge.json 或 index.html")
    parser.add_argument("--merge", action="append", type=Path, default=[], help="附加同型号和 SDK 版本的知识库")
    parser.add_argument("--search", choices=("auto", "lexical", "hybrid", "semantic"), default="auto")
    parser.add_argument("--manual")
    parser.add_argument("--module", default="")
    parser.add_argument("--mode", default="")
    parser.add_argument("--limit", type=int, choices=range(1, 51), metavar="1-50", default=10)
    parser.add_argument("--json", action="store_true")
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--info", action="store_true")
    actions.add_argument("--list", action="store_true")
    actions.add_argument("--serve", action="store_true", help="启动本机浏览器语义阅读页")
    actions.add_argument("--get", metavar="手册ID#章节锚点")
    parser.add_argument("--block", help="与 --get 一起读取表格行、段落等结构块")
    # argparse otherwise interprets standalone hexadecimal codes as options.
    args, remaining = parser.parse_known_intermixed_args(argv)
    if len(remaining) == 1 and not args.query and re.fullmatch("-0x[0-9a-f]+", remaining[0], re.I):
        args.query = remaining
    elif remaining:
        parser.error("无法识别的参数：" + " ".join(remaining))
    if len(args.merge) > 29:
        parser.error("最多合并 30 个知识库包")
    if args.block and not args.get:
        parser.error("--block 必须与 --get 一起使用")
    if bool(args.query) == bool(args.info or args.list or args.get or args.serve):
        parser.error("请输入一个搜索问题，或使用 --info / --list / --get / --serve")
    if args.serve and (args.merge or args.json):
        parser.error("--serve 一次打开一份已解压的知识库，使用文本输出")
    return args


def manual_id(manuals, query):
    key = query.strip().lower()
    exact = [m for m in manuals if key in (m["id"].lower(), m["title"].lower())]
    if exact:
        return exact[0]["id"]
    matches = [m for m in manuals if key in m["title"].lower()]
    if len(matches) != 1:
        raise ValueError("找不到手册或匹配到多份手册，请使用完整手册名称或 ID")
    return matches[0]["id"]


def chapter(manuals, args, base):
    key, separator, anchor = args.get.partition("#")
    if not separator or not key or not anchor:
        raise ValueError("--get 引用格式应为 手册ID#章节锚点")
    manual = manuals.get(key)
    entry = next((e for e in manual["entries"] if e["anchor"] == anchor), None) if manual else None
    if entry is None:
        raise ValueError(f"找不到手册或章节：{args.get}")
    result = dict(schema=1, id=args.get, title=entry["title"], manual=manual["title"],
                  module=manual.get("module") or manual["title"], text=entry["text"],
                  sourcePath=entry.get("sourcePath") or "", fingerprint=entry.get("fingerprint") or "",
                  source=source_of(manual), knowledgeBase=base)
    if args.block:
        from .search import Rules

        structure = Rules([]).call("validateBlock", entry)
        unit = next((item for item in (structure or {}).get("units", []) if item["id"] == args.block), None)
        if not unit:
            raise ValueError("找不到结构块，请核对 ID，或使用 --get 读取整章")
        result["block"] = {key: value for key, value in unit.items() if key != "text"}
        result["text"] = "\n".join(filter(None, [*unit["section"], *unit["context"], unit["text"],
                                                 *("注脚：" + note["text"] for note in unit["notes"])]))
    return result


def describe_hits(search, hits, query, manuals):
    entity = ENTITY.search(query)
    results = []
    for hit in hits:
        entry = search.records[hit["position"]]
        body_mention = entity and entity[0].lower() in entry["text"].lower() and entity[0].lower() not in \
            " ".join(entry[key] for key in ("title", "manualTitle", "module")).lower()
        result = {key: entry.get(key) or "" for key in ("title", "manualId", "module", "mode", "anchor", "sourcePath", "fingerprint")}
        result.update(id=entry["manualId"] + "#" + entry["anchor"], manual=entry["manualTitle"],
                      score=hit["score"], reason=hit["reason"] + (f" · 正文提及 {entity[0]}" if body_mention else ""),
                      matchedTerms=hit["matchedTerms"], evidence="body-mention" if body_mention else "chapter-match",
                      source=source_of(manuals[entry["manualId"]]), excerpt=hit["excerpt"])
        if "semanticScore" in hit:
            result["semanticScore"] = hit["semanticScore"]
        if "chunk" in hit:
            chunk = dict(hit["chunk"])
            if any(unit["id"] == chunk.get("unitId") for unit in (entry.get("structure") or {}).get("units", [])):
                chunk["blockId"] = chunk["unitId"]
            result["chunk"] = chunk
        results.append(result)
    return results


def run(args):
    paths = [p.resolve() for p in [args.kb or default_path(), *args.merge]]
    books = [read_book(path) for path in paths]
    first = books[0]
    manuals = {}
    for book in books:
        if (book["model"], book["sdkVersion"]) != (first["model"], first["sdkVersion"]):
            raise ValueError("合并的产品型号和 SDK 版本须一致")
        for manual in book["manuals"]:
            if manual["id"] in manuals:
                raise ValueError("合并包存在重复手册：" + manual["title"])
            manuals[manual["id"]] = manual
    if len(manuals) > 30:
        raise ValueError("总知识库最多组合 30 份手册")
    base = dict(path=str(paths[0]), paths=list(map(str, paths)), title=first["title"],
                model=first["model"], sdkVersion=first["sdkVersion"])
    if args.get:
        return chapter(manuals, args, base)
    search = Search(books)
    version = search.rules.call("version")
    if args.info or args.list:
        summaries = [dict(id=m["id"], title=m["title"], version=m.get("version") or "",
                          chapters=len(m["entries"]), module=m.get("module") or m["title"], source=source_of(m))
                     for m in manuals.values()]
        if args.list:
            return dict(schema=1, title=first["title"], manuals=[
                {key: value for key, value in summary.items() if key != "source"} for summary in summaries
            ])
        indexes = [i for i in search.indexes if i]
        semantic = dict(profile=indexes[0]["profile"]["id"], chunks=sum(len(i["chunks"]) for i in indexes),
                        vectorEncoding="int8" if all(i["schema"] == 2 for i in indexes) else "float32",
                        compatible=all(search.compatible)) if indexes else None
        return dict(schema=1, title=first["title"], model=first["model"], sdkVersion=first["sdkVersion"],
                    generatedAt=first.get("generatedAt"), manualCount=len(manuals), chapterCount=len(search.records),
                    searchEngine=version, semantic=semantic, manuals=summaries)
    query = " ".join(args.query).strip()
    if not 1 <= len(query.encode("utf-16-le", errors="surrogatepass")) // 2 <= 500:
        raise ValueError("请输入 1～500 字符的搜索内容")
    options = dict(manualId=manual_id(manuals.values(), args.manual) if args.manual else "",
                   module=args.module, mode=args.mode, limit=args.limit)
    mode, hits = search.search(query, args.search, options)
    results = describe_hits(search, hits, query, manuals)
    warnings = []
    if mode == "lexical" and any(index and not ok for index, ok in zip(search.indexes, search.compatible)):
        warnings.append("语义索引版本不兼容，当前使用关键词检索，请在工作台重新生成索引。")
    return dict(schema=1, query=query, knowledgeBase=base, searchEngine=version,
                searchMode=mode, warnings=warnings, count=len(results), results=results)


def print_result(data, args, command):
    if args.json:
        print(json.dumps(data, indent=2))
    elif args.get:
        print(f'{data["title"]}\n手册：{data["manual"]}\n来源：{data["source"]["repository"]} / {data["source"]["commit"] or "无提交记录"}\n\n{data["text"]}')
    elif args.list:
        for item in data["manuals"]:
            print(f'{item["title"]} [{item["id"]}] · {item["chapters"]} 章')
    elif args.info:
        print(f'{data["title"]} · 型号：{data["model"]} · SDK：{data["sdkVersion"]}')
        print(f'手册：{data["manualCount"]} · 章节：{data["chapterCount"]} · 检索引擎：{data["searchEngine"]}')
    else:
        for warning in data["warnings"]:
            print(warning, file=sys.stderr)
        if not data["results"]:
            print(f'没有找到相关内容：{data["query"]}')
            return
        label = {"lexical": "关键词检索", "hybrid": "离线混合检索", "semantic": "离线语义检索"}[data["searchMode"]]
        print(f'搜索：{data["query"]}\n找到 {data["count"]} 条相关内容 · {label}\n')
        quote = (lambda value: "'" + value.replace("'", "''") + "'") if sys.platform == "win32" else shlex.quote
        paths = data["knowledgeBase"]["paths"]
        prefix = command + " --kb " + quote(paths[0]) + "".join(" --merge " + quote(path) for path in paths[1:])
        for number, hit in enumerate(data["results"], 1):
            block = hit.get("chunk", {}).get("blockId")
            read_command = prefix + " --get " + quote(hit["id"]) + (" --block " + quote(block) if block else "")
            print(f'[{number}] {hit["title"]}\n    手册：{hit["manual"]}\n    匹配：{hit["reason"]}\n'
                  f'    摘要：{hit["excerpt"]}\n    读取：{read_command}\n')


def main(argv=None, *, command="blink-cli kb"):
    try:
        args = get_args(argv)
        if args.serve:
            from .reader import serve

            serve((args.kb or default_path()).resolve())
        else:
            print_result(run(args), args, command)
    except SystemExit as exit_status:
        return exit_status.code
    except (OSError, ValueError, KeyError, TypeError, BadZipFile, ImportError) as error:
        print(f"错误：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(command="python -m blink_kb"))

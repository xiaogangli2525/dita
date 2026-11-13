'use strict';
// Adapted from the user-provided SDK_Offline_Docs_Starter search 1.1.0.
// Kept as a pure factory so one engine serves build-time and offline queries.
(function (root) {
  function createSdkSearch() {
    "use strict";
  
    var DEFAULT_WORDS = (
      "文件系统 文件 目录 创建 打开 读取 写入 关闭 删除 移动 重命名 文件名 " +
      "错误码 错误 返回值 返回 参数 示例 线程 多线程 多任务 并发 访问 保护 " +
      "阻塞 入口 函数 初始化 同步 刷新 掉电 固件 编译 环境 驱动 下载 上传 " +
      "服务器 日志 抓取 串口 配置 中断 定时器 内存 空间 路径 绝对路径 " +
      "网络 连接 超时 失败 恢复 断开 本地 缓冲 任务 句柄 回调 模组 系统 " +
      "用户 源文件 头文件 数据 保存 读写 性能 注意 设计 开发 接口 挂载 " +
      "目录项 操作 同一 同一个 线程安全 互斥 主动 被动 模式 状态 查询 " +
      "发送 接收 通信 端口 资源 应用 电源 唤醒 休眠 定位 解析 蓝牙 音频 " +
      "响应 结果 覆盖 追加 更新 烧录 版本 工具 空闲 分配 释放 锁 缓冲区 " +
      "数据拨号 PDP APN 激活 拨号 自动联网 网络注册 引脚分配 引脚资源 外设资源 内存资源 " +
      "WebUI 前端 后端 WebServer 交互 定制 开发示例 编译SDK 编译环境 固件下载 下载固件 " +
      "LOG抓取 死机现场 用户调试 入口函数 烧录 上网 证书 配置 查询 环境 分配"
    ).split(/\s+/);
    var STOP_WORDS = (
      "如何 怎样 怎么 为什么 请问 一下 是否 可以 能够 需要 进行 使用 " +
      "处理 问题 这个 那个 里面 相关 关于 时候 一个 什么 的 了 和 与 及 " +
      "或 呢 么 吗 在 把 将 有 时 中 到 为 对 从 下 上 是 要 不 都 不能 无法 为什么 怎么 模块 模组 一直 总是 怎么办 查看 有哪些 多少 哪些 已经 适合 意思 是什么 在哪里 加"
    ).split(/\s+/);
    var FIELD_WEIGHTS = { title: 9, aliases: 7, symbols: 7, docTitle: 2, text: 1 };
    var INDEX_FORMAT = "sdk-search/1.2.0";
    var TASK_TERMS = new Set(("创建 删除 打开 读取 写入 关闭 移动 重命名 上传 下载 " +
      "初始化 同步 刷新 挂载 分配 释放 失败 超时 阻塞").split(/\s+/));
  
    function normalize(value) {
      var text = value == null ? "" : String(value);
      return (text.normalize ? text.normalize("NFKC") : text).toLowerCase().trim();
    }
    function array(value) { return Array.isArray(value) ? value : value ? [value] : []; }
    function mode(value) {
      value = normalize(value);
      return value === "opencpu" || value === "open cpu" ? "oc" : value;
    }
    function clampLimit(value, fallback) {
      return Number.isFinite(Number(value)) ? Math.max(0, Math.min(200, Math.floor(Number(value)))) : fallback;
    }
  
    function makeTokenizer(options) {
      var replacements = Object.assign({ "新建": "创建", "文件夹": "目录" }, options.synonyms || {});
      var replaceKeys = Object.keys(replacements).sort(function (a, b) { return b.length - a.length; });
      function canonical(value) {
        var result = normalize(value);
        replaceKeys.forEach(function (key) {
          result = result.split(normalize(key)).join(normalize(replacements[key]));
        });
        return result;
      }
      var trie = Object.create(null);
      function addWord(word, stop) {
        word = canonical(word);
        if (!word) return;
        var node = trie;
        for (var i = 0; i < word.length; i++) node = node[word[i]] || (node[word[i]] = Object.create(null));
        node.$ = { word: word, stop: stop };
      }
      DEFAULT_WORDS.concat(array(options.dictionary)).forEach(function (word) { addWord(word, false); });
      STOP_WORDS.concat(array(options.stopWords)).forEach(function (word) { addWord(word, true); });
      function wordAt(run, start) {
        var node = trie, found = null;
        for (var i = start; i < run.length && node[run[i]]; i++) {
          node = node[run[i]];
          if (node.$) found = { length: i - start + 1, word: node.$.word, stop: node.$.stop };
        }
        return found;
      }
      function features(value) {
        var text = canonical(value), words = new Set(), grams = new Set();
        var latin = text.match(/(?:at\+)?[a-z_][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*|-?(?:0x[0-9a-f]+|\d+(?:\.\d+)*)/g) || [];
        latin.forEach(function (word) {
          words.add(word);
          if (word.indexOf("_") >= 0) word.split("_").forEach(function (part) {
            if (part.length > 1 && part !== "cm") words.add(part);
          });
        });
        (text.match(/[\u3400-\u9fff]+/g) || []).forEach(function (run) {
          for (var g = 0; g < run.length - 1; g++) grams.add(run.slice(g, g + 2));
          var at = 0;
          while (at < run.length) {
            var match = wordAt(run, at);
            if (match) {
              if (!match.stop) words.add(match.word);
              at += match.length;
              continue;
            }
            var end = at + 1;
            while (end < run.length && !wordAt(run, end)) end++;
            var unknown = run.slice(at, end);
            // Unknown Chinese phrases use adjacent pairs, avoiding one-character noise.
            if (unknown.length > 1) for (var u = 0; u < unknown.length - 1; u++) words.add(unknown.slice(u, u + 2));
            at = end;
          }
        });
        return { text: text, words: words, grams: grams };
      }
      return { canonical: canonical, features: features };
    }
  
    function buildIndex(records, options, tokenizer) {
      var entries = [], postings = new Map(), symbols = new Map();
      var suggestions = new Map();
      function post(key, id) {
        if (!postings.has(key)) postings.set(key, new Set());
        postings.get(key).add(id);
      }
      function suggestValue(value) {
        var key = normalize(value);
        if (key && !suggestions.has(key)) suggestions.set(key, String(value));
      }
      records.forEach(function (record, index) {
        if (!record || typeof record !== "object") return;
        var fields = {
          title: tokenizer.features(record.title),
          aliases: tokenizer.features(array(record.aliases).join(" ")),
          symbols: tokenizer.features(array(record.symbols).concat(array(record.definedSymbols)).join(" ")),
          docTitle: tokenizer.features(record.docTitle),
          text: tokenizer.features(record.text)
        };
        var entry = {
          record: record, index: index, fields: fields,
          words: new Set(), grams: new Set(),
          symbols: new Set(array(record.symbols).concat(array(record.definedSymbols)).map(normalize)),
          defined: new Set(array(record.definedSymbols).map(normalize)),
          aliases: new Set(array(record.aliases).map(tokenizer.canonical)),
          module: normalize(record.module), mode: mode(record.mode)
        };
        Object.keys(fields).forEach(function (field) {
          fields[field].words.forEach(function (term) { entry.words.add(term); });
          fields[field].grams.forEach(function (term) { entry.grams.add(term); });
        });
        entries.push(entry);
        var id = entries.length - 1;
        entry.words.forEach(function (term) { post("w:" + term, id); });
        entry.grams.forEach(function (term) { post("g:" + term, id); });
        entry.symbols.forEach(function (symbol) {
          if (!symbols.has(symbol)) symbols.set(symbol, new Set());
          symbols.get(symbol).add(id);
        });
        array(record.definedSymbols).concat(array(record.symbols)).forEach(suggestValue);
        suggestValue(record.title);
        array(record.aliases).forEach(suggestValue);
      });
      return { entries: entries, postings: postings, symbols: symbols, suggestions: suggestions };
    }
  
    function indexingOptions(options) {
      return { dictionary: array(options.dictionary), stopWords: array(options.stopWords), synonyms: options.synonyms || {} };
    }
    function fingerprint(records, options) {
      // A cache-invalidation fingerprint, not a security or authenticity signature.
      // Including full records catches ID, content, URL, alias, and metadata changes.
      var text = JSON.stringify([records, indexingOptions(options)]);
      var a = 2166136261, b = 2654435769;
      for (var i = 0; i < text.length; i++) {
        a = Math.imul(a ^ text.charCodeAt(i), 16777619);
        b = Math.imul(b ^ text.charCodeAt(i), 2246822519);
      }
      return text.length + ":" + (a >>> 0).toString(16) + ":" + (b >>> 0).toString(16);
    }
    function compile(records, options) {
      if (!Array.isArray(records)) throw new TypeError("SDKSearch.compile expects an array of records");
      options = options || {};
      var settings = indexingOptions(options), state = buildIndex(records, settings, makeTokenizer(settings));
      return {
        format: INDEX_FORMAT,
        recordCount: records.length,
        fingerprint: fingerprint(records, settings),
        options: settings,
        entries: state.entries.map(function (entry) {
          var fields = {};
          Object.keys(FIELD_WEIGHTS).forEach(function (field) { fields[field] = Array.from(entry.fields[field].words); });
          return { index: entry.index, title: entry.fields.title.text, fields: fields,
            symbols: Array.from(entry.symbols), defined: Array.from(entry.defined), aliases: Array.from(entry.aliases),
            module: entry.module, mode: entry.mode };
        }),
        postings: Array.from(state.postings, function (pair) { return [pair[0], Array.from(pair[1])]; }),
        suggestions: Array.from(state.suggestions)
      };
    }
    function restoreIndex(records, compiled) {
      if (!Array.isArray(compiled.entries) || !Array.isArray(compiled.postings) || !Array.isArray(compiled.suggestions)) {
        throw new Error("Incomplete compiled search index");
      }
      if (compiled.entries.length !== records.filter(function (record) { return record && typeof record === "object"; }).length) {
        throw new Error("Compiled record count differs");
      }
      var symbols = new Map(), seen = new Set();
      var entries = compiled.entries.map(function (saved, id) {
        if (!Number.isInteger(saved.index) || !records[saved.index] || seen.has(saved.index)) throw new Error("Invalid record index");
        seen.add(saved.index);
        var fields = {}, words = new Set();
        Object.keys(FIELD_WEIGHTS).forEach(function (field) {
          if (!saved.fields || !Array.isArray(saved.fields[field])) throw new Error("Missing field tokens");
          fields[field] = { words: new Set(saved.fields[field]) };
          fields[field].words.forEach(function (word) { words.add(word); });
        });
        if (typeof saved.title !== "string" || !Array.isArray(saved.symbols) || !Array.isArray(saved.defined) || !Array.isArray(saved.aliases)) {
          throw new Error("Invalid compiled record");
        }
        fields.title.text = saved.title;
        var entry = { record: records[saved.index], index: saved.index, fields: fields, words: words, grams: new Set(),
          symbols: new Set(saved.symbols), defined: new Set(saved.defined), aliases: new Set(saved.aliases),
          module: saved.module, mode: saved.mode };
        entry.symbols.forEach(function (symbol) {
          if (!symbols.has(symbol)) symbols.set(symbol, new Set());
          symbols.get(symbol).add(id);
        });
        return entry;
      });
      var postings = new Map();
      compiled.postings.forEach(function (pair) {
        if (!Array.isArray(pair) || typeof pair[0] !== "string" || !/^[wg]:/.test(pair[0]) || !Array.isArray(pair[1])) {
          throw new Error("Invalid posting list");
        }
        var ids = new Set(pair[1]);
        ids.forEach(function (id) {
          if (!Number.isInteger(id) || !entries[id]) throw new Error("Invalid posting reference");
          if (pair[0].slice(0, 2) === "g:") entries[id].grams.add(pair[0].slice(2));
        });
        postings.set(pair[0], ids);
      });
      return { entries: entries, postings: postings, symbols: symbols, suggestions: new Map(compiled.suggestions) };
    }
  
    function create(records, options) {
      options = options || {};
      if (!Array.isArray(records)) throw new TypeError("SDKSearch.create expects an array of records");
      var compiled = options.compiled;
      // Custom tokenization settings travel with a compiled index. Explicit caller
      // settings override them and invalidate the index when they affect tokens.
      options = Object.assign({}, compiled && compiled.options || {}, options);
      var tokenizer = makeTokenizer(options), state = null, restored = false;
      if (compiled && compiled.format === INDEX_FORMAT && compiled.recordCount === records.length &&
          compiled.fingerprint === fingerprint(records, options)) {
        try { state = restoreIndex(records, compiled); restored = true; }
        catch (_error) { state = null; }
      }
      if (!state) state = buildIndex(records, options, tokenizer);
      var entries = state.entries, postings = state.postings, symbols = state.symbols, suggestions = state.suggestions;
      var symbolNames = Array.from(symbols.keys()).sort();
      var wordNames = Array.from(postings.keys()).filter(function (key) { return key.slice(0, 2) === "w:"; }).map(function (key) { return key.slice(2); });
      var wordNamesByLength = new Map();
      wordNames.forEach(function (word) {
        if (!wordNamesByLength.has(word.length)) wordNamesByLength.set(word.length, []);
        wordNamesByLength.get(word.length).push(word);
      });
      var averageFieldLengths = {};
      Object.keys(FIELD_WEIGHTS).forEach(function (field) {
        averageFieldLengths[field] = entries.length ? entries.reduce(function (sum, entry) { return sum + entry.fields[field].words.size; }, 0) / entries.length : 1;
      });
  
      function accepts(entry, settings) {
        var requestedModule = normalize(settings.module), requestedMode = mode(settings.mode);
        return (!settings.manualId || entry.record.manualId === settings.manualId) && (!requestedModule || requestedModule === "all" || requestedModule === "*" || entry.module === requestedModule) &&
          (!requestedMode || requestedMode === "all" || requestedMode === "*" || entry.mode === requestedMode);
      }
      function finalize(results, limit) {
        results.sort(function (a, b) { return b.score - a.score || a._index - b._index; });
        var seen = new Set(), output = [];
        for (var i = 0; i < results.length && output.length < limit; i++) {
          var item = results[i], record = item.record;
          var key = record.url || record.id || item._index;
          if (seen.has(key)) continue;
          seen.add(key);
          output.push({ record: record, score: Math.round(item.score * 100) / 100, reason: item.reason, matchedTerms: item.matchedTerms });
        }
        return output;
      }
      function search(query, settings) {
        settings = settings || {};
        var raw = normalize(query), limit = clampLimit(settings.limit, 20);
        if (!raw || !limit) return [];
        var features = tokenizer.features(query), candidates = new Set(), exact = symbols.get(raw);
        var codeQuery = /^(?:at\+)[a-z0-9_]+$/.test(raw) || /^[a-z_][a-z0-9_]*_[a-z0-9_]*$/.test(raw);
        var numericQuery = /^-?(?:0x[0-9a-f]+|\d+(?:\.\d+)*)$/.test(raw);
        // Known symbols bypass text frequency. A definition always precedes its usages.
        if (exact || codeQuery) {
          var names = exact ? [raw] : symbolNames.filter(function (name) { return name.indexOf(raw) === 0; });
          var direct = [];
          names.forEach(function (name) {
            symbols.get(name).forEach(function (id) {
              var entry = entries[id];
              if (!accepts(entry, settings)) return;
              var defined = entry.defined.has(name), api = /^(api|interface)$/.test(normalize(entry.record.kind));
              direct.push({
                record: entry.record, _index: entry.index,
                score: (exact ? 100000 : 10000) + (defined ? 2000 : api ? 1000 : 0),
                reason: exact ? (defined ? "接口定义精确匹配" : "接口名称精确匹配") : "接口名前缀匹配",
                matchedTerms: [name]
              });
            });
          });
          if (direct.length) return finalize(direct, limit);
          // A misspelled code symbol may not have a prefix hit; let it reach fuzzy token matching.
        }
        if (numericQuery) {
          var numeric = [];
          (postings.get("w:" + raw) || []).forEach(function (id) {
            var entry = entries[id];
            if (accepts(entry, settings)) numeric.push({ record: entry.record, _index: entry.index,
              score: /错误|结果码|返回值/.test(entry.record.title || "") ? 200 : 100,
              reason: "数字精确匹配", matchedTerms: [raw] });
          });
          return finalize(numeric, limit);
        }
        features.words.forEach(function (term) {
          (postings.get("w:" + term) || []).forEach(function (id) { candidates.add(id); });
        });
        features.grams.forEach(function (term) {
          (postings.get("g:" + term) || []).forEach(function (id) { candidates.add(id); });
        });
        if (!features.words.size) return [];
        // Lightweight typo tolerance: match a missing query token to indexed terms
        // within one edit. Exact terms always win; short single-character noise is ignored.
        var fuzzyByEntry = new Map();
        features.words.forEach(function (term) {
          if (postings.has("w:" + term) || term.length < 2 || term.length > 32) return;
          var nearbyTerms = [];
          for (var length = Math.max(2, term.length - 1); length <= term.length + 1; length++) {
            nearbyTerms.push.apply(nearbyTerms, wordNamesByLength.get(length) || []);
          }
          nearbyTerms.forEach(function (candidateTerm) {
            if (candidateTerm === term || !withinOneEdit(term, candidateTerm)) return;
            (postings.get("w:" + candidateTerm) || []).forEach(function (id) {
              candidates.add(id);
              if (!fuzzyByEntry.has(id)) fuzzyByEntry.set(id, []);
              fuzzyByEntry.get(id).push({ queryTerm: term, matchedTerm: candidateTerm });
            });
          });
        });
        var results = [], minCoverage = typeof options.minCoverage === "number" ? options.minCoverage : 2 / 3;
        var requiredTasks = Array.from(features.words).filter(function (term) { return TASK_TERMS.has(term); });
        // Long queries must retain their distinctive topic. Otherwise common words
        // such as “同一” and “文件” can make a build guide match a threading question.
        var rareAnchors = [];
        if (features.words.size >= 3) {
          var leastCount = Infinity;
          features.words.forEach(function (term) {
            var count = (postings.get("w:" + term) || new Set()).size;
            if (count > 0) leastCount = Math.min(leastCount, count);
          });
          if (leastCount !== Infinity && leastCount <= Math.max(2, entries.length * 0.1)) {
            features.words.forEach(function (term) {
              if ((postings.get("w:" + term) || new Set()).size === leastCount) rareAnchors.push(term);
            });
          }
        }
        candidates.forEach(function (id) {
          var entry = entries[id];
          if (!accepts(entry, settings)) return;
          var matched = Array.from(features.words).filter(function (term) { return entry.words.has(term); });
          var fuzzyMatches = fuzzyByEntry.get(id) || [];
          var fuzzyQueryTerms = new Set(fuzzyMatches.map(function (item) { return item.queryTerm; }));
          var coverage = (matched.length + fuzzyQueryTerms.size) / features.words.size;
          var aliasExact = entry.aliases.has(features.text);
          var titleExact = entry.fields.title.text === features.text;
          var titlePhrase = features.text.length >= 2 && entry.fields.title.text.indexOf(features.text) >= 0;
          var needed = features.words.size <= 2 ? 1 : minCoverage;
          if (!aliasExact && !titleExact && (coverage + 1e-9 < needed || (!matched.length && !fuzzyMatches.length))) return;
          if (!aliasExact && !titleExact && !requiredTasks.every(function (term) { return entry.words.has(term); })) return;
          if (!aliasExact && !titleExact && rareAnchors.length && !rareAnchors.some(function (term) { return entry.words.has(term); })) return;
          var score = aliasExact ? 5000 : titleExact ? 6000 : titlePhrase ? 1500 : 0;
          Object.keys(FIELD_WEIGHTS).forEach(function (field) {
            var set = entry.fields[field].words, averageLength = averageFieldLengths[field] || 1;
            var documentLength = set.size, lengthNorm = 1.2 * (0.25 + 0.75 * documentLength / averageLength);
            function addBm25(term, boost) {
              if (!set.has(term)) return;
              var documentFrequency = (postings.get("w:" + term) || new Set()).size;
              var idf = Math.log(1 + (entries.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
              score += FIELD_WEIGHTS[field] * idf * (2.2 / (1 + lengthNorm)) * boost;
            }
            matched.forEach(function (term) { addBm25(term, 1); });
            fuzzyMatches.forEach(function (item) { addBm25(item.matchedTerm, 0.55); });
          });
          var gramHits = 0;
          features.grams.forEach(function (term) { if (entry.grams.has(term)) gramHits++; });
          score += 30 * coverage + Math.min(6, gramHits * 0.3);
          var matchedTerms = matched.concat(fuzzyMatches.map(function (item) { return item.queryTerm + "≈" + item.matchedTerm; }));
          results.push({ record: entry.record, score: score, _index: entry.index,
            reason: aliasExact ? "检索别名匹配" : titleExact || titlePhrase ? "章节标题匹配" : fuzzyMatches.length ? "模糊匹配" : "章节关键词匹配",
            matchedTerms: matchedTerms });
        });
        return finalize(results, limit);
      }
  
      function withinOneEdit(a, b) {
        if (Math.abs(a.length - b.length) > 1) return false;
        var i = 0, j = 0, differences = 0;
        while (i < a.length && j < b.length) {
          if (a[i] === b[j]) { i++; j++; continue; }
          if (++differences > 1) return false;
          if (a.length > b.length) i++;
          else if (b.length > a.length) j++;
          else { i++; j++; }
        }
        return differences + (i < a.length || j < b.length ? 1 : 0) <= 1;
      }
      function suggest(query, requestedLimit, settings) {
        settings = settings || {};
        var eligible = null;
        if (settings.manualId || settings.mode || settings.module) {
          eligible = new Set();
          entries.forEach(function (entry) {
            if (!accepts(entry, settings)) return;
            array(entry.record.symbols).concat(array(entry.record.definedSymbols), array(entry.record.aliases), [entry.record.title]).forEach(function (name) { eligible.add(normalize(name)); });
          });
        }
        var q = normalize(query), limit = clampLimit(requestedLimit, 6), found = [];
        if (!q || !limit || /^-?\d+$/.test(q)) return [];
        suggestions.forEach(function (display, normalized) {
          if (eligible && !eligible.has(normalized)) return;
          var priority = normalized === q ? 0 : normalized.indexOf(q) === 0 ? 1 : normalized.indexOf(q) >= 0 ? 2 : -1;
          if (priority < 0 && q.length >= 5 && /^[a-z0-9_+]+$/.test(q) && withinOneEdit(q, normalized)) priority = 3;
          if (priority >= 0) found.push({ display: display, priority: priority, length: normalized.length });
        });
        found.sort(function (a, b) { return a.priority - b.priority || a.length - b.length || a.display.localeCompare(b.display); });
        return found.slice(0, limit).map(function (item) { return item.display; });
      }
  
      return { search: search, suggest: suggest, count: entries.length, indexStatus: restored ? "restored" : "built" };
    }
    return { create: create, compile: compile, normalize: normalize, version: "1.2.0" };
  }
  const api = { createSdkSearch };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeRetrieval = api;
})(typeof window === 'undefined' ? globalThis : window);

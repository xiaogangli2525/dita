'use strict';
(function (root) {
  const search = typeof module !== 'undefined' ? require('./knowledge-search') : root.DitaKnowledgeSearch;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  function mount(book, engine) {
    const get = id => document.getElementById(id), make = (tag, text, className) => {
      const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node;
    };
    const manuals = new Map(book.manuals.map(manual => [manual.id, manual]));
    const records = book.manuals.flatMap(manual => manual.entries.map(entry => ({ ...entry, manualId: manual.id, manualTitle: manual.title, mode: manual.mode, module: manual.module })));
    let current = '', timer, activeSuggestion = -1;
    const filters = () => ({ mode: get('kbMode').value, module: get('kbModule').value });
    function inScope(record) { return (!get('kbScope').value || record.manualId === get('kbScope').value) && (!get('kbMode').value || record.mode === get('kbMode').value) && (!get('kbModule').value || record.module === get('kbModule').value); }
    function hideSuggestions() { get('kbSuggestions').hidden = true; activeSuggestion = -1; get('kbSearch').setAttribute('aria-expanded', 'false'); get('kbSearch').removeAttribute('aria-activedescendant'); }
    function suggestions() {
      const list = get('kbSuggestions'); list.replaceChildren(); activeSuggestion = -1;
      const values = engine.suggest(records, book.index, get('kbSearch').value, { ...filters(), manualId: get('kbScope').value });
      for (const [index, value] of values.entries()) {
        const button = make('button', value); button.type = 'button'; button.id = 'kbSuggestion-' + index; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', 'false'); button.tabIndex = -1;
        button.addEventListener('click', () => { get('kbSearch').value = value; hideSuggestions(); results(); get('kbSearch').focus(); }); list.append(button);
      }
      list.hidden = !values.length; get('kbSearch').setAttribute('aria-expanded', String(!!values.length));
    }
    function catalog() {
      const list = get('kbSymbolList'), symbolMap = new Map(); list.replaceChildren();
      const needle = get('kbSymbolQuery').value.trim().toLowerCase();
      for (const record of records.filter(inScope)) {
        const info = engine.metadata(record);
        for (const symbol of info.symbols) {
          if (needle && !symbol.toLowerCase().includes(needle)) continue;
          const defined = info.definedSymbols.includes(symbol), key = symbol.toLowerCase();
          if (!symbolMap.has(key) || defined && !symbolMap.get(key).defined) symbolMap.set(key, { symbol, record, defined });
        }
      }
      const values = [...symbolMap.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
      get('kbSymbolCount').textContent = values.length + ' 个符号' + (values.length > 150 ? ' · 仅显示前 150 个，请输入前缀缩小范围' : '');
      for (const item of values.slice(0, 150)) {
        const button = make('button', undefined, 'symbol-item'); button.type = 'button'; button.append(make('code', item.symbol), make('small', item.record.manualTitle + ' · ' + (item.defined ? '定义' : '出现位置')));
        button.addEventListener('click', () => { get('kbSymbols').hidden = true; get('kbCatalogToggle').setAttribute('aria-expanded', 'false'); route(item.record.manualId, item.record.anchor); }); list.append(button);
      }
      if (!values.length) list.append(make('p', '当前范围没有匹配符号。', 'empty'));
    }
    function route(id = '', anchor = '') {
      const params = new URLSearchParams(); if (id) params.set('manual', id); if (anchor) params.set('anchor', anchor);
      const next = '#' + params.toString(); if (location.hash === next) renderRoute(); else location.hash = next;
      document.body.classList.remove('nav-open');
    }
    function highlight(node, text, query) {
      const words = engine.tokens(query, true).sort((a, b) => b.length - a.length);
      if (!words.length) { node.textContent = text; return; }
      const escaped = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      const regex = new RegExp(escaped.join('|'), 'gi'); let last = 0;
      for (const match of text.matchAll(regex)) {
        node.append(document.createTextNode(text.slice(last, match.index)), make('mark', match[0])); last = match.index + match[0].length;
      }
      node.append(document.createTextNode(text.slice(last)));
    }
    function home() {
      current = ''; get('kbReading').hidden = true; get('kbResults').hidden = true; get('kbHome').hidden = false;
      get('kbBreadcrumb').textContent = '文档中心'; get('kbBack').hidden = true; get('kbArticleToc').replaceChildren();
      document.querySelectorAll('[aria-current]').forEach(node => node.removeAttribute('aria-current'));
    }
    async function copy(text, button) {
      let timer;
      try {
        if (navigator.clipboard?.writeText) await Promise.race([navigator.clipboard.writeText(text), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('clipboard timeout')), 1200); })]);
        else throw Error('clipboard unavailable');
      } catch {
        const field = make('textarea'); field.value = text; field.style.position = 'fixed'; field.style.opacity = '0'; document.body.append(field); field.select();
        const ok = document.execCommand('copy'); field.remove(); button.focus();
        if (!ok) { button.textContent = '请选中代码复制'; return; }
      } finally { clearTimeout(timer); }
      button.textContent = '已复制'; setTimeout(() => { button.textContent = '复制代码'; }, 1600);
    }
    function read(manual, anchor) {
      current = manual.id; get('kbHome').hidden = true; get('kbResults').hidden = true; get('kbReading').hidden = false;
      get('kbBack').hidden = !get('kbSearch').value.trim(); get('kbBreadcrumb').textContent = '文档中心 / ' + manual.title;
      get('kbManualTitle').textContent = manual.title;
      get('kbManualMeta').textContent = [book.model, manual.version ? '文档 ' + manual.version : '', manual.source.repository, manual.source.commit ? 'Git ' + manual.source.commit.slice(0, 8) + (manual.source.dirty ? ' · 含未提交内容' : '') : '未取得 Git 提交'].filter(Boolean).join('  ·  ');
      const article = get('kbArticle'); article.innerHTML = manual.body;
      const query = get('kbSearch').value.trim(), words = engine.tokens(query, true), nodes = [];
      if (words.length) {
        const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT); let node;
        while ((node = walker.nextNode()) && nodes.length < 300) if (words.some(word => node.data.toLowerCase().includes(word))) nodes.push(node);
        for (const text of nodes) { const fragment = document.createDocumentFragment(); highlight(fragment, text.data, query); text.replaceWith(fragment); }
      }
      for (const link of article.querySelectorAll('a[href]')) if (!link.getAttribute('href').startsWith('#')) { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      for (const pre of article.querySelectorAll('pre')) {
        const wrapper = make('div', undefined, 'code-frame'), button = make('button', '复制代码', 'code-copy'); button.type = 'button';
        const text = pre.textContent; button.addEventListener('click', () => { void copy(text, button); }); pre.before(wrapper); wrapper.append(button, pre);
      }
      for (const table of [...article.querySelectorAll('table')]) { const wrapper = make('div', undefined, 'table-scroll'); table.before(wrapper); wrapper.append(table); }
      get('kbArticleToc').replaceChildren(make('span', '本手册', 'eyebrow'));
      for (const entry of manual.toc) { const button = make('button', entry.title); button.type = 'button'; button.addEventListener('click', () => route(manual.id, entry.anchor)); get('kbArticleToc').append(button); }
      for (const button of document.querySelectorAll('[data-kb-manual]')) { if (button.dataset.kbManual === manual.id) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }
      const target = anchor && document.getElementById(anchor);
      if (target && article.contains(target)) { target.scrollIntoView({ block: 'start' }); target.classList.add('anchor-focus'); }
      else window.scrollTo(0, 0);
    }
    function renderRoute() {
      const params = new URLSearchParams(location.hash.slice(1)), manual = manuals.get(params.get('manual'));
      if (manual) read(manual, params.get('anchor')); else home();
    }
    function results() {
      clearTimeout(timer); const query = get('kbSearch').value.trim().slice(0, 200);
      if (!query) { renderRoute(); return; }
      const start = performance.now(), matches = engine.search(records, book.index, query, get('kbScope').value, 40, filters());
      get('kbHome').hidden = true; get('kbReading').hidden = true; get('kbResults').hidden = false; get('kbBack').hidden = true;
      get('kbBreadcrumb').textContent = '文档中心 / 搜索';
      get('kbSearchTitle').textContent = '搜索“' + query + '”';
      get('kbSearchMeta').textContent = (matches.length === 40 ? '前 40 个结果' : matches.length + ' 个结果') + ' · ' + book.model + ' · ' + Math.round(performance.now() - start) + ' ms';
      const list = get('kbResultList'); list.replaceChildren();
      if (!matches.length) { list.append(make('p', '没有找到匹配内容。可尝试完整 AT 命令、参数名，或更短的关键词。', 'empty')); return; }
      for (const match of matches) {
        const record = records[match.position], button = make('button', undefined, 'search-result'); button.type = 'button';
        const heading = make('strong'), excerpt = make('p'); highlight(heading, record.title, query); highlight(excerpt, engine.excerpt(record.text, query), query);
        button.append(make('small', record.manualTitle + '  /  ' + match.reason), heading, excerpt, make('span', '查看原文 →', 'result-link'));
        button.addEventListener('click', () => route(record.manualId, record.anchor)); list.append(button);
      }
    }
    for (const manual of book.manuals) {
      const option = make('option', manual.title); option.value = manual.id; get('kbScope').append(option);
      const group = make('details', undefined, 'nav-group'); group.open = book.manuals.length === 1;
      const summary = make('summary', manual.title), overview = make('button', '手册概览', 'nav-overview'); overview.type = 'button'; overview.dataset.kbManual = manual.id;
      overview.addEventListener('click', () => route(manual.id)); group.append(summary, overview);
      for (const entry of manual.toc) { const button = make('button', entry.title); button.type = 'button'; button.addEventListener('click', () => route(manual.id, entry.anchor)); group.append(button); }
      get('kbNavigation').append(group);
      const card = make('button', undefined, 'manual-card'); card.type = 'button';
      card.append(make('span', '功能手册', 'eyebrow'), make('strong', manual.title), make('p', manual.entries.length + ' 个章节 · ' + (manual.version || '随 SDK 发布')), make('span', '开始阅读 ↗', 'card-link'));
      card.addEventListener('click', () => route(manual.id)); get('kbManualCards').append(card);
    }
    get('kbSearch').addEventListener('input', () => { clearTimeout(timer); suggestions(); timer = setTimeout(results, 100); });
    get('kbSearch').addEventListener('keydown', event => {
      const choices = [...get('kbSuggestions').children];
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && choices.length && !get('kbSuggestions').hidden) {
        event.preventDefault(); activeSuggestion = activeSuggestion < 0 ? (event.key === 'ArrowDown' ? 0 : choices.length - 1) : (activeSuggestion + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
        choices.forEach((choice, index) => choice.setAttribute('aria-selected', String(index === activeSuggestion)));
        get('kbSearch').setAttribute('aria-activedescendant', choices[activeSuggestion].id);
      }
      if (event.key === 'Enter') { event.preventDefault(); if (activeSuggestion >= 0) get('kbSearch').value = choices[activeSuggestion].textContent; hideSuggestions(); results(); }
      if (event.key === 'Escape') { if (!get('kbSuggestions').hidden) hideSuggestions(); else { get('kbSearch').value = ''; renderRoute(); } }
    });
    get('kbSearch').addEventListener('focus', suggestions);
    document.addEventListener('click', event => { if (!event.target.closest('.search-area')) hideSuggestions(); });
    for (const id of ['kbScope', 'kbMode', 'kbModule']) get(id).addEventListener('change', () => { hideSuggestions(); results(); if (!get('kbSymbols').hidden) catalog(); });
    for (const value of [...new Set(records.map(record => record.module).filter(Boolean))].sort()) { const option = make('option', value); option.value = value; get('kbModule').append(option); }
    get('kbCatalogToggle').addEventListener('click', () => { get('kbSymbols').hidden = !get('kbSymbols').hidden; get('kbCatalogToggle').setAttribute('aria-expanded', String(!get('kbSymbols').hidden)); if (!get('kbSymbols').hidden) { catalog(); get('kbSymbolQuery').focus(); } });
    get('kbSymbolQuery').addEventListener('input', catalog); get('kbBack').addEventListener('click', results);
    get('kbHomeButton').addEventListener('click', () => { get('kbSearch').value = ''; hideSuggestions(); route(); });
    get('kbMenu').addEventListener('click', () => document.body.classList.toggle('nav-open'));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') document.body.classList.remove('nav-open'); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); get('kbSearch').focus(); } });
    get('kbArticle').addEventListener('click', event => { const link = event.target.closest('a[href^="#"]'); if (link && current) { event.preventDefault(); route(current, link.getAttribute('href').slice(1)); } });
    window.addEventListener('hashchange', renderRoute); renderRoute();
  }
  function renderPage(book) {
    const css = `
.search-area{position:relative;flex:1;min-width:180px;max-width:620px}.search-area .searchbox{max-width:none}.suggestions{position:absolute;top:calc(100% + 7px);left:0;right:0;border:1px solid #dbe6dd;border-radius:9px;padding:6px;background:#fff;box-shadow:0 10px 28px #193e2915;z-index:8}.suggestions button{display:block;width:100%;border:0;border-radius:5px;background:white;padding:9px 11px;text-align:left;overflow-wrap:anywhere;font:12px/1.6 Consolas,"Microsoft YaHei",monospace}.suggestions button:hover,.suggestions button[aria-selected=true]{background:#edf4ed;color:#126b55}.filterbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:-10px 0 25px}.filterbar label{font-size:11px;color:#607064;display:flex;align-items:center;gap:7px}.filterbar select{max-width:190px;padding:5px 8px;font-size:11px}.catalog-toggle{margin-left:auto;border:1px solid #dfe8e1;border-radius:6px;padding:6px 12px;background:white;color:#246d56;font-size:12px}.symbol-panel{border:1px solid #dfe8e1;border-radius:10px;padding:20px;margin-bottom:28px;background:#f8faf7}.symbol-panel h2{margin:0 0 6px;font-size:18px}.symbol-panel p{font-size:11px;color:#607064}.symbol-panel input{width:100%;border:1px solid #dfe8e1;border-radius:6px;padding:9px 12px;background:white}.symbol-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:8px;max-height:360px;overflow:auto;margin-top:14px}.symbol-item{background:white;border:1px solid #e1e9e2;border-radius:7px;padding:11px;text-align:left;overflow-wrap:anywhere}.symbol-item code{color:#1d6b50;font-size:12px}.symbol-item small{display:block;font-size:10px;color:#607064;margin-top:4px}

*{box-sizing:border-box}body{margin:0;background:#fff;color:#243438;font:14px/1.7 Inter,"Segoe UI","Microsoft YaHei",sans-serif}button,input,select{font:inherit}button{cursor:pointer}button,a,input,select{outline-offset:4px}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #15756f}button{color:inherit}a{color:#17766f}button[hidden],[hidden]{display:none!important}.sidebar{position:fixed;inset:0 auto 0 0;width:258px;background:#f6f8f7;border-right:1px solid #e3e9e6;display:flex;flex-direction:column;padding:29px 18px 20px;z-index:4}.brand{display:flex;gap:12px;align-items:center;padding:0 12px 24px}.brand-mark{display:grid;place-items:center;width:36px;height:36px;background:#146b62;border-radius:10px;color:#fff;font:bold 25px Georgia}.brand strong{font-size:16px;letter-spacing:.3px}.brand small{display:block;color:#65756f;font-size:11px;letter-spacing:1px}.nav-home{background:none;border:0;text-align:left;padding:11px 12px;border-radius:7px;font-weight:600}.nav-home:hover{background:#e8efec}.nav-label{padding:26px 12px 8px;color:#607064;font-size:10px;letter-spacing:1.6px}.navigation{overflow:auto;flex:1}.nav-group{margin:2px 0 11px}.nav-group summary{padding:8px 11px;font-weight:600;cursor:pointer}.nav-group button{display:block;width:100%;padding:6px 12px 6px 27px;border:0;background:none;text-align:left;font-size:12px;color:#586b63;overflow-wrap:anywhere;line-height:1.6}.nav-group button:hover,.nav-group button[aria-current]{background:#e5efea;color:#116358;border-radius:5px}.nav-group .nav-overview{font-weight:600}.sidebar-bottom{border-top:1px solid #dfe7e2;margin-top:20px;padding:17px 12px 0;color:#607064;font-size:11px}.offline-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#2c9a72;margin-right:6px}.shell{margin-left:258px}.topbar{position:sticky;top:0;z-index:3;background:rgba(255,255,255,.97);border-bottom:1px solid #e8eeeb;min-height:76px;display:flex;align-items:center;gap:14px;padding:17px 40px}.searchbox{display:flex;align-items:center;gap:12px;max-width:620px;width:100%;background:#f6f8f7;border:1px solid #e1e9e4;border-radius:9px;padding:9px 14px;color:#6c7b73}.searchbox svg{flex-shrink:0}.searchbox input{width:100%;background:none;border:0;color:#243438;outline:none}.searchbox:focus-within{border-color:#288579;box-shadow:0 0 0 3px #eaf3ef}.searchbox kbd{font-size:10px;white-space:nowrap;border:1px solid #dce5df;border-radius:4px;padding:0 4px;color:#607064}.scope{background:#fff;border:1px solid #e1e9e4;border-radius:7px;padding:8px;max-width:180px;font-size:12px}.model-pill{margin-left:auto;white-space:nowrap;font-size:11px;color:#176556;background:#edf5ef;border:1px solid #d9e8dc;border-radius:20px;padding:4px 11px}.menu-button{display:none;border:0;background:transparent;font-size:20px}.main{max-width:1370px;margin:auto;padding:27px 44px 60px}.breadcrumb{font-size:11px;color:#7a8780;margin-bottom:34px}.hero{padding:5px 0 35px}.eyebrow{font-size:10px;letter-spacing:1.6px;color:#607064;text-transform:uppercase}.hero h1{font-size:36px;line-height:1.3;letter-spacing:-1px;margin:13px 0 17px;font-weight:650;max-width:800px}.hero p{color:#68786e;max-width:640px;font-size:14px;line-height:1.9}.version-row{display:flex;gap:20px;flex-wrap:wrap;font-size:11px;color:#607064;margin-top:24px}.section-heading{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e9eeea;padding-top:23px;margin-bottom:17px}.section-heading h2{font-size:15px;font-weight:600;margin:0}.section-heading span{font-size:11px;color:#607064}.manual-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:16px}.manual-card{text-align:left;background:white;border:1px solid #dfe8e1;border-radius:12px;padding:25px 24px;min-height:190px;transition:transform .15s,border-color .15s,box-shadow .15s}.manual-card:hover{transform:translateY(-2px);border-color:#83ac94;box-shadow:0 7px 24px #1c4a2a09}.manual-card strong{display:block;font-size:20px;margin:13px 0 8px;line-height:1.4}.manual-card p{font-size:12px;color:#607064;margin:0 0 19px}.card-link{font-size:12px;color:#197264}.release-note{margin-top:34px;padding:18px 21px;background:#f6f8f4;border-radius:9px;color:#607064;font-size:12px}.release-note strong{color:#4c6656;margin-right:9px}.search-title{font-size:25px;margin:0 0 8px}.search-meta{font-size:12px;color:#607064;margin:0 0 25px}.search-result{display:block;width:100%;text-align:left;border:1px solid #e1e9e3;border-radius:10px;background:white;margin-bottom:13px;padding:22px 24px}.search-result:hover{border-color:#7aa98b;background:#fbfdfb}.search-result small{color:#607064;font-size:11px}.search-result strong{display:block;font-size:18px;margin:8px 0}.search-result p{margin:0;color:#68796d;font-size:13px;line-height:1.9}.result-link{display:block;margin-top:11px;color:#27745c;font-size:11px}mark{color:inherit;background:#e8f1cf;border-radius:2px;padding:0 1px}.empty{padding:40px 15px;color:#607064}.reading-header{border-bottom:1px solid #e8eee9;padding-bottom:24px;margin-bottom:28px}.reading-header h1{font-size:30px;line-height:1.4;margin:9px 0 13px}.reading-header p{font-size:11px;color:#607064;overflow-wrap:anywhere}.back-button{background:none;border:0;padding:0;color:#348068;font-size:12px;margin-bottom:14px}.reading-grid{display:grid;grid-template-columns:minmax(0,1fr) 170px;gap:35px}.article{min-width:0;font-size:14px;line-height:1.95;color:#2f3d34}.article h2{font-size:23px;font-weight:600;border-bottom:1px solid #e3ebe4;margin:37px 0 19px;padding:0 0 10px;line-height:1.6}.article h2:first-child{margin-top:0}.article h3{font-size:18px;margin-top:28px}.article [id]{scroll-margin-top:100px}.article pre,.article .code-block{font:12px/1.8 Consolas,"Noto Sans Mono CJK SC",monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f7f5;border:1px solid #e3e9e2;border-radius:7px;padding:15px 17px;color:#314b3a}.article code{font:12px Consolas,monospace;color:#24634d;overflow-wrap:anywhere}.article table{border-collapse:collapse;width:100%;font-size:13px}.article td,.article th{border:1px solid #dfe7df;padding:9px 12px;vertical-align:top;overflow-wrap:anywhere}.article th,.article thead td{background:#f2f6f1;font-weight:600}.article .table-scroll{overflow-x:auto;margin:18px 0}.article img{max-width:100%;height:auto}.article .dita-note{background:#f3f7f2;border-left:3px solid #8aa688;padding:13px 17px;margin:19px 0;border-radius:0 6px 6px 0}.article .note-label{display:block;font-weight:600;margin-bottom:5px}.article .note-body>:first-child{margin-top:0}.article .note-body>:last-child{margin-bottom:0}.article .export-footnotes{border-top:1px solid #dae4d9;margin-top:40px;font-size:12px}.article .export-footnotes li{padding:10px 8px;margin:8px 0}.article .fn-ref{font-size:10px}.article .footnote-backlink{display:inline-block;font-size:11px;margin-top:7px}.article hr{border:0;border-top:1px solid #edf1ec;margin:30px 0}.article-toc{position:sticky;top:110px;align-self:start;border-left:1px solid #e5ece5;padding-left:17px;max-height:70vh;overflow:auto}.article-toc button{display:block;width:100%;border:0;background:none;text-align:left;color:#607064;font-size:11px;line-height:1.6;padding:6px 0;overflow-wrap:anywhere}.article-toc button:hover{color:#1b6b4b}.article-toc .eyebrow{display:block;margin-bottom:8px}.code-frame{position:relative}.code-frame pre{padding-top:35px}.code-copy{position:absolute;right:9px;top:8px;background:#fff;border:1px solid #dde7dd;border-radius:5px;color:#607064;font-size:10px;padding:2px 7px}.anchor-focus{animation:glow 1.6s ease-out}@keyframes glow{from{background:#eef6d8}to{background:transparent}}.page-footer{margin-top:40px;border-top:1px solid #e8eee7;padding-top:20px;color:#607064;font-size:10px;display:flex;gap:20px;justify-content:space-between} @media(max-width:1150px){.reading-grid{grid-template-columns:minmax(0,1fr)}.article-toc{display:none}.topbar{padding:17px 25px}.main{padding:25px 30px}.searchbox kbd{display:none}}@media(max-width:760px){.sidebar{transform:translateX(-100%);box-shadow:8px 0 30px #18371c10;transition:transform .15s}.nav-open .sidebar{transform:translateX(0)}.shell{margin-left:0}.menu-button{display:block}.topbar{padding:13px 15px;gap:8px;flex-wrap:wrap}.searchbox{flex:1;min-width:170px}.scope{max-width:130px}.model-pill{display:none}.main{padding:22px 21px}.hero h1{font-size:28px}.manual-grid{grid-template-columns:1fr}.breadcrumb{margin-bottom:24px}.page-footer{flex-wrap:wrap}}`;
    const json = JSON.stringify(book).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const count = book.manuals.reduce((sum, manual) => sum + manual.entries.length, 0);
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(book.title)}</title><style>${css}</style></head><body>
<aside class="sidebar"><div class="brand"><span class="brand-mark">m.</span><div><strong>开发者文档</strong><small>MODULE DOCUMENTATION</small></div></div><button id="kbHomeButton" class="nav-home" type="button">⌂ &nbsp; 文档中心</button><div class="nav-label">功能与手册</div><nav id="kbNavigation" class="navigation" aria-label="功能手册目录"></nav><div class="sidebar-bottom"><span class="offline-dot"></span>离线可用 · 无需连接服务器<br>${escape(book.model)} / SDK ${escape(book.sdkVersion)}</div></aside>
<div class="shell"><header class="topbar"><button id="kbMenu" class="menu-button" type="button" aria-label="打开或关闭文档目录">☰</button><div class="search-area"><label class="searchbox"><svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="m12 12 5 5" stroke="currentColor" stroke-width="1.5"/></svg><input id="kbSearch" type="search" maxlength="200" aria-label="搜索知识库" placeholder="搜索命令、参数或使用方法…" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="kbSuggestions" aria-expanded="false"><kbd>Ctrl K</kbd></label><div id="kbSuggestions" class="suggestions" role="listbox" aria-label="搜索建议" hidden></div></div><select id="kbScope" class="scope" aria-label="搜索范围"><option value="">全部手册</option></select><span class="model-pill">${escape(book.model)}</span></header>
<main class="main"><div id="kbBreadcrumb" class="breadcrumb">文档中心</div><div class="filterbar"><label>开发方式<select id="kbMode" class="scope"><option value="">全部方式</option><option value="AT">AT 命令</option><option value="OC">OpenCPU</option><option value="other">通用</option></select></label><label>功能模块<select id="kbModule" class="scope"><option value="">全部模块</option></select></label><button id="kbCatalogToggle" class="catalog-toggle" type="button" aria-expanded="false" aria-controls="kbSymbols">命令 / API 索引</button></div><section id="kbSymbols" class="symbol-panel" hidden><h2>命令与接口索引</h2><p>正式定义优先定位；未确认定义的符号显示原文出现位置。</p><input id="kbSymbolQuery" type="search" aria-label="筛选接口或命令" placeholder="输入前缀，如 AT+MHTTP、cm_fs_" maxlength="200"><p id="kbSymbolCount" role="status"></p><div id="kbSymbolList" class="symbol-list"></div></section><section id="kbHome"><div class="hero"><span class="eyebrow">DEVELOPER KNOWLEDGE BASE</span><h1>${escape(book.title)}</h1><p>从接口说明到使用示例，快速找到开发所需的内容。手册按本次发布配置筛选，搜索与阅读使用同一份发布内容。</p><div class="version-row"><span>SDK ${escape(book.sdkVersion)}</span><span>${book.manuals.length} 份功能手册</span><span>${count} 个可检索章节</span></div></div><div class="section-heading"><h2>浏览功能手册</h2><span>按功能组织，随版本交付</span></div><div id="kbManualCards" class="manual-grid"></div><div class="release-note"><strong>关于此版本</strong>内容固定于本次发布快照。可搜索完整 AT 命令、参数名和中文关键词，结果可直接定位原文。</div></section>
<section id="kbResults" hidden><h1 id="kbSearchTitle" class="search-title"></h1><p id="kbSearchMeta" class="search-meta" role="status"></p><div id="kbResultList"></div></section><section id="kbReading" hidden><button id="kbBack" class="back-button" type="button" hidden>← 返回搜索结果</button><div class="reading-header"><span class="eyebrow">FUNCTION MANUAL</span><h1 id="kbManualTitle"></h1><p id="kbManualMeta"></p></div><div class="reading-grid"><article id="kbArticle" class="article"></article><aside id="kbArticleToc" class="article-toc" aria-label="本手册章节"></aside></div></section><footer class="page-footer"><span>${escape(book.model)} · SDK ${escape(book.sdkVersion)}</span><span>由 DITA 文档工作台生成 · ${escape(book.generatedAt.slice(0, 10))}</span></footer></main></div>
<script>(${mount.toString()})(${json},${search.runtimeSource()});</script></body></html>`;
  }
  const api = { renderPage };
  if (typeof module !== 'undefined') module.exports = api; else root.DitaKnowledgeReader = api;
})(typeof window === 'undefined' ? globalThis : window);

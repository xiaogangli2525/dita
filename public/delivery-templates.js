'use strict';
(function (root) {
  function createController({ api, changed }) {
    const core = root.DitaTemplateCore, get = id => document.getElementById(id), dialog = get('templateDialog');
    let library = [], context = null, generation = 0, editing = 0, pending = false, draft = null, opener = null;
    const metadata = { 'manual.title': 'exportTitle', 'manual.releaseDate': 'exportDate', 'manual.documentId': 'exportDocumentId', 'manual.classification': 'exportClassification', 'company.name': 'exportCompany' };
    const pageOptions = { '': '无', 'company.name': '企业名称', 'manual.title': '手册标题', 'manual.model': '适用型号', 'manual.version': '文档版本', 'manual.releaseDate': '发布日期', 'manual.documentId': '文档编号', 'manual.classification': '文档级别', 'page.current': '当前页', 'page.total': '总页数', 'page.currentTotal': '当前页 / 总页数' };
    for (const part of ['Header', 'Footer']) for (const side of ['Left', 'Center', 'Right']) get('template' + part + side).replaceChildren(...Object.entries(pageOptions).map(([value, label]) => new Option(label, value)));
    const active = () => library.find(item => core.key(item.package) === get('exportTemplate').value);
    const storageKey = () => 'dita.template-choice.v1:' + JSON.stringify([context.root, context.branch, context.path]);
    function warn(message) { get('exportTemplateWarning').textContent = message; get('exportTemplateWarning').hidden = !message; }
    function remember() {
      if (!context) return;
      const fields = Object.fromEntries(Object.entries(metadata).map(([field, id]) => [field, get(id).value]));
      try { localStorage.setItem(storageKey(), JSON.stringify({ key: get('exportTemplate').value, fields })); }
      catch { warn('模板和信息仅保留在本页，浏览器偏好存储不可用。模板包本身仍保存在服务端。'); }
    }
    function invalidate() { remember(); describe(); changed(); }
    function describe() {
      const item = active();
      get('exportTemplateInfo').textContent = item ? `${item.package.page.size} · ${item.package.cover.enabled ? '含封面' : '无封面'} · ${item.package.watermark.enabled ? '水印已启用' : '无水印'} · v${item.package.version} · ${item.sha256.slice(0, 10)}` : '沿用简洁版式。企业模板目前用于 PDF；切换模板不会修改原始 DITA。';
      get('exportTemplateFields').hidden = !item;
      get('templateShare').disabled = !item;
      if (item?.package.watermark.enabled && !item.package.watermark.asset && item.package.watermark.text === 'company.name' && !get('exportCompany').value.trim()) get('exportTemplateInfo').textContent += ' · 填写企业名称后显示文字水印';
    }
    function format(format) { get('exportTemplatePanel').hidden = format !== 'pdf'; }
    async function load(next) {
      const id = ++generation, workspace = api.token;
      context = next; library = []; get('exportTemplate').replaceChildren(new Option('沿用简洁版式', '')); warn('');
      for (const [field, element] of Object.entries(metadata)) get(element).value = field === 'manual.title' ? next.title : '';
      try {
        const response = await api.request('/api/templates'); if (!response.ok) throw Error(await api.error(response));
        const value = await response.json();
        if (id !== generation || workspace !== api.token) return;
        library = value.templates.map(item => ({ ...item, package: core.normalizePackage(item.package) }));
        for (const item of library) get('exportTemplate').add(new Option(item.package.name + ' · ' + item.package.version, core.key(item.package)));
        if (value.warnings.length || value.temporary) warn([value.temporary ? '演示模式：导入模板只保留至服务重启。' : '', ...value.warnings].filter(Boolean).join('；'));
        let saved;
        try { saved = JSON.parse(localStorage.getItem(storageKey()) || 'null'); }
        catch { warn('模板选择备份无法读取，本次使用简洁版式；原始浏览器数据仍保留。'); }
        if (saved) {
          if (typeof saved.key !== 'string' || !saved.fields || typeof saved.fields !== 'object') throw Error('模板选择备份格式无效，请重新选择模板。');
          if (saved.key && !library.some(item => core.key(item.package) === saved.key)) { get('exportTemplate').add(new Option('缺少模板 · ' + saved.key, saved.key)); warn('原绑定模板不可用，请导入原版本或明确选择其他版式。'); }
          get('exportTemplate').value = saved.key;
          for (const [field, element] of Object.entries(metadata)) if (typeof saved.fields[field] === 'string' && saved.fields[field].length <= 160) get(element).value = saved.fields[field];
        }
      } catch (error) { if (id === generation) { get('exportTemplate').add(new Option('模板不可用 · 请重新选择', '__unavailable__')); get('exportTemplate').value = '__unavailable__'; warn('模板库读取失败：' + error.message); } }
      finally { if (id === generation) { format(get('exportFormat').value); describe(); } }
    }
    function capture(format, values) {
      if (format !== 'pdf' || !get('exportTemplate').value) return null;
      const item = active(); if (!item) throw Error('所选模板不可用，请导入原版本或选择其他版式。');
      return core.capture(item.package, { ...Object.fromEntries(Object.entries(metadata).map(([field, element]) => [field, get(element).value])), 'manual.model': values.model, 'manual.version': values.version });
    }
    function renderEditor() {
      const p = draft;
      get('templateId').value = p.id; get('templateName').value = p.name; get('templateVersion').value = p.version;
      get('templateCompany').value = p.company.name; get('templatePaper').value = p.page.size; get('templateLayout').value = p.cover.layout;
      get('templatePrimary').value = p.colors.primary; get('templateAccent').value = p.colors.accent;
      get('templateCover').checked = p.cover.enabled; get('templateWatermark').checked = p.watermark.enabled; get('templateOpacity').value = p.watermark.opacity;
      get('templateFrontFooter').checked = p.regions.frontMatter.footer;
      get('templateBodyHeader').checked = p.regions.body.header; get('templateBodyFooter').checked = p.regions.body.footer; get('templateHeaderRule').checked = p.header.rule;
      for (const part of ['Header', 'Footer']) for (const side of ['Left', 'Center', 'Right']) get('template' + part + side).value = p[part.toLowerCase()][side.toLowerCase()];
      for (const [id, path] of [['templateLogoStatus', p.company.logo], ['templateBackgroundStatus', p.cover.background], ['templateWatermarkStatus', p.watermark.asset]]) get(id).textContent = path || '未设置';
    }
    function edited() {
      const p = JSON.parse(JSON.stringify(draft));
      p.id = get('templateId').value.trim(); p.name = get('templateName').value.trim(); p.version = get('templateVersion').value.trim(); p.company.name = get('templateCompany').value.trim();
      p.page.size = get('templatePaper').value; p.cover.layout = get('templateLayout').value; p.colors.primary = get('templatePrimary').value; p.colors.accent = get('templateAccent').value;
      p.cover.enabled = get('templateCover').checked; p.watermark.enabled = get('templateWatermark').checked; p.watermark.opacity = Number(get('templateOpacity').value); p.regions.frontMatter.footer = get('templateFrontFooter').checked;
      p.regions.body.header = get('templateBodyHeader').checked; p.regions.body.footer = get('templateBodyFooter').checked; p.header.rule = get('templateHeaderRule').checked;
      for (const part of ['Header', 'Footer']) for (const side of ['Left', 'Center', 'Right']) p[part.toLowerCase()][side.toLowerCase()] = get('template' + part + side).value;
      return core.normalizePackage(p);
    }
    function open() {
      editing++;
      opener = document.activeElement; draft = JSON.parse(JSON.stringify(active()?.package || core.builtins()[0]));
      draft.id = 'company-manual'; draft.name = '我的企业模板'; draft.version = '1.0.0';
      if (!draft.company.name) draft.company.name = get('exportCompany').value;
      renderEditor(); get('templateError').textContent = ''; dialog.showModal(); get('templateName').focus();
    }
    async function install() {
      if (pending) return;
      const token = api.token, owner = context, ticket = editing, pack = edited();
      setPending(true);
      try {
        const response = await api.request('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pack) });
        if (!response.ok) throw Error(await api.error(response));
        const value = await response.json();
        if (token !== api.token || owner !== context || ticket !== editing || !dialog.open) return;
        const key = core.key(value.package); library = library.filter(item => core.key(item.package) !== key); library.push(value);
        if (![...get('exportTemplate').options].some(option => option.value === key)) get('exportTemplate').add(new Option(pack.name + ' · ' + pack.version, key));
        get('exportTemplate').value = key; get('exportCompany').value = pack.company.name; invalidate(); dialog.close();
      } finally { setPending(false); }
    }
    function setPending(value) { pending = value; get('templateSave').disabled = value; get('templateDownload').disabled = value; get('templateDetails').disabled = value; }
    async function asset(input, property, label) {
      const file = input.files[0]; if (!file) return;
      if (pending) { input.value = ''; return; }
      const id = editing; setPending(true);
      try {
        if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 500000) throw Error('请选择不超过 500 KB 的 PNG/JPEG 图片');
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('图片读取失败')); reader.readAsDataURL(file); });
        const picture = new Image(); picture.src = data; await picture.decode();
        if (id !== editing || !dialog.open) return;
        if (picture.naturalWidth > 8000 || picture.naturalHeight > 8000) throw Error('模板图片尺寸请限制在 8000 像素以内');
        const parts = property.split('.'), pack = edited(), old = pack[parts[0]][parts[1]], name = 'assets/' + label + (file.type === 'image/png' ? '.png' : '.jpg');
        if (old) delete pack.assets[old]; pack.assets[name] = data; pack[parts[0]][parts[1]] = name;
        draft = core.normalizePackage(pack); renderEditor(); get('templateError').textContent = '';
      } catch (error) { if (id === editing) get('templateError').textContent = error.message; }
      finally { input.value = ''; setPending(false); }
    }
    get('exportTemplate').addEventListener('change', () => { const item = active(); if (item?.package.company.name) get('exportCompany').value = item.package.company.name; invalidate(); });
    for (const element of Object.values(metadata)) get(element).addEventListener('input', invalidate);
    get('templateManage').addEventListener('click', open);
    get('templateShare').addEventListener('click', () => { const pack = active()?.package; if (pack) root.DitaBrowserFiles.downloadText(JSON.stringify(pack, null, 2), core.key(pack) + '.dita-template.json', 'application/json'); });
    get('templateClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { if (!dialog.open) { editing++; opener?.focus({ preventScroll: true }); } });
    get('modelExportDialog').addEventListener('close', () => { if (!get('modelExportDialog').open) { generation++; if (dialog.open) dialog.close(); } });
    get('templateForm').addEventListener('submit', event => { event.preventDefault(); try { void install().catch(error => { get('templateError').textContent = error.message; }); } catch (error) { get('templateError').textContent = error.message; } });
    get('templateDownload').addEventListener('click', () => { try { const pack = edited(); root.DitaBrowserFiles.downloadText(JSON.stringify(pack, null, 2), core.key(pack) + '.dita-template.json', 'application/json'); } catch (error) { get('templateError').textContent = error.message; } });
    get('templateImport').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      const id = editing; setPending(true);
      try { if (file.size > 2200000) throw Error('模板包过大'); const pack = core.normalizePackage(JSON.parse(await file.text())); if (id !== editing || !dialog.open) return; draft = pack; renderEditor(); get('templateError').textContent = '已载入模板包，核对后点击“保存并使用”。'; }
      catch (error) { get('templateError').textContent = error.message; }
      finally { event.target.value = ''; setPending(false); }
    });
    for (const [input, property, label] of [['templateLogo', 'company.logo', 'logo'], ['templateBackground', 'cover.background', 'cover'], ['templateWatermarkImage', 'watermark.asset', 'watermark']]) get(input).addEventListener('change', () => void asset(get(input), property, label));
    for (const [id, property] of [['templateClearLogo', 'company.logo'], ['templateClearBackground', 'cover.background'], ['templateClearWatermark', 'watermark.asset']]) get(id).addEventListener('click', () => {
      try { const pack = edited(), [part, name] = property.split('.'); if (pack[part][name]) delete pack.assets[pack[part][name]]; pack[part][name] = null; draft = core.normalizePackage(pack); renderEditor(); } catch (error) { get('templateError').textContent = error.message; }
    });
    return { load, capture, format, lock: value => { get('exportTemplatePanel').querySelectorAll('input,select,button').forEach(element => { element.disabled = value; }); if (!value) describe(); } };
  }
  root.DitaDeliveryTemplates = { createController };
})(window);

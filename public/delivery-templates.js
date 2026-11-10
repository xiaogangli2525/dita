'use strict';
(function (root) {
  function createController({ api, changed }) {
    const core = root.DitaTemplateCore, get = id => document.getElementById(id), dialog = get('templateDialog');
    let library = [], context = null, generation = 0, editing = 0, pending = false, draft = null, opener = null, loadError = '';
    const metadata = { 'manual.title': 'exportTitle', 'manual.releaseDate': 'exportDate', 'manual.documentId': 'exportDocumentId', 'manual.classification': 'exportClassification', 'company.name': 'exportCompany' };
    const pageOptions = { '': '无', 'company.name': '企业名称', 'manual.title': '手册标题', 'manual.model': '适用型号', 'manual.version': '文档版本', 'manual.releaseDate': '发布日期', 'manual.documentId': '文档编号', 'manual.classification': '文档级别', 'page.current': '当前页', 'page.total': '总页数', 'page.currentTotal': '当前页 / 总页数' };
    for (const part of ['Header', 'Footer']) for (const side of ['Left', 'Center', 'Right']) get('template' + part + side).replaceChildren(...Object.entries(pageOptions).map(([value, label]) => new Option(label, value)));
    const optionLabel = pack => pack.name + ' · ' + pack.version + ' · ' + pack.formats.map(format => format === 'pdf' ? 'PDF' : 'Word').join(' / ') + (pack.renderer === 'manual-v1' ? ' · 旧版' : '');
    const active = () => library.find(item => core.key(item.package) === get('exportTemplate').value);
    const storageKey = format => 'dita.template-choice.v2:' + JSON.stringify([context.root, context.branch, context.path, format]);
    const legacyStorageKey = () => 'dita.template-choice.v1:' + JSON.stringify([context.root, context.branch, context.path]);
    function warn(message) { get('exportTemplateWarning').textContent = message; get('exportTemplateWarning').hidden = !message; }
    function remember() {
      if (!context) return;
      const fields = Object.fromEntries(Object.entries(metadata).map(([field, id]) => [field, get(id).value]));
      try { localStorage.setItem(storageKey(get('exportFormat').value), JSON.stringify({ key: get('exportTemplate').value, fields })); }
      catch { warn('模板和信息仅保留在本页，浏览器偏好存储不可用。模板包本身仍保存在服务端。'); }
    }
    function invalidate() { remember(); describe(); changed(); }
    function describe() {
      const item = active();
      get('exportTemplateInfo').textContent = item ? `${item.package.page.size} · ${item.package.cover.enabled ? '含封面' : '无封面'} · ${item.package.watermark.enabled ? '水印已启用' : '无水印'} · ${item.package.formats.map(format => format === 'pdf' ? 'PDF' : 'Word').join(' / ')} · v${item.package.version} · ${item.sha256.slice(0, 10)}` : '沿用基础版式；选择企业模板可应用封面、页眉页脚和水印，不修改原始 DITA。';
      get('exportTemplateFields').hidden = !item;
      get('templateShare').disabled = !item;
      if (item) {
        const source = core.watermarkSource(item.package);
        if (item.package.watermark.enabled) get('exportTemplateInfo').textContent += source.kind === 'image' ? ' · 图片水印' : source.kind === 'text' ? ' · 文字水印' : ' · 未配置 Logo/水印图，当前不显示水印';
        if (item.package.renderer === 'manual-v1') get('exportTemplateInfo').textContent += ' · 可升级新版排版后另存为新版本，或复制当前模板继续编辑';
      }
    }
    function format(format) {
      const supported = ['pdf', 'docx'].includes(format), select = get('exportTemplate'), previous = select.value;
      get('exportTemplatePanel').hidden = !supported;
      get('exportTemplatePanel').setAttribute('aria-label', format === 'docx' ? 'Word 交付模板' : 'PDF 交付模板');
      if (!supported) return;
      let saved;
      try {
        saved = JSON.parse(localStorage.getItem(storageKey(format)) || (format === 'pdf' ? localStorage.getItem(legacyStorageKey()) : 'null') || 'null');
      } catch { warn('模板选择备份无法读取，本次使用默认版式；原始浏览器数据仍保留。'); }
      const available = library.filter(item => item.package.formats.includes(format));
      select.replaceChildren(new Option('沿用基础版式', ''));
      for (const item of available) select.add(new Option(optionLabel(item.package), core.key(item.package)));
      const hasSavedChoice = typeof saved?.key === 'string';
      const requested = hasSavedChoice ? saved.key : (previous && available.some(item => core.key(item.package) === previous) ? previous : '');
      if (requested && available.some(item => core.key(item.package) === requested)) select.value = requested;
      else if (requested) {
        select.add(new Option('缺少模板 · ' + requested, requested)); select.value = requested;
        warn('原绑定模板不可用（当前格式不支持），请导入原版本或明确选择其他版式。');
      } else if (loadError) {
        select.add(new Option('模板不可用 · 请重新选择', '__unavailable__')); select.value = '__unavailable__';
        warn('模板库读取失败：' + loadError);
      } else if (format === 'docx' && !hasSavedChoice) {
        const standard = available.find(item => item.package.id === 'enterprise-blue') || available[0];
        if (standard) select.value = core.key(standard.package);
      }
      if (saved?.fields && typeof saved.fields === 'object') {
        for (const [field, element] of Object.entries(metadata)) if (typeof saved.fields[field] === 'string' && saved.fields[field].length <= 160) get(element).value = saved.fields[field];
      }
      describe();
    }
    async function load(next) {
      const id = ++generation, workspace = api.token;
      context = next; library = []; loadError = ''; get('exportTemplate').replaceChildren(new Option('沿用基础版式', '')); warn('');
      for (const [field, element] of Object.entries(metadata)) get(element).value = field === 'manual.title' ? next.title : '';
      try {
        const response = await api.request('/api/templates'); if (!response.ok) throw Error(await api.error(response));
        const value = await response.json();
        if (id !== generation || workspace !== api.token) return;
        library = value.templates.map(item => ({ ...item, package: core.normalizePackage(item.package) }));
        for (const item of library) get('exportTemplate').add(new Option(optionLabel(item.package), core.key(item.package)));
        if (value.warnings.length || value.temporary) warn([value.temporary ? '演示模式：导入模板只保留至服务重启。' : '', ...value.warnings].filter(Boolean).join('；'));
      } catch (error) { if (id === generation) loadError = error.message; }
      finally { if (id === generation) format(get('exportFormat').value); }
    }
    function capture(format, values) {
      if (!['pdf', 'docx'].includes(format) || !get('exportTemplate').value) return null;
      const item = active(); if (!item || !item.package.formats.includes(format)) throw Error('所选模板不可用或不支持当前格式，请导入原版本或选择其他版式。');
      return core.capture(item.package, { ...Object.fromEntries(Object.entries(metadata).map(([field, element]) => [field, get(element).value])), 'manual.model': values.model, 'manual.version': values.version });
    }
    function watermarkSettings() {
      return { source: get('templateWatermarkSource').value, fit: get('templateWatermarkFit').value, widthPercent: Number(get('templateWatermarkWidth').value), offsetYPercent: Number(get('templateWatermarkY').value), rotationDeg: Number(get('templateWatermarkRotation').value), tone: get('templateWatermarkTone').value,
        opacity: get('templateOpacity').value === String(draft.watermark.opacity * 100) ? draft.watermark.opacity : Number(get('templateOpacity').value) / 100, enabled: get('templateWatermark').checked };
    }
    function watermarkPreview() {
      if (!draft) return;
      const settings = watermarkSettings(), source = core.watermarkSource({ ...draft, watermark: { ...draft.watermark, ...settings } });
      const picture = get('templateWatermarkPicture'), text = get('templateWatermarkText'), page = get('templateWatermarkPage');
      picture.hidden = source.kind !== 'image'; text.hidden = source.kind !== 'text';
      const whole = source.kind === 'image' && settings.fit === 'page', target = source.kind === 'image' ? picture : text;
      page.style.aspectRatio = core.sizes[get('templatePaper').value].join(' / ');
      if (source.kind === 'image') picture.src = draft.assets[source.asset];
      if (source.kind === 'text') text.textContent = source.field === 'company.name' ? get('templateCompany').value : get(metadata[source.field] || (source.field === 'manual.model' ? 'exportModel' : 'exportVersion')).value;
      target.style.cssText = whole ? 'left:0;top:0;width:100%;height:100%;max-height:100%;transform:none;' : `left:50%;top:${settings.offsetYPercent}%;width:${settings.widthPercent}%;max-height:30%;transform:translate(-50%,-50%) rotate(${settings.rotationDeg}deg);`;
      target.style.opacity = settings.opacity; target.style.filter = settings.tone === 'grayscale' ? 'grayscale(1)' : 'none';
      for (const id of ['templateWatermarkWidth', 'templateWatermarkY', 'templateWatermarkRotation']) get(id).disabled = whole || draft.renderer === 'manual-v1';
      get('templateWatermarkHint').textContent = source.kind === 'none' ? settings.enabled ? '未选到水印图片。请上传企业 Logo 或专用水印图，也可明确选择文字水印。' : '水印已关闭。' : source.kind === 'image' ? '使用原始图片，保持图形与比例；预览仅显示水印位置。' : '当前为文字水印，与企业 Logo 分开设置。';
    }
    function renderEditor() {
      const p = core.upgrade(draft), modern = draft.renderer === 'manual-v2';
      get('templateId').value = p.id; get('templateName').value = p.name; get('templateVersion').value = p.version;
      get('templateFormatsPdf').checked = p.formats.includes('pdf'); get('templateFormatsDocx').checked = p.formats.includes('docx');
      get('templateCompany').value = p.company.name; get('templatePaper').value = p.page.size; get('templateLayout').value = p.cover.layout;
      get('templatePrimary').value = p.colors.primary; get('templateAccent').value = p.colors.accent;
      get('templateCover').checked = p.cover.enabled; get('templateWatermark').checked = p.watermark.enabled; get('templateOpacity').value = p.watermark.opacity * 100; get('templateOpacity').max = modern ? '100' : '15';
      get('templateUpgrade').hidden = modern;
      for (const id of ['templateCoverText', 'templateWatermarkSource', 'templateWatermarkFit', 'templateWatermarkTone', 'templateHeaderGap', 'templateFooterGap', 'templateFooterRule', 'templateFormatsDocx']) get(id).disabled = !modern;
      get('templateCoverText').value = p.cover.textColor; get('templateWatermarkSource').value = p.watermark.source; get('templateWatermarkFit').value = p.watermark.fit;
      get('templateWatermarkWidth').value = p.watermark.widthPercent; get('templateWatermarkY').value = p.watermark.offsetYPercent; get('templateWatermarkRotation').value = p.watermark.rotationDeg; get('templateWatermarkTone').value = p.watermark.tone;
      get('templateFooterRule').checked = p.footer.rule; get('templateHeaderGap').value = p.header.gapMm; get('templateFooterGap').value = p.footer.gapMm;
      get('templateFrontFooter').checked = p.regions.frontMatter.footer;
      get('templateBodyHeader').checked = p.regions.body.header; get('templateBodyFooter').checked = p.regions.body.footer; get('templateHeaderRule').checked = p.header.rule;
      for (const part of ['Header', 'Footer']) for (const side of ['Left', 'Center', 'Right']) get('template' + part + side).value = p[part.toLowerCase()][side.toLowerCase()];
      for (const [id, path] of [['templateLogoStatus', p.company.logo], ['templateBackgroundStatus', p.cover.background], ['templateWatermarkStatus', p.watermark.asset]]) get(id).textContent = path || '未设置';
      watermarkPreview();
    }
    function edited() {
      const p = JSON.parse(JSON.stringify(draft));
      p.id = get('templateId').value.trim(); p.name = get('templateName').value.trim(); p.version = get('templateVersion').value.trim(); p.company.name = get('templateCompany').value.trim();
      p.formats = ['pdf', 'docx'].filter(format => get(format === 'pdf' ? 'templateFormatsPdf' : 'templateFormatsDocx').checked);
      p.page.size = get('templatePaper').value; p.cover.layout = get('templateLayout').value; p.colors.primary = get('templatePrimary').value; p.colors.accent = get('templateAccent').value;
      p.cover.enabled = get('templateCover').checked; p.watermark.enabled = get('templateWatermark').checked; p.watermark.opacity = watermarkSettings().opacity;
      if (draft.renderer === 'manual-v2') { p.cover.textColor = get('templateCoverText').value; p.watermark = { ...p.watermark, ...watermarkSettings() }; p.header.gapMm = Number(get('templateHeaderGap').value); p.footer.gapMm = Number(get('templateFooterGap').value); p.footer.rule = get('templateFooterRule').checked; } p.regions.frontMatter.footer = get('templateFrontFooter').checked;
      p.regions.body.header = get('templateBodyHeader').checked; p.regions.body.footer = get('templateBodyFooter').checked; p.header.rule = get('templateHeaderRule').checked;
      for (const part of ['Header', 'Footer']) for (const side of ['Left', 'Center', 'Right']) p[part.toLowerCase()][side.toLowerCase()] = get('template' + part + side).value;
      return core.normalizePackage(p);
    }
    function open() {
      editing++;
      opener = document.activeElement; const selectedFormat = get('exportFormat').value;
      draft = core.upgrade(active()?.package || core.builtins().find(pack => pack.formats.includes(selectedFormat)) || core.builtins()[0]);
      draft.formats = [...new Set([...draft.formats, ...(['pdf', 'docx'].includes(selectedFormat) ? [selectedFormat] : [])])];
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
        if (![...get('exportTemplate').options].some(option => option.value === key)) get('exportTemplate').add(new Option(optionLabel(pack), key));
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
        pack.assets[name] = data; pack[parts[0]][parts[1]] = name;
        if (old && ![pack.company.logo, pack.cover.background, pack.watermark.asset].includes(old)) delete pack.assets[old];
        draft = core.normalizePackage(pack); renderEditor(); get('templateError').textContent = '';
      } catch (error) { if (id === editing) get('templateError').textContent = error.message; }
      finally { input.value = ''; setPending(false); }
    }
    for (const id of ['templateWatermarkSource', 'templateWatermarkFit', 'templateWatermarkWidth', 'templateWatermarkY', 'templateWatermarkRotation', 'templateWatermarkTone', 'templateOpacity', 'templateWatermark', 'templateCompany', 'templatePaper']) get(id).addEventListener('input', watermarkPreview);
    get('exportTemplate').addEventListener('change', () => { const item = active(); if (item?.package.company.name) get('exportCompany').value = item.package.company.name; invalidate(); });
    for (const element of Object.values(metadata)) get(element).addEventListener('input', invalidate);
    get('templateManage').addEventListener('click', open);
    get('templateUpgrade').addEventListener('click', () => { try { draft = core.upgrade(edited()); draft.version = draft.version.replace(/(\d+)(-[a-z0-9.-]+)?$/, (_, patch) => String(Number(patch) + 1)); renderEditor(); get('templateError').textContent = '已切换新版排版，保存为新版本，不会覆盖旧模板。'; } catch (error) { get('templateError').textContent = error.message; } });
    get('templateShare').addEventListener('click', () => { const pack = active()?.package; if (pack) root.DitaBrowserFiles.downloadText(JSON.stringify(pack, null, 2), core.key(pack) + '.dita-template.json', 'application/json'); });
    get('templateClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { if (!dialog.open) { editing++; opener?.focus({ preventScroll: true }); } });
    get('modelExportDialog').addEventListener('close', () => { if (!get('modelExportDialog').open) { generation++; if (dialog.open) dialog.close(); } });
    get('templateForm').addEventListener('submit', event => { event.preventDefault(); try { void install().catch(error => { get('templateError').textContent = error.message; }); } catch (error) { get('templateError').textContent = error.message; } });
    get('templateDownload').addEventListener('click', () => { try { const pack = edited(); root.DitaBrowserFiles.downloadText(JSON.stringify(pack, null, 2), core.key(pack) + '.dita-template.json', 'application/json'); } catch (error) { get('templateError').textContent = error.message; } });
    get('templateImport').addEventListener('change', async event => {
      const file = event.target.files[0]; if (!file) return;
      const id = editing; setPending(true);
      try { if (file.size > 2200000) throw Error('模板包过大'); const pack = core.normalizePackage(JSON.parse(await file.text())); if (id !== editing || !dialog.open) return; draft = pack; renderEditor(); get('templateError').textContent = pack.renderer === 'manual-v1' ? '旧模板将保留原版式；如需新排版，请点击“升级新版排版”后另存新版本。' : '已载入模板包，核对后点击“保存并使用”。'; }
      catch (error) { get('templateError').textContent = error.message; }
      finally { event.target.value = ''; setPending(false); }
    });
    for (const [input, property, label] of [['templateLogo', 'company.logo', 'logo'], ['templateBackground', 'cover.background', 'cover'], ['templateWatermarkImage', 'watermark.asset', 'watermark']]) get(input).addEventListener('change', () => void asset(get(input), property, label));
    for (const [id, property] of [['templateClearLogo', 'company.logo'], ['templateClearBackground', 'cover.background'], ['templateClearWatermark', 'watermark.asset']]) get(id).addEventListener('click', () => {
      try { const pack = edited(), [part, name] = property.split('.'), old = pack[part][name]; pack[part][name] = null; if (old && ![pack.company.logo, pack.cover.background, pack.watermark.asset].includes(old)) delete pack.assets[old]; draft = core.normalizePackage(pack); renderEditor(); } catch (error) { get('templateError').textContent = error.message; }
    });
    return { load, capture, format, lock: value => { get('exportTemplatePanel').querySelectorAll('input,select,button').forEach(element => { element.disabled = value; }); if (!value) describe(); } };
  }
  root.DitaDeliveryTemplates = { createController };
})(window);

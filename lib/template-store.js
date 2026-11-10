'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), { createHash, randomUUID } = require('node:crypto');
const core = require('../public/template-core');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function createTemplateStore({ env = process.env, memory = false } = {}) {
  const maximum = core.builtins().length + 100;
  const directory = env.DITA_TEMPLATE_DIR || path.join(process.platform === 'win32' ? env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), process.platform === 'win32' ? 'DITA Lite' : 'dita-lite', 'templates');
  const temporaryPackages = new Map();
  async function list() {
    const templates = core.builtins().map(pack => ({ package: pack, sha256: hash(pack), builtin: true })), warnings = [];
    const add = value => {
      const pack = core.normalizePackage(value), key = core.key(pack), sha256 = hash(pack), existing = templates.find(item => core.key(item.package) === key);
      if (existing) { if (existing.sha256 !== sha256) throw Error('模板版本与内置或已有模板冲突'); return; }
      templates.push({ package: pack, sha256, builtin: false });
    };
    if (memory) for (const value of temporaryPackages.values()) add(value);
    else {
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); }
      catch (error) { if (error.code === 'ENOENT') return { templates, warnings, temporary: false }; throw Error('无法读取企业模板目录，请检查权限', { cause: error }); }
      for (const file of entries.filter(entry => entry.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name))) {
        try {
          if (templates.length >= maximum) throw Error('模板数量已达上限');
          if (!file.isFile()) throw Error('模板必须为普通文件');
          const filename = path.join(directory, file.name), stat = await fs.stat(filename);
          if (stat.size > 2200000) throw Error('模板文件过大');
          const value = core.normalizePackage(JSON.parse(await fs.readFile(filename, 'utf8')));
          if (file.name !== core.key(value) + '.json') throw Error('模板文件名与 ID/版本不一致');
          add(value);
        } catch (error) { warnings.push(file.name + '：' + error.message); }
      }
    }
    return { templates, warnings, temporary: memory };
  }
  async function save(value) {
    const pack = core.normalizePackage(value), key = core.key(pack), sha256 = hash(pack), library = await list(), existing = library.templates.find(item => core.key(item.package) === key);
    if (existing) { if (existing.sha256 !== sha256) throw Object.assign(Error('此 ID 和版本已有不同内容，请使用新版本号'), { status: 409 }); return existing; }
    if (library.templates.length >= maximum) throw Object.assign(Error('模板数量已达上限'), { status: 400 });
    if (memory) temporaryPackages.set(key, pack);
    else {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const filename = path.join(directory, key + '.json'), temporary = path.join(directory, '.template-' + randomUUID());
      try {
        await fs.writeFile(temporary, JSON.stringify(pack), { flag: 'wx', mode: 0o600 });
        // A link is create-only even when two imports race. Never overwrite an
        // installed version; readers see a complete, immutable package.
        try { await fs.link(temporary, filename); }
        catch (error) { if (error.code !== 'EEXIST') throw error; const current = core.normalizePackage(JSON.parse(await fs.readFile(filename, 'utf8'))); if (hash(current) !== sha256) throw Object.assign(Error('此模板版本已被其他导入占用，请使用新版本号'), { status: 409 }); }
      } finally { try { await fs.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') console.warn('Template temporary cleanup failed:', error.code); } }
    }
    return { package: pack, sha256, builtin: false };
  }
  return { list, save };
}
module.exports = { createTemplateStore };

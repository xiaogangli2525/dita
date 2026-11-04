'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { randomUUID } = require('node:crypto');
function createAiConfigStore(env = process.env) {
  const directory = process.platform === 'win32' ? path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'DITA Lite') : path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'dita-lite');
  const file = env.DITA_AI_CONFIG_FILE || path.join(directory, 'ai-connection.json');
  function load() {
    try {
      if (fs.statSync(file).size > 16000) throw Error('oversized');
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!value || value.schema !== 1 || typeof value.baseUrl !== 'string' || value.baseUrl.length > 2000 || typeof value.model !== 'string' || value.model.length > 150 || typeof value.key !== 'string' || value.key.length > 8192 || typeof value.allowHttp !== 'boolean' || typeof value.noAuth !== 'boolean') throw Error('invalid');
      return { baseUrl: value.baseUrl, model: value.model, key: value.key, allowHttp: value.allowHttp, noAuth: value.noAuth };
    } catch (error) { if (error.code === 'ENOENT') return null; throw new Error('已保存的模型配置无法读取，请在模型设置中重新保存连接。', { cause: error }); }
  }
  function save(value) {
    const temporary = path.join(path.dirname(file), '.ai-' + randomUUID());
    let fd, created = false;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fd = fs.openSync(temporary, 'wx', 0o600);
      created = true;
      fs.writeFileSync(fd, JSON.stringify({ schema: 1, baseUrl: value.baseUrl, model: value.model, key: value.key, allowHttp: value.allowHttp, noAuth: value.noAuth }), 'utf8');
      fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, file);
    } catch { throw Object.assign(new Error('无法保存模型连接，请检查服务端用户配置目录的写入权限。'), { status: 500 }); }
    finally { if (fd !== undefined) fs.closeSync(fd); if (created) try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') console.warn('AI configuration temporary file cleanup failed:', error.code); } }
  }
  return { load, save };
}
module.exports = { createAiConfigStore };

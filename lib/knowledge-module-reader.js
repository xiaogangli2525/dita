'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const fail = (message, status = 400) => Object.assign(Error(message), { status });
const statOrNull = file => fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });

// Resolve exact dependencies beneath registered gitlinks without checkout or fetch.
function createModuleReader({ root, links, command, revision }) {
  const opened = new Map();
  async function open(mount) {
    if (opened.has(mount)) return opened.get(mount);
    const cwd = path.join(root, mount);
    const missing = () => fail('本地尚未初始化公共子模块「' + mount + '」。请在手册仓库初始化该子模块，再重新核对。', 404);
    const actual = await fs.realpath(cwd).catch(error => { if (error.code === 'ENOENT') throw missing(); throw error; });
    if (path.relative(cwd, actual)) throw fail('子模块路径含符号链接：' + mount, 403);
    const marker = await statOrNull(path.join(cwd, '.git'));
    if (!marker) throw missing();
    if (!marker.isFile() && !marker.isDirectory()) throw fail('子模块 Git 目录无效：' + mount);
    const gitDir = await fs.realpath((await command(['rev-parse', '--absolute-git-dir'], { cwd })).trim());
    if (path.relative(path.join(cwd, '.git'), gitDir)) {
      const parentGit = await fs.realpath((await command(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim());
      const relative = path.relative(path.join(parentGit, 'modules'), gitDir);
      if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw fail('子模块对象目录不属于此文档库：' + mount, 403);
    }
    const top = (await command(['rev-parse', '--show-toplevel'], { cwd })).trim();
    if (path.relative(cwd, await fs.realpath(top))) throw missing();
    const commit = links.get(mount);
    if (revision) {
      try { await command(['cat-file', '-e', commit + '^{commit}'], { cwd }); }
      catch (cause) { throw new Error('子模块「' + mount + '」缺少父库指定的提交 ' + commit + '，请先在本地补齐该版本。', { cause }); }
    }
    const module = { cwd, commit }; opened.set(mount, module); return module;
  }
  async function locate(name) {
    let mount = '';
    for (const part of name.split('/')) { mount = mount ? mount + '/' + part : part; if (links.has(mount)) break; }
    if (!links.has(mount) || mount === name) return null;
    const { cwd, commit } = await open(mount), local = name.slice(mount.length + 1);
    if (revision) {
      const row = await command(['--literal-pathspecs', 'ls-tree', '-z', '-l', commit, '--', local], { cwd });
      if (!row) throw fail('父库锁定的子模块版本中缺少：' + name + '（' + commit.slice(0, 8) + '）', 404);
      const blob = /^(?:100644|100755) blob ([a-f0-9]+)\s+(\d+)\t/.exec(row);
      if (!blob) throw fail('子模块来源须为普通文件：' + name);
      return { cwd, local, oid: blob[1], size: Number(blob[2]) };
    }
    let cursor = cwd;
    for (const part of local.split('/')) {
      if (part.toLowerCase() === '.git') throw fail('来源路径无效', 403);
      cursor = path.join(cursor, part);
      const stat = await statOrNull(cursor);
      if (!stat) throw fail('已初始化的子模块「' + mount + '」中缺少：' + local, 404);
      if (stat.isSymbolicLink()) throw fail('子模块来源含符号链接：' + name, 403);
      if (stat.isDirectory() && await statOrNull(path.join(cursor, '.git'))) throw fail('引用进入下一级 Git 仓库：' + name);
      if (cursor === path.join(cwd, local) && !stat.isFile()) throw fail('子模块来源须为普通文件：' + name);
    }
    return { cwd, local };
  }
  return { locate };
}
module.exports = { createModuleReader };

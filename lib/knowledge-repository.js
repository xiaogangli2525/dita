'use strict';
const fs = require('node:fs/promises'), path = require('node:path');
const { createHash } = require('node:crypto');
const { decodeXmlBuffer, resolveWorkspacePath } = require('./document-files');
const fail = (message, status = 400) => Object.assign(Error(message), { status });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sidecar = name => ['.dita-project.json', '.dita-note-rules.json'].includes(name);
const supported = name => /\.(dita|ditamap|xml|ditaval|png|jpe?g|gif|bmp|webp|svg)$/i.test(name) || sidecar(name);
function relative(value) {
  if (typeof value !== 'string' || !value || value.length > 1000 || /[\\:\0]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw fail('来源文件路径无效');
  return value;
}
async function diskBytes(root, name) {
  const file = await fs.open(await resolveWorkspacePath(root, name), 'r');
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 20 * 1024 * 1024) throw fail('来源不是普通文件或超过 20 MiB：' + name, 413);
    const buffer = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < buffer.length) { const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
    const after = await file.stat();
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw fail('来源在核对期间发生变化：' + name, 409);
    return buffer.subarray(0, offset);
  } finally { await file.close(); }
}
function createRepositoryAccess({ git, getRoot }) {
  async function open(selection) {
    if (!selection || typeof selection.repositoryRoot !== 'string') throw fail('请选择文档库');
    let root;
    if (path.resolve(selection.repositoryRoot) === path.resolve(getRoot())) root = await fs.realpath(getRoot());
    else root = await git.resolveSelectedRepository(selection.repositoryRoot);
    const command = (args, options = {}) => git.runGit(args, { cwd: root, maxOutputBytes: 24 * 1024 * 1024, env: { GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' }, ...options });
    const top = (await command(['rev-parse', '--show-toplevel'])).trim();
    if (await fs.realpath(top) !== root) throw fail('请选择独立 Git 仓库的根目录', 403);
    const revision = selection.revision === undefined ? '' : selection.revision;
    // eslint-disable-next-line no-control-regex -- Revision text is never passed to a shell or interpreted as an option.
    if (typeof revision !== 'string' || revision.length > 200 || revision.startsWith('-') || /[\s\x00-\x1f]/.test(revision)) throw fail('Git 版本无效');
    const currentBranch = async () => (await command(['branch', '--show-current'])).trim() || '(detached)';
    const workingBranch = await currentBranch();
    const resolve = async () => (await command(['rev-parse', '--verify', '--end-of-options', (revision || 'HEAD') + '^{commit}'])).trim();
    const commit = await resolve();
    if (!revision && selection.branch !== undefined && (selection.branch || '(detached)') !== workingBranch) throw fail('当前分支为 ' + workingBranch + '，与方案中的 ' + (selection.branch || '游离 HEAD') + ' 不符。请选择 Git 版本或核对来源设置。', 409);
    const inventory = new Map(), invalidSidecars = new Set(); let walked = 0;
    if (revision) {
      const output = await command(['ls-tree', '-r', '-t', '-z', '-l', commit]);
      for (const row of output.split('\0').filter(Boolean)) {
        if (++walked > 20000) throw fail('仓库文件过多，请拆分文档库');
        const match = /^(\d+) (\w+) ([a-f0-9]+)\s+(\d+|-)\t([\s\S]+)$/.exec(row);
        if (match && match[2] === 'blob' && ['100644', '100755'].includes(match[1]) && supported(match[5])) inventory.set(relative(match[5]), { oid: match[3], size: Number(match[4]) });
        else if (match && sidecar(match[5])) invalidSidecars.add(match[5]);
      }
    } else {
      async function walk(directory = '', depth = 0) {
        if (depth > 40) throw fail('文档目录层级过深');
        const entries = await fs.readdir(path.join(root, directory), { withFileTypes: true });
        if (directory && entries.some(entry => entry.name === '.git')) return;
        for (const entry of entries) {
          if (++walked > 20000) throw fail('仓库文件过多，请拆分文档库');
          if (!directory && sidecar(entry.name) && !entry.isFile()) { invalidSidecars.add(entry.name); continue; }
          if (['.git', 'node_modules'].includes(entry.name) || entry.name.startsWith('.dita-import-') || entry.isSymbolicLink()) continue;
          const name = directory ? directory + '/' + entry.name : entry.name;
          if (entry.isDirectory()) await walk(name, depth + 1);
          else if (entry.isFile() && supported(name)) inventory.set(relative(name), {});
        }
      }
      await walk();
    }
    const consumed = new Map(); let bytes = 0;
    async function read(name, optional = false) {
      relative(name); const item = inventory.get(name);
      if (invalidSidecars.has(name)) throw fail('来源配置须为普通文件：' + name);
      if (!item) {
        if (!optional) throw fail('来源文件不存在、为符号链接或不受支持：' + name, 404);
        consumed.set(name, null); return null;
      }
      if (item.size > 20 * 1024 * 1024) throw fail('来源文件超过 20 MiB：' + name, 413);
      const data = revision ? await command(['cat-file', 'blob', item.oid], { binary: true }) : await diskBytes(root, name);
      bytes += data.length; if (data.length > 20 * 1024 * 1024 || bytes > 48 * 1024 * 1024 || consumed.size >= 256 && !consumed.has(name)) throw fail('来源超过限制（256 文件／48 MiB），请缩小手册范围', 413);
      const digest = hash(data);
      if (consumed.has(name) && consumed.get(name) !== digest) throw fail('来源在核对期间发生变化：' + name, 409);
      consumed.set(name, digest); return data;
    }
    async function assertCurrent(records = [...consumed].map(([path, sha256]) => ({ path, sha256 }))) {
      if (await resolve() !== commit || !revision && await currentBranch() !== workingBranch) throw fail('来源版本已变化，请重新核对', 409);
      if (revision) return;
      for (const record of records) {
        relative(record.path);
        if (!supported(record.path) || record.sha256 === null && !sidecar(record.path)) throw fail('来源文件类型不受支持', 403);
        if (record.sha256 === null) {
          const stat = await fs.lstat(path.join(root, record.path)).catch(cause => { if (cause.code !== 'ENOENT') throw cause; return null; });
          if (stat) throw fail('来源配置已变化，请重新核对：' + record.path, 409);
          continue;
        }
        if (!inventory.has(record.path)) throw fail('来源文件已变化或无法读取：' + record.path, 409);
        const data = await diskBytes(root, record.path);
        if (hash(data) !== record.sha256) throw fail('来源文件已变化，请重新核对：' + record.path, 409);
      }
    }
    async function provenance() {
      let dirty = false;
      if (!revision) {
        dirty = Boolean((await command(['status', '--porcelain', '--untracked-files=normal'])).trim());
        if (!dirty && consumed.size) {
          const tracked = new Set((await command(['ls-files', '--cached', '-z'])).split('\0'));
          dirty = [...consumed].some(([name, digest]) => digest !== null && !tracked.has(name));
        }
      }
      return { commit, branch: revision || workingBranch, dirty };
    }
    return { root, revision, commit, branch: revision || workingBranch, inventory, read,
      text: async (name, optional = false) => { const bytes = await read(name, optional); return bytes == null ? null : decodeXmlBuffer(bytes); },
      refs: async () => (await command(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags'])).trim().split(/\r?\n/).filter(Boolean).slice(0, 1000).map(value => ({ value, label: value.startsWith('refs/tags/') ? '标签 ' + value.slice(10) : '分支 ' + value.slice(11) })),
      assertCurrent, receipt: () => ({ repositoryRoot: root, branch: workingBranch, revision, commit, files: [...consumed].map(([path, sha256]) => ({ path, sha256 })) }),
      provenance };
  }
  async function verify(receipt) {
    if (!receipt || !/^[a-f0-9]{40,64}$/.test(receipt.commit) || !Array.isArray(receipt.files) || receipt.files.length > 256 || receipt.files.some(file => !file || file.sha256 !== null && !/^[a-f0-9]{64}$/.test(file.sha256))) throw fail('来源核对凭据无效');
    for (const file of receipt.files) relative(file.path);
    const reader = await open(receipt);
    if (reader.commit !== receipt.commit) throw fail('来源提交已变化，请重新核对', 409);
    await reader.assertCurrent(receipt.files);
    return { current: true };
  }
  return { open, verify };
}
module.exports = { createRepositoryAccess, relative };

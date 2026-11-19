'use strict';
const { readFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

try {
  const plan = JSON.parse(readFileSync(process.env.DITA_COMMIT_PLAN, 'utf8'));
  const git = (args, env = process.env) => execFileSync(process.env.GIT_EXECUTABLE || 'git', ['--literal-pathspecs', ...args], { encoding: 'utf8', windowsHide: true, env });
  if (git(['rev-parse', 'HEAD']).trim() !== plan.head || git(['symbolic-ref', '--short', 'HEAD']).trim() !== plan.branch) throw Error('提交分支或基线已变化');
  // Git supplies the temporary index of --only to the pre-commit hook.
  const changed = new Set(git(['diff', '--cached', '--no-renames', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean));
  if (changed.size !== plan.files.length || plan.files.some(file => !changed.has(file.path))) throw Error('Git 实际提交范围已变化');
  if (git(['diff', '--cached', '--name-only', '-z', 'HEAD', '--', ...plan.files.map(file => file.path)],
    { ...process.env, GIT_INDEX_FILE: plan.index }).length) throw Error('所选文档的暂存状态已变化');
  for (const file of plan.files) {
    const entry = git(['ls-files', '--stage', '-z', '--', file.path]);
    if (!entry.startsWith('100644 ' + file.oid + ' 0\t') && !entry.startsWith('100755 ' + file.oid + ' 0\t')) throw Error('磁盘版本已变化：' + file.path);
  }
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}

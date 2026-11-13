'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { ASSETS, createEncoder } = require('../lib/semantic-encoder');
const { PROFILE } = require('../public/knowledge-semantic');

async function main() {
  const modelRoot = path.resolve(process.env.BLINK_MODELS || path.join(__dirname, '..', 'models'));
  for (const [name, sha] of Object.entries(ASSETS)) {
    const target = path.join(modelRoot, PROFILE.model, name);
    if (fs.existsSync(target) && createHash('sha256').update(fs.readFileSync(target)).digest('hex') === sha) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = target + '.download-' + process.pid;
    try {
      execFileSync('curl', ['--fail', '--location', '--retry', '2', '--max-time', '180',
        'https://huggingface.co/' + PROFILE.model + '/resolve/' + PROFILE.revision + '/' + name, '--output', temporary], { stdio: 'inherit' });
      if (createHash('sha256').update(fs.readFileSync(temporary)).digest('hex') !== sha) throw Error('模型下载校验失败：' + name);
      fs.renameSync(temporary, target);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
  await createEncoder(modelRoot).check();
  console.log('离线语义模型已准备好：' + modelRoot);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

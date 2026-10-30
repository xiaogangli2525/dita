'use strict';
// Isolated sample workspace for trying the UI. Production documents are opened
// with npm start and DOCS_ROOT. No user repository is modified by this demo.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
const value = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dita-demo-'));
const root = path.join(temporary, 'sample-docs');
fs.cpSync(path.join(__dirname, '../examples/docs'), root, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
git('init', '-b', 'main'); git('add', '.');
git('-c', 'user.name=DITA Demo', '-c', 'user.email=demo@example.invalid', 'commit', '-m', 'Sample documents');
process.env.HOST = value('--host') || '127.0.0.1';
process.env.PORT = value('--port') || '5050';
process.env.DOCS_ROOT = root;
process.env.REPOSITORIES_ROOT = temporary;
process.env.DITA_DEMO_MODE = '1';
const { server } = require('../server');
server.listen(Number(process.env.PORT), process.env.HOST, () => {
  console.log(`DITA demo: http://${process.env.HOST}:${process.env.PORT}`);
});
let closing = false;
function close() {
  if (closing) return;
  closing = true;
  server.close(() => { fs.rmSync(temporary, { recursive: true, force: true }); process.exit(0); });
  server.closeAllConnections();
}
process.once('SIGINT', close);
process.once('SIGTERM', close);

'use strict';
// Compare publication on one event loop with the production Worker in a fresh
// process per sample. This measures Node's event loop/RSS, not browser rendering.
const path = require('node:path'), { execFileSync } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function sample(mode, mib) {
  const paragraph = 'HTTP client request timeout response status parameter data. ';
  const text = paragraph.repeat(Math.ceil(mib * 1048576 / paragraph.length)).slice(0, mib * 1048576);
  const request = { title: 'HTTP publication benchmark', model: 'ML307G', sdkVersion: 'v1', generatedAt: '2026-11-16T00:00:00Z', manuals: [{
    id: 'm-0123456789abcdef', model: 'ML307G', title: 'HTTP manual', version: 'v1', capturedAt: '2026-11-16T00:00:00Z',
    html: '<html><body>' + text + '</body></html>', body: '<p id="a">' + text + '</p>', toc: [{ anchor: 'a', title: 'HTTP' }],
    entries: [{ anchor: 'a', title: 'HTTP', text }], source: { repository: 'http', commit: 'a'.repeat(40), dirty: false, documents: [] }, report: { included: 0 }
  }] };
  let publisher, thread, prepare;
  if (mode === 'worker') publisher = require('../public/knowledge/knowledge-publisher').createPublisher({ createWorker() {
    thread = new Worker(path.join(__dirname, '../tests/helpers/knowledge-worker-thread.js'));
    const handle = { postMessage: data => thread.postMessage(data), terminate: () => thread.terminate() };
    thread.on('message', data => handle.onmessage?.({ data })); thread.on('error', cause => handle.onerror?.({ message: cause.message }));
    return handle;
  } });
  else prepare = require('../public/knowledge/knowledge-package').preparePackage;
  let last = performance.now(), maximumGap = 0, ticks = 0;
  const heartbeat = setInterval(() => { const now = performance.now(); maximumGap = Math.max(maximumGap, now - last); last = now; ticks++; }, 5);
  await delay(20); maximumGap = 0; ticks = 0; last = performance.now();
  const started = performance.now(); let output;
  try {
    if (publisher) { await publisher.prepare(request); output = await publisher.download({ semantic: false }); }
    else output = prepare(request).build();
    const milliseconds = performance.now() - started, activeTicks = ticks;
    await delay(20);
    return { mode, textMiB: mib, zipBytes: output.zip.size, milliseconds: Math.round(milliseconds), mainThreadTicks: activeTicks,
      maximumHeartbeatGapMs: Math.round(maximumGap), peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) };
  } finally { clearInterval(heartbeat); publisher?.dispose(); await thread?.terminate(); }
}
async function main() {
  const mode = process.argv[2];
  if (mode === 'sync' || mode === 'worker') { console.log(JSON.stringify(await sample(mode, Number(process.argv[3])))); return; }
  const sizes = process.argv.slice(2).map(Number);
  if (!sizes.length) sizes.push(1, 5);
  if (sizes.some(size => !Number.isInteger(size) || size < 1 || size > 10)) throw Error('Use integer text sizes of 1–10 MiB');
  for (const size of sizes) for (const mode of ['sync', 'worker']) {
    const result = execFileSync(process.execPath, [__filename, mode, String(size)], { encoding: 'utf8', timeout: 120000 });
    process.stdout.write(result);
  }
}
main().catch(cause => { console.error(cause.message); process.exitCode = 1; });

'use strict';
// Test-only local bare-repository transport. No production HTTP option enables it.
const remote = require('../lib/remote-repositories'), original = remote.createRemoteRepositories;
remote.createRemoteRepositories = options => original({ ...options, runGit: (args, settings) => options.runGit(['-c', 'protocol.file.allow=always', ...args], settings), transport: url => { if (url !== 'https://example.invalid/company/manual.git') throw new Error('No fixture transport'); return process.env.DITA_REMOTE_FIXTURE_PATH; } });
require('../server').server.listen(Number(process.env.PORT), '127.0.0.1', () => process.stdout.write('remote fixture ready\n'));

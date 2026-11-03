'use strict';
const fs = require('node:fs'), path = require('node:path');
// A versioned, repository-owned writing policy is included on every request.
// Developer/workspace playbooks and arbitrary document files are not loaded.
const text = fs.readFileSync(path.join(__dirname, '../docs/ai-writing-rules.md'), 'utf8');
module.exports = Object.freeze({ version: '2', text });

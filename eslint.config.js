'use strict';
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'public/vendor/**', 'examples/**', 'docs/assets/**'] },
  {
    files: ['**/*.js', '**/*.cjs'],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
    }
  },
  { files: ['public/*.js', 'tests/*-browser.test.js', 'tests/browser.test.js', 'tests/visual-core.test.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  // This backend file includes functions serialized by Playwright into Chromium.
  { files: ['lib/pdf-export.js'], languageOptions: { globals: { document: 'readonly' } } }
];

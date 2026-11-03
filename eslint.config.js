'use strict';
const js = require('@eslint/js');
const globals = require('globals');
const documentRules = ['manual-core', 'manual-domain', 'publication-core', 'publication-resolver',
  'model-discovery', 'model-note-text', 'note-rules-core', 'footnotes-core', 'profiling-core', 'xml-source'];
const domainRequire = 'CallExpression[callee.name="require"]' + [...documentRules, 'vendor/sax']
  .flatMap(name => ['./' + name, './' + name + '.js'])
  .map(name => ':not([arguments.0.value=' + JSON.stringify(name) + '])').join('');

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
  {
    files: documentRules.map(name => 'public/' + name + '.js'),
    rules: {
      'no-restricted-globals': ['error', ...['document', 'fetch', 'XMLHttpRequest', 'localStorage', 'DOMParser'].map(name => ({
        name, message: 'Shared document rules must receive data; put DOM and IO in an adapter.'
      }))],
      'no-restricted-properties': ['error', ...['window', 'root', 'globalThis'].flatMap(object =>
        ['document', 'fetch', 'localStorage', 'DitaApp'].map(property => ({
          object, property, message: 'Shared document rules must not read application, DOM or IO services.'
        })))],
      'no-restricted-syntax': ['error', {
        selector: domainRequire,
        message: 'Shared document rules may require only declared domain modules (or vendored SAX).'
      }]
    }
  },
  // This backend file includes functions serialized by Playwright into Chromium.
  { files: ['lib/pdf-export.js'], languageOptions: { globals: { document: 'readonly' } } }
];

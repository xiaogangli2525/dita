'use strict';
const js = require('@eslint/js');
const globals = require('globals');
const documentRules = ['manual-core', 'manual-domain', 'publication-core', 'publication-resolver',
  'model-discovery', 'model-note-text', 'note-rules-core', 'footnotes-core', 'profiling-core', 'xml-source'];
const importsOnly = names => 'CallExpression[callee.name="require"]' + names
  .flatMap(name => ['./' + name, './' + name + '.js'])
  .map(name => ':not([arguments.0.value=' + JSON.stringify(name) + '])').join('');
const domainRequire = importsOnly([...documentRules, 'vendor/sax']);
const renderingBoundaries = [
  { names: ['ai-conversation'], imports: ['ai-edit-core'] },
  { names: ['review-view'], imports: [] },
  { names: ['xml-dom'], imports: ['xml-source'] },
  { names: ['oxygen-core', 'delivery-document'], imports: [] },
  { names: ['author-renderer'], imports: ['xml-dom', 'asset-core', 'document-presentation', 'oxygen-core'] },
  { names: ['author-source'], imports: ['xml-dom', 'author-renderer', 'document-presentation', 'manual-core'] },
  { names: ['markdown-preview'], imports: ['asset-core'] },
  { names: ['delivery-core'], imports: ['publication-core', 'asset-core', 'document-presentation',
    'delivery-document', 'markdown-preview', 'manual-core', 'publication-resolver'] }
];

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
  {
    files: ['public/*.js'], ignores: ['public/document-store.js'],
    rules: { 'no-restricted-syntax': ['error',
      { selector: 'AssignmentExpression[left.object.name="state"][left.property.name=/^(root|files|maps|selectedMap|selectedMapSourcePath|repositories|branches|currentBranch|capabilities|filesMap|activePath|historyTargetPath|mode|mapAuthorPaths)$/]', message: 'Use the workspace session operation instead of assigning shared state.' },
      { selector: 'AssignmentExpression[left.object.property.name="state"][left.property.name=/^(root|files|maps|selectedMap|selectedMapSourcePath|repositories|branches|currentBranch|capabilities|filesMap|activePath|historyTargetPath|mode|mapAuthorPaths)$/]', message: 'Use the workspace session operation instead of assigning shared state.' },
      { selector: 'CallExpression[callee.object.property.name="filesMap"][callee.property.name=/^(set|delete|clear)$/]', message: 'Document membership belongs to the workspace session.' },
      { selector: 'AssignmentExpression[left.computed!=true][left.property.name=/^(current|disk|dirty|baseline|gitStatus)$/]', message: 'Document content and save acknowledgement belong to document-store operations.' }
    ] }
  },
  ...renderingBoundaries.map(({ names, imports }) => ({
    files: names.map(name => 'public/' + name + '.js'),
    rules: {
      'no-restricted-globals': ['error', 'document', 'fetch', 'XMLHttpRequest', 'localStorage'],
      'no-restricted-properties': ['error', ...['window', 'root', 'globalThis'].flatMap(object =>
        ['DitaApp', 'fetch', 'localStorage'].map(property => ({ object, property,
          message: 'Rendering/source adapters receive data or DOM parameters, not application or IO services.' })))],
      'no-restricted-syntax': ['error', { selector: importsOnly(imports),
        message: 'Keep rendering dependencies within the declared acyclic layer boundary.' }]
    }
  })),
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

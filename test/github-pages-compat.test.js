const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('frontend assets are relative for GitHub Pages project sites', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

  assert.match(html, /href="styles\.css"/);
  assert.match(html, /src="app\.js"/);
  assert.doesNotMatch(html, /href="\/styles\.css"/);
  assert.doesNotMatch(html, /src="\/app\.js"/);
});

test('runtime mode detection selects API for localhost and local for hosted pages', async () => {
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'runtime-mode.mjs')).href;
  const { detectRuntimeMode } = await import(moduleUrl);

  assert.equal(detectRuntimeMode('localhost'), 'api');
  assert.equal(detectRuntimeMode('127.0.0.1'), 'api');
  assert.equal(detectRuntimeMode('::1'), 'api');
  assert.equal(detectRuntimeMode('vipin-baniya.github.io'), 'local');
  assert.equal(detectRuntimeMode('vipin-baniya.github.io', 'api'), 'api');
});

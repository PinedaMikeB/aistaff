const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('admin routes hide the public homepage before the first paint', () => {
  const bootMarker = index.indexOf("document.documentElement.classList.add('admin-route-booting')");
  const publicMarkup = index.indexOf('<header class="site-header cinematic-header" data-public>');
  const externalStylesheet = index.indexOf('<link rel="stylesheet" href="/style.css');

  assert.ok(bootMarker > -1, 'admin boot marker is missing');
  assert.ok(bootMarker < externalStylesheet, 'admin boot marker must run before the external stylesheet');
  assert.ok(bootMarker < publicMarkup, 'admin boot marker must run before public homepage markup');
  assert.match(index, /html\.admin-route-booting \[data-public\][\s\S]*display: none !important/);
  assert.match(index, /id="adminBootScreen"[\s\S]*Opening AIStaff/);
});

test('admin links use client-side routing instead of reloading the shared homepage shell', () => {
  assert.match(app, /const link = event\.target\.closest\("a\[href\]"\)/);
  assert.match(app, /!url\.pathname\.startsWith\("\/admin"\)/);
  assert.match(app, /event\.preventDefault\(\);[\s\S]*history\.pushState[\s\S]*routeHandler\(\);/);
  assert.match(app, /classList\.remove\("admin-route-booting"\)/);
});

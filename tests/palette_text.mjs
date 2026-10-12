// Palette and menus render their rows as TEXT: a file named like an HTML tag
// shows up literally and never becomes an element (no image, no handler).
// It held before level 2 too: file names reach the palette (Cmd+P), the "+"
// attach menu and the menu bar.
//
//   node tests/palette_text.mjs        (starts its own server: tests/lib/x2-server.mjs)
import { chromium } from 'playwright';
import { startServer } from './lib/x2-server.mjs';

let fails = 0;
const ok = (name, c, extra = '') => { console.log((c ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, { timeout = 15000, every = 150 } = {}) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(every); }
  return v;
}

const HOSTILE = '<img src=x onerror="window.__xss=1">.js';
const srv = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* no storage */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { if (e.message !== 'Canceled') errors.push(e.message); });
await page.goto(srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
const created = await page.evaluate(async name => {
  const o = await navigator.storage.getDirectory();
  try {
    const f = await o.getFileHandle(name, { create: true });
    const s = await f.createWritable(); await s.write('x'); await s.close();
    return true;
  } catch (e) { return String(e && e.message || e); }
}, HOSTILE);
ok('the browser accepts the hostile file name in the test project', created === true, String(created));

await page.goto(srv.codeOrigin + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });

// palette (files)
await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true })));
const pal = await until(() => page.evaluate(() => {
  const list = document.getElementById('pal-list');
  const rows = [...list.querySelectorAll('.pal-item')];
  return rows.length ? { texts: rows.map(r => r.querySelector('.pi-name')?.textContent), imgs: list.querySelectorAll('img').length, spans: rows.every(r => r.children.length === 2) } : null;
}));
ok('palette: the name appears as text', !!pal && pal.texts.includes(HOSTILE), JSON.stringify(pal?.texts));
ok('palette: no element was created from it', !!pal && pal.imgs === 0 && pal.spans);
await page.keyboard.press('Escape');

// "+" attach menu (openMenu)
await page.evaluate(() => document.getElementById('btn-plus').click());
const plus = await until(() => page.evaluate(() => {
  const m = document.getElementById('menu');
  const rows = [...m.querySelectorAll('.menu-item')];
  return rows.length ? { texts: rows.map(r => r.querySelector('b')?.textContent), imgs: m.querySelectorAll('img').length } : null;
}));
ok('attach menu: the name appears as text, with no element', !!plus && plus.texts.includes('@' + HOSTILE) && plus.imgs === 0, JSON.stringify(plus));

// menu bar (openMenuAt): same row builder; check one menu still looks the same
await page.evaluate(() => document.querySelector('#menubar button[data-menu="view"]').click());
const view = await until(() => page.evaluate(() => {
  const m = document.getElementById('topmenu');
  const rows = [...m.querySelectorAll('.menu-item')];
  return rows.length ? rows.map(r => [r.querySelector('b')?.textContent, r.querySelector('span')?.textContent ?? null]) : null;
}));
ok('menu bar rows keep their label and hint', !!view && view.some(([l, h]) => /^Command palette$/i.test(l || '') && /^(⌘⇧P|Ctrl\+Shift\+P)$/.test(h || '')), JSON.stringify(view?.slice(0, 6)));

await sleep(300);
ok('no handler from a file name ever ran', await page.evaluate(() => window.__xss === undefined));
ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await srv.close();
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

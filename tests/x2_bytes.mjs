// What people who never turn on an extension's code download, compared with
// Code's main before level 2 (84cc38b, which has level 1), and what turning it
// on downloads.
//
//   node tests/x2_bytes.mjs
//
// The tip's web/ comes from `git archive` into a temporary folder and is served
// by a second test server on another loopback port. The same steps run against
// both, each in a fresh browser profile, and the requests of the measured page
// are compared. Four states:
//   1. no extensions;
//   2. level 1 only: a theme installed and chosen;
//   3. a code extension installed with its code turned off (Prettier's real
//      .vsix; on the tip, the same file gives its declarative parts);
//   4. the Extensions panel open and a search done (Open VSX mocked the same
//      way for both).
// In each: the same request URLs (path and query; Code's site and the CDN)
// and the same count; nothing under /vendor/x2/ or /js/ext2/ and nothing from
// the sandbox site. Code's bytes (each file counted at its size on disk, the
// way the test server sends it, uncompressed): with no extension at all, within
// +1 KB of the tip (the two hooks in ide.js and main.js). With level 1
// extensions the level 1 modules carry level 2's hooks (host.js decides when
// to load js/ext2/host2.js; the panel shows everyone what will work, the
// "Works in Code" filter and how isolation works), so those states have a
// budget instead, printed file by file: +5 KB with an extension active (2, 3)
// and +20 KB with the panel open (4).
// Then, with the code turned on: the manifest's three files fetched once each
// and verified, and after a reload none of them asked from the server again.
// (Tampering, ?noext, ?noext2 and the kill switch: tests/x2_smoke.mjs D and E.)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './lib/x2-server.mjs';
import { fetchVsix, PINNED } from './lib/x2-vsix.mjs';
import { mockOpenVsx } from './lib/openvsx-mock.mjs';
import { themeVsix } from './ext_fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TIP = '84cc38b';                 // main before level 2 (level 1 included)
const BUDGET = { 1: 1024, 2: 5 * 1024, 3: 5 * 1024, 4: 20 * 1024 };
let fails = 0;
const ok = (name, c, extra = '') => { console.log((c ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, { timeout = 30000, every = 150 } = {}) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* reintenta */ } await sleep(every); }
  return v;
}

// ── el árbol del nivel 1, tal cual ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'x2-bytes-'));
execFileSync('/bin/sh', ['-c', `/usr/bin/git -C "$1" archive ${TIP} web | tar -x -C "$2"`, 'sh', REPO, tmp]);
const tipWeb = path.join(tmp, 'web');
if (!fs.existsSync(path.join(tipWeb, 'js/ide.js'))) { console.log('❌ git archive of the tip gave no web/'); process.exit(1); }

let prettier;
try { prettier = (await fetchVsix({ ...PINNED.find(p => p.name === 'prettier-vscode'), offline: process.env.X2_OFFLINE === '1' })).bytes; }
catch (e) { console.log(`⏭️  NOT RUN x2_bytes — esbenp.prettier-vscode@12.4.0: ${e.message}`); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0); }
const theme = themeVsix();

const now = await startServer();
const tip = await startServer({ webRoot: tipWeb });
const trees = { now: { srv: now, web: path.join(REPO, 'web') }, tip: { srv: tip, web: tipWeb } };
const browser = await chromium.launch();

// tamaño de lo que manda el servidor de pruebas: el fichero tal cual, o «not found»
function sizeOf(web, urlPath) {
  try { const st = fs.statSync(path.join(web, decodeURIComponent(urlPath))); return st.isDirectory() ? fs.statSync(path.join(web, decodeURIComponent(urlPath), 'index.html')).size : st.size; }
  catch { return 'not found'.length; }
}

async function freshPage(tree) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* — */ } });
  const page = await ctx.newPage();
  await page.goto(tree.srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const o = await navigator.storage.getDirectory();
    const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
    await w('app.js', 'const  x = {a:1}\n');
    await w('notes.md', '# notes\n');
  });
  return { ctx, page };
}
const openIde = async (page, tree) => {
  await page.goto(tree.srv.codeOrigin + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });
};
const host = page => page.evaluate(async () => !!(await (await import('/js/ide.js')).loadExt()));
async function installFile(page, name, bytes, opts = {}) {
  return page.evaluate(async ({ name, b64, opts }) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const h = await (await import('/js/ide.js')).loadExt();
    const rec = await h.install(new File([u8], name), opts);
    return rec.id;
  }, { name, b64: Buffer.from(bytes).toString('base64'), opts });
}

// la página medida: cada petición, hasta que todo queda quieto
async function measure(ctx, page, steps) {
  const reqs = [];
  let last = Date.now(), inflight = 0;
  const onReq = r => { reqs.push(r.url()); inflight++; last = Date.now(); };
  const onDone = () => { inflight--; last = Date.now(); };
  ctx.on('request', onReq); ctx.on('requestfinished', onDone); ctx.on('requestfailed', onDone);
  await steps();
  await until(() => inflight <= 0 && Date.now() - last > 1500, { timeout: 30000, every: 100 });
  ctx.off('request', onReq); ctx.off('requestfinished', onDone); ctx.off('requestfailed', onDone);
  return reqs;
}

function summarize(tree, reqs) {
  const origin = tree.srv.codeOrigin;
  const own = [], cdn = [], sandbox = [];
  for (const u of reqs) {
    if (u.startsWith('data:') || u.startsWith('blob:')) continue;
    const x = new URL(u);
    if (x.origin === origin) own.push(x.pathname + x.search);
    else if (x.hostname === 'localhost') sandbox.push(x.pathname);
    else cdn.push(x.origin + x.pathname);
  }
  const bytes = own.reduce((n, p) => n + sizeOf(tree.web, p.split('?')[0]), 0);
  return { own: own.sort(), cdn: cdn.sort(), sandbox, bytes };
}

const diff = (a, b) => {
  const count = l => l.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const ca = count(a), cb = count(b), out = [];
  for (const k of new Set([...a, ...b])) { const d = (ca.get(k) || 0) - (cb.get(k) || 0); if (d) out.push((d > 0 ? '+' : '') + d + ' ' + k); }
  return out;
};

async function compare(label, run, budget) {
  const r = {};
  for (const k of ['tip', 'now']) r[k] = summarize(trees[k], await run(trees[k], k));
  const d = diff(r.now.own, r.tip.own);
  const l2 = r.now.own.filter(p => /^\/vendor\/x2\/|^\/js\/ext2\//.test(p));
  ok(`${label}: nothing from level 2 (vendor, js/ext2) and nothing from the sandbox site`, !l2.length && !r.now.sandbox.length, [...l2, ...r.now.sandbox].join(' '));
  ok(`${label}: the same ${r.tip.own.length} requests to Code’s site as the tip`, !d.length, d.slice(0, 6).join(' · '));
  const dc = diff(r.now.cdn, r.tip.cdn);
  ok(`${label}: the same ${r.tip.cdn.length} requests elsewhere (Monaco’s CDN) as the tip`, !dc.length, dc.slice(0, 4).join(' · '));
  const delta = r.now.bytes - r.tip.bytes;
  const grown = [...new Set(r.now.own.map(p => p.split('?')[0]))]
    .map(p => [p, sizeOf(trees.now.web, p) - sizeOf(trees.tip.web, p)]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  ok(`${label}: Code’s bytes within +${budget >= 2048 ? budget / 1024 + ' KB' : '1 KB'} of the tip (${r.tip.bytes} → ${r.now.bytes}, ${delta >= 0 ? '+' : ''}${delta})`, delta <= budget,
    grown.slice(0, 8).map(([p, n]) => `${p} ${n > 0 ? '+' : ''}${n}`).join(' · '));
  return r;
}

// ── 1. sin extensiones ──
await compare('1 no extensions', async tree => {
  const { ctx, page } = await freshPage(tree);
  const reqs = await measure(ctx, page, async () => {
    await openIde(page, tree);
    await page.evaluate(async () => { await (await import('/js/ide.js')).openFile('app.js'); });
  });
  await ctx.close();
  return reqs;
}, BUDGET[1]);

// ── 2. solo nivel 1: un tema instalado y elegido ──
await compare('2 level 1 only', async tree => {
  const { ctx, page } = await freshPage(tree);
  await openIde(page, tree);
  await host(page);
  const id = await installFile(page, 'elf-theme.vsix', theme);
  await page.evaluate(async id => { const h = await (await import('/js/ide.js')).loadExt(); const t = h.themes().find(x => x.ext === id); await h.setTheme(t.id); }, id);
  const reqs = await measure(ctx, page, async () => {
    await openIde(page, tree);
    await page.evaluate(async () => { await (await import('/js/ide.js')).openFile('app.js'); });
  });
  await ctx.close();
  return reqs;
}, BUDGET[2]);

// ── 3. una extensión con código instalada, con el código apagado ──
const runsOff = {};
await compare('3 code extension installed, its code off', async (tree, k) => {
  const { ctx, page } = await freshPage(tree);
  await openIde(page, tree);
  await host(page);
  if (k === 'now') {
    const id = await installFile(page, 'prettier.vsix', prettier, { withCode: true });
    await page.evaluate(async id => { const h = await (await import('/js/ide.js')).loadExt(); await h.setRuns(id, false); }, id);
    runsOff.rec = await page.evaluate(async id => { const h = await (await import('/js/ide.js')).loadExt(); const r = h.list().find(e => e.id === id); return { code: !!r.code, runs: r.runs }; }, id);
    // el recinto que arrancó al instalarla se desmonta antes de medir
    await until(() => page.evaluate(() => !document.getElementById('x2-sandbox')), { timeout: 30000 });
  } else await installFile(page, 'prettier.vsix', prettier);
  const reqs = await measure(ctx, page, async () => {
    await openIde(page, tree);
    await page.evaluate(async () => { await (await import('/js/ide.js')).openFile('app.js'); });
  });
  await ctx.close();
  return reqs;
}, BUDGET[3]);
ok('3 premise: the extension was installed with its code, and the code is off', runsOff.rec?.code === true && runsOff.rec?.runs === false, JSON.stringify(runsOff.rec));

// ── 4. el panel abierto y una búsqueda hecha ──
const fake = (name, extra) => ({ namespace: 'elffuss-test', name, version: '1.0.0', keywords: ['elffuss-bytes'], published: null,
  manifest: { name, publisher: 'elffuss-test', version: '1.0.0', displayName: 'Bytes ' + name, engines: { vscode: '^1.80.0' }, ...extra } });
const fakes = [
  fake('web', { browser: './web.js', contributes: { commands: [{ command: 'b.x', title: 'X' }] } }),
  fake('node', { main: './out.js' }),
  fake('theme', { contributes: { themes: [{ label: 'T', uiTheme: 'vs-dark', path: './t.json' }] } }),
];
await compare('4 the panel open and a search done', async tree => {
  const { ctx, page } = await freshPage(tree);
  await mockOpenVsx(ctx, fakes);
  const reqs = await measure(ctx, page, async () => {
    await openIde(page, tree);
    await page.click('#act-ext');
    await page.waitForSelector('#ext-q');
    await page.fill('#ext-q', 'elffuss-bytes');
    await page.press('#ext-q', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('#ext-results .ext-row').length === 3, null, { timeout: 15000 });
  });
  await ctx.close();
  return reqs;
}, BUDGET[4]);

// ── 5. con el código encendido: el bundle una vez, verificado, y de la caché después ──
{
  const { ctx, page } = await freshPage(trees.now);
  await openIde(page, trees.now);
  await host(page);
  const before = now.requests.length;
  const id = await installFile(page, 'prettier.vsix', prettier, { withCode: true });
  const st = await until(() => page.evaluate(async () => { const s = (await import('/js/ext2/bridge.js')).state(); return s.state === 'running' || s.state === 'error' ? s.state : null; }), { timeout: 90000 });
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'web/js/ext2/vendor-manifest.json'), 'utf8'));
  const vendor = now.requests.slice(before).map(r => r.url.split('?')[0]).filter(u => u.startsWith('/vendor/x2/'));
  const want = manifest.files.map(f => `/vendor/x2/${manifest.buildId}/${f.name}.gz`).sort();
  ok('5 code on: the sandbox runs on the verified bundle', st === 'running', String(st));
  ok('5 the manifest’s three files, once each, from its buildId', JSON.stringify(vendor.sort()) === JSON.stringify(want), vendor.join(' '));
  const before2 = now.requests.length;
  await openIde(page, trees.now);
  const st2 = await until(() => page.evaluate(async () => { const s = (await import('/js/ext2/bridge.js')).state(); return s.state === 'running' || s.state === 'error' ? s.state : null; }), { timeout: 90000 });
  const again = now.requests.slice(before2).map(r => r.url.split('?')[0]).filter(u => u.startsWith('/vendor/x2/'));
  ok('5 after a reload the sandbox runs again and the server is not asked for the bundle again (HTTP cache)', st2 === 'running' && again.length === 0, `${st2}; ${again.join(' ')}`);
  await page.evaluate(async id => { const h = await (await import('/js/ide.js')).loadExt(); await h.uninstall(id); }, id);
  ok('5 uninstalling it takes the sandbox down', !!(await until(() => page.evaluate(() => !document.getElementById('x2-sandbox')))));
  await ctx.close();
}

await browser.close();
await now.close();
await tip.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

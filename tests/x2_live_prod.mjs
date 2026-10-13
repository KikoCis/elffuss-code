// Nivel 2 en PRODUCCIÓN: humo después de cada despliegue de Code. Es x2_live
// (sort-lines 1.12.0 y Prettier 12.4.0, versión y SHA-256 fijadas) contra el
// sitio publicado, sin servidor ni baliza propios: en su lugar comprueba, por el
// origen de cada marco, que del recinto solo se piden sus dos documentos y que
// los marcos del recinto no piden nada a ningún otro sitio.
//
//   X2_CODE=https://code.elffuss.com X2_SANDBOX=https://x2.utopiaia.com node tests/x2_live_prod.mjs
//
// Falla (no se salta) si falta alguna de las dos variables o si no son https:
// contra un servidor local daría por bueno algo que no es producción. Escribe
// solo en el perfil temporal del propio navegador de la prueba. No va en
// run-modes.sh, que corre contra el árbol local.
import { chromium } from 'playwright';
import { fetchVsix, readCode, seedReal, PINNED } from './lib/x2-vsix.mjs';

let fails = 0;
const ok = (name, c, extra = '') => { console.log((c ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, { timeout = 30000, every = 200 } = {}) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* reintenta */ } await sleep(every); }
  return v;
}

const pkgs = [];
for (const p of PINNED) {
  try { pkgs.push(await readCode((await fetchVsix({ ...p, offline: process.env.X2_OFFLINE === '1' })).bytes)); }
  catch (e) { console.log(`⏭️  NOT RUN x2_live — ${p.namespace}.${p.name}@${p.version}: ${e.message}`); process.exit(0); }
}
ok('SHA-256 de los dos .vsix coincide con la publicada y con la fijada', pkgs.length === 2);

const need = (k) => {
  const v = process.env[k];
  let u = null; try { u = new URL(v); } catch { /* sin valor o no es una URL */ }
  if (!u || u.protocol !== 'https:') { console.log(`❌ ${k} tiene que ser una URL https de producción (es ${JSON.stringify(v ?? null)})`); process.exit(1); }
  return u;
};
const CODE = need('X2_CODE'), SANDBOX = need('X2_SANDBOX');
const srv = { codeOrigin: CODE.origin };
const reqs = [];
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); localStorage.setItem('elffusscode.ext.onlyWorks', '0'); } catch { /* — */ } });
const page = await ctx.newPage();
ctx.on('request', r => { try { const u = new URL(r.url()); let fo = ''; try { fo = new URL(r.frame().url()).host; } catch {} reqs.push({ host: u.host, path: u.pathname, frameHost: fo }); } catch {} });
const errors = [], x2log = [];
page.on('console', m => { if (m.text().includes('[x2]')) x2log.push(m.text().slice(0, 600)); });
page.on('pageerror', e => { if (e.message !== 'Canceled') errors.push(JSON.stringify({ name: e.name, message: e.message, stack: String(e.stack || '').slice(0, 400) })); });
await page.goto(srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('fruits.txt', 'pear\napple\nfig\nbanana\ncherry\ndate\n');
  await w('ugly.js', 'const  x = {a:1,b:[1,2,3]}\n');
});
for (const pkg of pkgs) await seedReal(page, pkg);
const since = reqs.length;
await page.goto(srv.codeOrigin + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });
const open = p => page.evaluate(async p => { await (await import('/js/ide.js')).openFile(p); }, p);
const value = () => page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue());
const state = () => page.evaluate(async () => (await import('/js/ext2/bridge.js')).state());

await open('fruits.txt');
const st = await until(async () => { const s = await state(); return s.state === 'running' || s.state === 'error' ? s : null; }, { timeout: 60000 });
ok('el recinto arranca con las dos extensiones', st?.state === 'running', JSON.stringify(st?.error));

// sort-lines: su comando, desde las entradas de la paleta de Code
const entries = await until(async () => { const c = (await state()).commands; return c.some(e => e.id === 'sortLines.sortLines') ? c : null; });
ok('sort-lines aporta sus comandos a la paleta', !!entries && entries.length >= 10, entries ? entries.length + ' commands' : 'none');
await page.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 6, endColumn: 5 }); ed.focus(); });
await sleep(300);
await page.evaluate(async () => (await import('/js/ext2/bridge.js')).commands().find(e => e.id === 'sortLines.sortLines').run());
ok('Sort Lines (Tyriar.sort-lines) ordena el texto en el editor de Code', !!(await until(async () => (await value()) === 'apple\nbanana\ncherry\ndate\nfig\npear\n')), JSON.stringify(await value()));

// Prettier: Format Document
await open('ugly.js');
await until(async () => (await state()).extensions.find(e => e.id === 'esbenp.prettier-vscode')?.state === 'active', { timeout: 60000 });
let formatted = null;
for (let i = 0; i < 20 && !formatted; i++) {
  await page.evaluate(async () => { const ed = window.monaco.editor.getEditors()[0]; ed.focus(); await ed.getAction('editor.action.formatDocument').run(); });
  formatted = await until(async () => { const v = await value(); return v === 'const x = { a: 1, b: [1, 2, 3] };\n' ? v : null; }, { timeout: 1500 });
}
ok('Format Document con Prettier', !!formatted, JSON.stringify(await value()));

// sus ajustes llegan al recinto: sin punto y coma
await page.evaluate(async () => {
  const store = await import('/js/ext/store.js');
  const rec = await store.get('esbenp.prettier-vscode');
  rec.settings = { 'prettier.semi': false };
  await store.put(rec, new Map());
  const host = await (await import('/js/ide.js')).loadExt();
  await host.setEnabled('esbenp.prettier-vscode', true);
});
await page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().setValue('const  y = {a:1}\n'));
let semi = null;
for (let i = 0; i < 20 && !semi; i++) {
  await page.evaluate(async () => { const ed = window.monaco.editor.getEditors()[0]; ed.focus(); await ed.getAction('editor.action.formatDocument').run(); });
  semi = await until(async () => { const v = await value(); return v === 'const y = { a: 1 }\n' ? v : null; }, { timeout: 1500 });
}
ok('los ajustes de la extensión llegan («prettier.semi»: false)', !!semi, JSON.stringify(await value()));

await sleep(1000);
const after = reqs.slice(since);
const sandboxDocs = [...new Set(after.filter(r => r.host === SANDBOX.host).map(r => r.path))];
ok(`del recinto (${SANDBOX.host}) solo sus dos documentos`, sandboxDocs.length > 0 && sandboxDocs.every(u => u === '/x2/v1/sandbox.html' || u === '/x2/v1/exthost-iframe.html'), sandboxDocs.join(' '));
const fromSandbox = [...new Set(after.filter(r => r.frameHost === SANDBOX.host && r.host !== '' && r.host !== SANDBOX.host).map(r => r.host + r.path))];
ok('los marcos del recinto no piden nada a ningún otro sitio', fromSandbox.length === 0, fromSandbox.slice(0, 5).join(' '));
const buildId = await page.evaluate(async () => (await (await fetch('/js/ext2/vendor-manifest.json', { cache: 'no-store' })).json()).buildId).catch(() => null);
const vendor = [...new Set(after.filter(r => r.path.startsWith('/vendor/x2/')).map(r => r.host + r.path))];
ok(`el bundle llega desde ${CODE.host}/vendor/x2/${buildId}/`, !!buildId && vendor.length >= 1 && vendor.every(u => u.startsWith(`${CODE.host}/vendor/x2/${buildId}/`)), vendor.join(' '));
ok('sin errores de página', errors.length === 0, errors.slice(0, 3).join(' | '));
const sandboxErrors = x2log.filter(t => /unhandled|uncaught/.test(t));
if (sandboxErrors.length) console.log('errores dentro del recinto (registro de la página):\n' + sandboxErrors.slice(0, 8).join('\n'));

await browser.close();
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

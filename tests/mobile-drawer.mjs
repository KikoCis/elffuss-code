// Móvil: el cajón ☰ con el árbol y las herramientas.
//
// En un teléfono la barra de actividad, el árbol y la barra de menús están
// ocultos, así que en la vista Editor no había forma de abrir un fichero (solo
// enlaces del chat o @) y la Mente, el terminal, las vistas 3D y las skills
// eran inalcanzables. Ahora ☰ abre un cajón con todo eso.
//
//   BASE=http://127.0.0.1:8898 node tests/mobile-drawer.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
await ctx.route(/soundcloud/, r => r.abort());
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));

await p.goto(BASE + '/manifest.json');
await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const w = await (await root.getFileHandle('README.md', { create: true })).createWritable(); await w.write('# Hola\n'); await w.close();
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.monaco && document.querySelector('#tree [data-path]'), null, { timeout: 30000 });
const visible = sel => p.evaluate(sel => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; }, sel);

ok('en el móvil, el árbol y la barra de actividad empiezan ocultos', !(await visible('#sidebar')) && !(await visible('#activity')));
ok('…y hay un botón ☰', await visible('#btn-drawer'));
await p.tap('#btn-drawer');
await p.waitForTimeout(200);
ok('☰ abre el cajón con el árbol y las herramientas', await visible('#sidebar') && await visible('#activity') && await visible('#act-term') && await p.evaluate(() => document.getElementById('btn-drawer').getAttribute('aria-expanded') === 'true'));
await p.tap('#tree .file[data-path="README.md"]');
await p.waitForTimeout(400);
const trasAbrir = await p.evaluate(() => ({ editor: document.body.classList.contains('show-editor'), cajon: document.body.classList.contains('drawer-open'), activa: document.querySelector('#tabs-bar .tab.active')?.dataset.path }));
ok('un fichero del cajón se abre en la vista Editor y el cajón se cierra', trasAbrir.editor && !trasAbrir.cajon && trasAbrir.activa === 'README.md', JSON.stringify(trasAbrir));
await p.tap('#btn-drawer');
await p.waitForTimeout(150);
await p.tap('#act-term');
await p.waitForTimeout(400);
ok('desde el cajón se llega al terminal', await visible('#terminal-panel') && !(await p.evaluate(() => document.body.classList.contains('drawer-open'))));
await p.tap('#btn-drawer');
await p.waitForTimeout(150);
await p.keyboard.press('Escape');
await p.waitForTimeout(150);
ok('Escape cierra el cajón y devuelve el foco a ☰', await p.evaluate(() => !document.body.classList.contains('drawer-open')));
await p.tap('#btn-drawer');
await p.waitForTimeout(150);
await p.tap('#act-mind');
await p.waitForSelector('#mind-overlay', { timeout: 45000 }).catch(() => {});
ok('desde el cajón se llega a la Mente', await p.evaluate(() => !!document.getElementById('mind-overlay') && getComputedStyle(document.getElementById('mind-overlay')).display !== 'none'));

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ MÓVIL: EL CAJÓN LLEVA A TODO');
await b.close();
process.exit(fails ? 1 : 0);

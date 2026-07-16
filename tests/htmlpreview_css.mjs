// Vista previa HTML: los <link rel=stylesheet href=...> y <script src=...>
// LOCALES del proyecto se incrustan de verdad (antes salían sin CSS: un
// iframe con srcdoc no tiene base URL y esas rutas relativas nunca resuelven).
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('style.css', 'body { background: rgb(17, 34, 51); } #marca { color: rgb(255, 0, 0); font-size: 40px; }');
  await w('page.html', '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1 id="marca">hola</h1></body></html>');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

await p.evaluate(async () => (await import('/js/ide.js')).openFile('page.html'));
await p.waitForTimeout(300);
// abre vista previa desde el menú de la pestaña
await p.locator('#tabs-bar .tab', { hasText: 'page.html' }).click({ button: 'right' });
await p.waitForTimeout(150);
await p.click('#tab-menu .tm-item:has-text("Vista previa")');
await p.waitForTimeout(500);

const frame = p.frameLocator('#md-preview-pane iframe');
const bg = await frame.locator('body').evaluate(el => getComputedStyle(el).backgroundColor);
const color = await frame.locator('#marca').evaluate(el => getComputedStyle(el).color);
const fontSize = await frame.locator('#marca').evaluate(el => getComputedStyle(el).fontSize);
ok('el CSS externo (link href) se aplica de verdad — background', bg === 'rgb(17, 34, 51)', bg);
ok('el CSS externo se aplica de verdad — color del texto', color === 'rgb(255, 0, 0)', color);
ok('el CSS externo se aplica de verdad — font-size', fontSize === '40px', fontSize);

await p.screenshot({ path: OUT + '/htmlpreview_css.png' });
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ VISTA PREVIA HTML: CSS EXTERNO SE APLICA DE VERDAD');
await b.close();
process.exit(fails ? 1 : 0);

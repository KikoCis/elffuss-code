// Vista previa HTML (como la de markdown) + disponible también desde el
// menú contextual del explorador de ficheros (no solo el de la pestaña).
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
  await w('page.html', '<!doctype html><html><body><h1 id="marca">hola desde el HTML real</h1></body></html>');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

// desde el EXPLORADOR (árbol), no desde una pestaña ya abierta
const fileRow = p.locator('#tree .file', { hasText: 'page.html' });
await fileRow.click({ button: 'right' });
await p.waitForTimeout(150);
ok('el árbol ofrece "Vista previa" para un .html', (await p.locator('#tree-menu .tm-item').allInnerTexts()).includes('Vista previa'));
await p.click('#tree-menu .tm-item:has-text("Vista previa")');
await p.waitForTimeout(300);

ok('se abrió como pestaña y quedó en Vista previa', await p.locator('#tabs-bar .tab.tab-preview').count() === 1);
ok('el editor Monaco se oculta', await p.locator('#editor').evaluate(el => getComputedStyle(el).display === 'none'));
const frameCount = await p.locator('#md-preview-pane iframe').count();
ok('se muestra un iframe real (no HTML escapado como texto)', frameCount === 1);
const frame = p.frameLocator('#md-preview-pane iframe');
ok('el HTML se renderiza DE VERDAD (el <h1> real existe en el DOM del iframe)', await frame.locator('#marca').count() === 1);
ok('el texto del h1 real aparece', (await frame.locator('#marca').innerText()) === 'hola desde el HTML real');

await p.screenshot({ path: OUT + '/htmlpreview.png' });
console.log('captura → htmlpreview.png');
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ VISTA PREVIA HTML (desde el explorador) OK');
await b.close();
process.exit(fails ? 1 : 0);

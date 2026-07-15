// Menú contextual de pestañas (botón derecho) + Vista previa de markdown.
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
  await w('README.md', '# Titulo\n\nUn parrafo con **negrita**.');
  await w('app.js', 'export const app = 1;');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

await p.evaluate(async () => (await import('/js/ide.js')).openFile('README.md'));
await p.evaluate(async () => (await import('/js/ide.js')).openFile('app.js'));
await p.waitForTimeout(300);
ok('2 pestañas abiertas', await p.locator('#tabs-bar .tab').count() === 2);

// clic derecho en la pestaña README.md abre el menú custom (no el nativo)
const readmeTab = p.locator('#tabs-bar .tab', { hasText: 'README.md' });
await readmeTab.click({ button: 'right' });
await p.waitForTimeout(150);
ok('menú contextual de pestaña visible', await p.locator('#tab-menu').count() > 0);
const items = await p.locator('#tab-menu .tm-item').allInnerTexts();
ok('incluye Cerrar / Cerrar otras / Cerrar todas / Copiar ruta', ['Cerrar', 'Cerrar otras', 'Cerrar todas', 'Copiar ruta'].every(x => items.includes(x)), items.join(' · '));
ok('README.md (markdown) ofrece Vista previa', items.includes('Vista previa'), items.join(' · '));

// Vista previa: renderiza markdown en vez de mostrar el código fuente
await p.click('#tab-menu .tm-item:has-text("Vista previa")');
await p.waitForTimeout(200);
ok('el editor Monaco se oculta en Vista previa', await p.locator('#editor').evaluate(el => getComputedStyle(el).display === 'none'));
const previewHtml = await p.locator('#md-preview-pane').innerHTML();
ok('el markdown se renderiza FORMATEADO (mismo motor que chat/Mente: título → <h4>, negrita → <b>)', /<h4/.test(previewHtml) && /<b>/.test(previewHtml), previewHtml.slice(0, 80));
ok('la pestaña en Vista previa se marca en cursiva', await readmeTab.evaluate(el => el.classList.contains('tab-preview')));

// clic derecho de nuevo → ahora ofrece volver a "Ver código fuente"
await readmeTab.click({ button: 'right' });
await p.waitForTimeout(150);
const items2 = await p.locator('#tab-menu .tm-item').allInnerTexts();
ok('toggle: ahora ofrece "Ver código fuente"', items2.includes('Ver código fuente'), items2.join(' · '));
await p.click('#tab-menu .tm-item:has-text("Ver código fuente")');
await p.waitForTimeout(200);
ok('vuelve a mostrar Monaco (código fuente)', await p.locator('#editor').evaluate(el => getComputedStyle(el).display !== 'none'));

// app.js (no markdown) NO ofrece Vista previa
const appTab = p.locator('#tabs-bar .tab', { hasText: 'app.js' });
await appTab.click({ button: 'right' });
await p.waitForTimeout(150);
const items3 = await p.locator('#tab-menu .tm-item').allInnerTexts();
ok('app.js (no markdown) NO ofrece Vista previa', !items3.includes('Vista previa'), items3.join(' · '));
await p.keyboard.press('Escape'); await p.mouse.click(700, 400); await p.waitForTimeout(100);

// Cerrar otras
await readmeTab.click({ button: 'right' });
await p.waitForTimeout(150);
await p.click('#tab-menu .tm-item:has-text("Cerrar otras")');
await p.waitForTimeout(200);
ok('«Cerrar otras» deja solo la pestaña activa', await p.locator('#tabs-bar .tab').count() === 1 && await p.locator('#tabs-bar .tab', { hasText: 'README.md' }).count() === 1);

await p.screenshot({ path: OUT + '/tabmenu.png' });
console.log('captura → tabmenu.png');
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ MENÚ DE PESTAÑAS + VISTA PREVIA MARKDOWN OK');
await b.close();
process.exit(fails ? 1 : 0);

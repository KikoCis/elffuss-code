// Vista previa HTML: el iframe va con sandbox="allow-scripts" a propósito
// (SIN allow-same-origin — aislado del proyecto real, ver ide.js applyView).
// Pero eso hace que `localStorage` LANCE al referenciarla — y como suele ser
// de las primeras líneas de un script, el fichero entero se queda sin
// ejecutar, sin aviso (los botones no hacen nada). Se incrusta un shim en
// memoria SOLO cuando hace falta, sin tocar el sandbox real.
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
const pageErrors = [];
p.on('pageerror', e => pageErrors.push(e.message));
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('app.js',
    "const tasks = JSON.parse(localStorage.getItem('tasks')) || [];\n" +
    "document.getElementById('add').addEventListener('click', () => {\n" +
    "  tasks.push(document.getElementById('nueva').value);\n" +
    "  localStorage.setItem('tasks', JSON.stringify(tasks));\n" +
    "  const li = document.createElement('li'); li.textContent = tasks[tasks.length - 1];\n" +
    "  document.getElementById('lista').appendChild(li);\n" +
    "});\n");
  await w('page.html', '<!doctype html><html><head></head><body>' +
    '<input id="nueva" value="tarea real"><button id="add">Add</button><ul id="lista"></ul>' +
    '<script src="app.js"></script></body></html>');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

await p.evaluate(async () => (await import('/js/ide.js')).openFile('page.html'));
await p.waitForTimeout(300);
await p.locator('#tabs-bar .tab', { hasText: 'page.html' }).click({ button: 'right' });
await p.waitForTimeout(150);
await p.click('#tab-menu .tm-item:has-text("Vista previa")');
await p.waitForTimeout(500);

ok('sin excepciones de página al cargar (localStorage no revienta el script)', pageErrors.length === 0, pageErrors.join(' | '));

const frame = p.frameLocator('#md-preview-pane iframe');
await frame.locator('#add').click();
await p.waitForTimeout(200);
const liText = await frame.locator('#lista').innerText().catch(() => '');
ok('el click SÍ ejecuta el script (antes moría en la 1ª línea, sin avisar)', /tarea real/.test(liText), liText);

const stored = await frame.locator('body').evaluate(() => localStorage.getItem('tasks')).catch(e => 'ERR:' + e.message);
ok('localStorage.getItem funciona dentro del iframe (shim en memoria)', /tarea real/.test(stored || ''), stored);

// el shim NUNCA debe tocar el localStorage REAL de la página (aislamiento intacto)
const realStorage = await p.evaluate(() => localStorage.getItem('tasks'));
ok('el localStorage REAL de la IDE no se toca (aislamiento del proyecto real intacto)', realStorage === null, String(realStorage));

await p.screenshot({ path: OUT + '/previewstorage.png' });
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ VISTA PREVIA: localStorage no revienta el script (shim aislado) OK');
await b.close();
process.exit(fails ? 1 : 0);

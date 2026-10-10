// Editor: guardar de verdad, no perder cambios al cerrar, y el árbol que no se
// pliega solo.
//
//   1. Cerrar una pestaña con cambios (●) pregunta: Cancelar la deja abierta,
//      «No guardar» la cierra sin tocar el disco, «Guardar» escribe y cierra.
//      Antes se cerraba y los cambios se perdían sin aviso.
//   2. File › Guardar y «Guardar» de la paleta guardan (antes lanzaban una
//      acción que el Monaco suelto no tiene: no pasaba nada) y la paleta se
//      cierra.
//   3. El atajo anunciado es el de esta máquina (⌘S en Mac, Ctrl+S si no).
//   4. Una escritura del agente repinta el árbol sin plegar lo que estaba
//      abierto.
//   5. Renombrar mueve la pestaña abierta y lo dice; borrar cierra la pestaña;
//      «Copiar ruta» lo dice.
//   6. El árbol se usa con el teclado (↓ y Enter) y Escape cierra su menú.
//   7. «Ir a símbolo» sin fichero abierto lo dice en vez de no hacer nada.
//   8. Guardar una pestaña cuyo fichero se borró lo vuelve a crear Y el
//      explorador lo enseña (antes quedaba fuera del árbol).
//   9. Cerrar una pestaña con el teclado (Supr, o «No guardar») deja el foco en
//      la pestaña que queda (antes caía a <body>).
//
//   BASE=http://127.0.0.1:8898 node tests/editor-save.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1500, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));

// proyecto sembrado ANTES de arrancar el IDE
await p.goto(BASE + '/manifest.json');
await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const escribe = async (path, txt) => {
    const parts = path.split('/'); const name = parts.pop(); let d = root;
    for (const x of parts) d = await d.getDirectoryHandle(x, { create: true });
    const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(txt); await w.close();
  };
  await escribe('README.md', '# Proyecto\n');
  await escribe('src/app.js', 'export const a = 1;\n');
  await escribe('src/util.js', 'export const u = 2;\n');
  await escribe('notes/todo.md', '- tarea\n');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.monaco && document.querySelector('#tree .file'), null, { timeout: 30000 });

const disco = (path) => p.evaluate(async (path) => {
  const parts = path.split('/'); const name = parts.pop(); let d = await navigator.storage.getDirectory();
  try { for (const x of parts) d = await d.getDirectoryHandle(x); return await (await (await d.getFileHandle(name)).getFile()).text(); }
  catch { return null; }
}, path);
const pestañas = () => p.evaluate(() => [...document.querySelectorAll('#tabs-bar .tab')].map(t => ({ path: t.dataset.path, dirty: !!t.querySelector('.dirty'), active: t.classList.contains('active') })));
const estado = () => p.evaluate(() => document.getElementById('statusbar').textContent);
const abre = async (path) => { await p.evaluate((path) => window.elffussClaw.openFile(path), path); await p.waitForTimeout(200); };
const escribeEnEditor = async (txt) => {
  await p.click('#editor .view-lines');
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
  await p.keyboard.type(txt);
  await p.waitForTimeout(100);
};
const cerrarActiva = () => p.locator('#tabs-bar .tab.active').locator('.tab-x, b').first().click();
const dialogo = (val) => p.locator(`#dirty-dialog button[data-val="${val}"]`).click();

// 1 · cerrar con cambios
await abre('src/app.js');
await escribeEnEditor('// cambio 1\n');
let tb = await pestañas();
ok('1 · la pestaña queda marcada con cambios (●)', tb.find(t => t.path === 'src/app.js')?.dirty, JSON.stringify(tb));
await cerrarActiva();
await p.waitForTimeout(150);
const hayDialogo = await p.locator('#dirty-dialog').isVisible().catch(() => false);
ok('1 · cerrar una pestaña con cambios pregunta', hayDialogo);
await dialogo('cancel');
tb = await pestañas();
ok('1 · Cancelar: la pestaña sigue abierta y con sus cambios', tb.some(t => t.path === 'src/app.js' && t.dirty), JSON.stringify(tb));
await cerrarActiva();
await dialogo('discard');
await p.waitForTimeout(150);
tb = await pestañas();
ok('1 · No guardar: se cierra y el disco no cambia', !tb.some(t => t.path === 'src/app.js') && (await disco('src/app.js')) === 'export const a = 1;\n', JSON.stringify(tb));
await abre('src/app.js');
await escribeEnEditor('// cambio 2\n');
await cerrarActiva();
await dialogo('save');
await p.waitForTimeout(250);
tb = await pestañas();
const tras = await disco('src/app.js');
ok('1 · Guardar: escribe en disco y cierra', !tb.some(t => t.path === 'src/app.js') && tras.includes('// cambio 2'), JSON.stringify({ tb, tras }));

// 2 · File › Guardar
await abre('README.md');
await escribeEnEditor('linea nueva\n');
await p.click('#menubar button[data-menu="file"]');
const hint = await p.locator('#topmenu .menu-item', { hasText: 'Guardar' }).locator('span').textContent();
await p.locator('#topmenu .menu-item', { hasText: 'Guardar' }).click();
await p.waitForTimeout(250);
tb = await pestañas();
ok('2 · File › Guardar escribe el fichero', (await disco('README.md')).includes('linea nueva'));
ok('2 · …la pestaña deja de estar marcada y la barra de estado lo dice', !tb.find(t => t.path === 'README.md')?.dirty && /guardado/.test(await estado()), JSON.stringify(tb) + ' · ' + await estado());
const esMac = await p.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform || ''));
ok('3 · el atajo anunciado es el de esta máquina', hint === (esMac ? '⌘S' : 'Ctrl+S'), hint);

// 2 · paleta › Guardar
await escribeEnEditor('otra linea\n');
await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
await p.waitForSelector('#palette:not([hidden])');
await p.fill('#pal-input', '>Guardar');
await p.waitForTimeout(100);
await p.press('#pal-input', 'Enter');
await p.waitForTimeout(250);
ok('2 · la paleta › Guardar escribe el fichero', (await disco('README.md')).includes('otra linea'));
ok('2 · …y la paleta se cierra', await p.locator('#palette').isHidden());

// 4 · el árbol no se pliega tras una escritura del agente
await p.locator('#tree summary', { hasText: 'src' }).click();
await p.locator('#tree summary', { hasText: 'notes' }).click();
await p.waitForTimeout(200);
await p.evaluate(async () => { const code = await import('/js/tools/code.js'); await code.write({ path: 'src/nuevo.js', content: 'export {}\n' }); });
await p.waitForTimeout(400);
const abiertas = await p.evaluate(() => [...document.querySelectorAll('#tree details[open] > summary')].map(s => s.dataset.path));
ok('4 · tras escribir el agente, src y notes siguen abiertas', abiertas.includes('src') && abiertas.includes('notes'), JSON.stringify(abiertas));
ok('4 · …y el fichero nuevo aparece dentro', await p.locator('#tree .file[data-path="src/nuevo.js"]').count() === 1);

// 5 · renombrar, copiar ruta y borrar
await abre('src/util.js');
await p.evaluate(() => { window.prompt = () => 'util2.js'; window.confirm = () => true; });
await p.locator('#tree .file[data-path="src/util.js"]').click({ button: 'right' });
await p.locator('#tree-menu .tm-item', { hasText: 'Renombrar' }).click();
await p.waitForTimeout(400);
tb = await pestañas();
ok('5 · renombrar mueve la pestaña abierta a la ruta nueva', tb.some(t => t.path === 'src/util2.js') && !tb.some(t => t.path === 'src/util.js'), JSON.stringify(tb));
ok('5 · …y lo dice en la barra de estado', /Renombrado/.test(await estado()), await estado());
await p.locator('#tabs-bar .tab[data-path="src/util2.js"]').click({ button: 'right' });
await p.locator('#tab-menu .tm-item', { hasText: 'Copiar ruta' }).click();
await p.waitForTimeout(200);
ok('5 · «Copiar ruta» lo dice', /Ruta copiada|No pude copiar/.test(await estado()), await estado());
await p.locator('#tree .file[data-path="src/util2.js"]').click({ button: 'right' });
await p.locator('#tree-menu .tm-item', { hasText: 'Eliminar' }).click();
await p.waitForTimeout(400);
tb = await pestañas();
ok('5 · borrar el fichero cierra su pestaña', !tb.some(t => t.path === 'src/util2.js'), JSON.stringify(tb));

// 6 · teclado en el árbol y Escape en su menú
await p.locator('#tree .file[data-path="README.md"]').focus();
await p.keyboard.press('ArrowUp');
const enfocado = await p.evaluate(() => document.activeElement?.dataset?.path);
ok('6 · ↑ mueve el foco por las filas del árbol', !!enfocado && enfocado !== 'README.md', enfocado);
await p.locator('#tree .file[data-path="src/app.js"]').focus();
await p.keyboard.press('Enter');
await p.waitForTimeout(250);
ok('6 · Enter en una fila de fichero lo abre', (await pestañas()).some(t => t.path === 'src/app.js' && t.active));
await p.keyboard.press('Shift+F10');
await p.waitForTimeout(100);
const menuAbierto = await p.locator('#tree-menu').count();
await p.keyboard.press('Escape');
await p.waitForTimeout(100);
ok('6 · Shift+F10 abre el menú del árbol y Escape lo cierra', menuAbierto === 1 && await p.locator('#tree-menu').count() === 0);

// 8 · guardar una pestaña cuyo fichero se borró lo vuelve a crear, y el árbol lo enseña
await abre('notes/todo.md');
await escribeEnEditor('- otra tarea\n');
await p.locator('#tree .file[data-path="notes/todo.md"]').click({ button: 'right' });
await p.locator('#tree-menu .tm-item', { hasText: 'Eliminar' }).click();
await p.waitForTimeout(400);
ok('8 · borrar un fichero con cambios deja su pestaña abierta (marcada)', (await pestañas()).some(t => t.path === 'notes/todo.md'), JSON.stringify(await pestañas()));
await p.click('#menubar button[data-menu="file"]');
await p.locator('#topmenu .menu-item', { hasText: 'Guardar' }).click();
await p.waitForTimeout(400);
ok('8 · guardarla lo vuelve a crear en disco…', (await disco('notes/todo.md'))?.includes('otra tarea'), String(await disco('notes/todo.md')));
ok('8 · …y el explorador lo enseña otra vez', await p.locator('#tree .file[data-path="notes/todo.md"]').count() === 1);

// 9 · cerrar una pestaña con el teclado deja el foco en la pestaña que queda
await abre('README.md');
await abre('src/app.js');
await p.locator('#tabs-bar .tab.active').focus();
await p.keyboard.press('Delete');
await p.waitForTimeout(300);
const foco9 = await p.evaluate(() => ({ tab: document.activeElement?.classList.contains('tab') ? document.activeElement.dataset.path : null, tag: document.activeElement?.tagName }));
ok('9 · Supr en una pestaña la cierra y el foco pasa a la pestaña activa (no a <body>)', !!foco9.tab && foco9.tab !== 'src/app.js', JSON.stringify(foco9));
await abre('src/app.js');
await escribeEnEditor('// sin guardar\n');
await p.locator('#tabs-bar .tab.active').focus();
await p.keyboard.press('Delete');
await p.waitForTimeout(200);
await p.keyboard.press('Tab');                 // de «Guardar» a «No guardar»
await p.keyboard.press('Enter');
await p.waitForTimeout(300);
const foco9b = await p.evaluate(() => ({ tab: document.activeElement?.classList.contains('tab') ? document.activeElement.dataset.path : null, tag: document.activeElement?.tagName }));
ok('9 · …también tras «No guardar» en el diálogo de cambios', !!foco9b.tab && !(await pestañas()).some(t => t.path === 'src/app.js'), JSON.stringify(foco9b));

// 7 · Ir a símbolo sin fichero abierto
await p.evaluate(() => { for (const x of document.querySelectorAll('#tabs-bar .tab-x')) x.click(); });
await p.waitForTimeout(300);
await p.click('#menubar button[data-menu="edit"]');
await p.locator('#topmenu .menu-item', { hasText: 'Ir a símbolo' }).click();
await p.waitForTimeout(150);
ok('7 · «Ir a símbolo» sin fichero abierto lo dice', /Abre un fichero primero/.test(await estado()), await estado());

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ EDITOR: GUARDAR, CERRAR CON CAMBIOS Y ÁRBOL OK');
await b.close();
process.exit(fails ? 1 : 0);

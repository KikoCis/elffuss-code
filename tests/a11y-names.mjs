// Nombres y valores que oye un lector de pantalla, en tres controles que los
// tenían mal:
//   1. «Modos» con Auto encendido (el de por defecto) decía «Modos: ninguno
//      activo» mientras el menú lo enseñaba marcado.
//   2. Una pestaña del editor se llamaba «app.js Cerrar app.js»: sin nombre
//      propio, el del botón × que lleva dentro se sumaba al suyo.
//   3. El separador del terminal no tenía aria-valuenow hasta el primer
//      arrastre, ni aria-valuemax nunca.
//
//   BASE=http://localhost:8799 node tests/a11y-names.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); localStorage.removeItem('elffusscode.autoedit'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(BASE + '/manifest.json');
await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const w = await (await root.getFileHandle('app.js', { create: true })).createWritable(); await w.write('export const a = 1;\n'); await w.close();
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 20000 });

// 1 · Modos
const nombreModos = () => p.evaluate(() => document.getElementById('btn-modos').getAttribute('aria-label'));
const conAuto = await nombreModos();
ok('1 · con Auto encendido, «Modos» lo dice (no «ninguno activo»)', /Auto/.test(conAuto) && !/ninguno/.test(conAuto), conAuto);
await p.click('#btn-modos'); await p.click('#btn-autoedit');
const conRevisar = await nombreModos();
ok('1 · con Auto apagado dice «revisar antes de escribir»', /revisar antes de escribir/.test(conRevisar) && !/Auto/.test(conRevisar), conRevisar);
await p.click('#btn-goal');
const conObjetivo = await nombreModos();
ok('1 · y suma los demás modos encendidos', /revisar antes de escribir/.test(conObjetivo) && /objetivo/.test(conObjetivo), conObjetivo);
await p.click('#btn-goal'); await p.click('#btn-autoedit'); await p.keyboard.press('Escape');

// 2 · pestaña del editor
await p.locator('#tree .file', { hasText: 'app.js' }).first().click();
await p.waitForSelector('#tabs-bar .tab.active');
const pestana = () => p.evaluate(() => { const t = document.querySelector('#tabs-bar .tab.active'); return { nombre: t.getAttribute('aria-label'), x: t.querySelector('.tab-x')?.getAttribute('aria-label') }; });
const limpia = await pestana();
ok('2 · la pestaña se llama como el fichero, sin el «Cerrar…» del ×', limpia.nombre === 'app.js', JSON.stringify(limpia));
ok('2 · …y el × conserva su propio nombre', limpia.x === 'Cerrar app.js', JSON.stringify(limpia));
// una edición de verdad en el editor (como teclear)
await p.evaluate(() => window.monaco.editor.getEditors()[0]?.trigger('teclado', 'type', { text: '// cambio\n' }));
await p.waitForTimeout(300);
const sucia = await pestana();
ok('2 · con cambios sin guardar, el nombre lo dice', sucia.nombre === 'app.js (cambios sin guardar)', JSON.stringify(sucia));

// 3 · separador del terminal
await p.keyboard.press('Control+`');
await p.waitForFunction(() => !document.getElementById('terminal-panel').hidden, null, { timeout: 5000 }).catch(() => {});
await p.waitForTimeout(300);
const sep = await p.evaluate(() => { const h = document.getElementById('term-resize'); const panel = document.getElementById('terminal-panel');
  return { now: h.getAttribute('aria-valuenow'), min: h.getAttribute('aria-valuemin'), max: h.getAttribute('aria-valuemax'), alto: panel.offsetHeight, ventana: innerHeight }; });
ok('3 · el separador dice su altura al abrir (sin arrastrarlo antes)', sep.now !== null && +sep.now === sep.alto, JSON.stringify(sep));
ok('3 · …y su máximo', sep.max !== null && +sep.max === Math.max(120, sep.ventana - 160) && +sep.max >= +sep.now && +sep.min <= +sep.now, JSON.stringify(sep));
await p.focus('#term-resize');
await p.keyboard.press('ArrowUp');
const tras = await p.evaluate(() => ({ now: +document.getElementById('term-resize').getAttribute('aria-valuenow'), alto: document.getElementById('terminal-panel').offsetHeight }));
ok('3 · con ↑ crece y el valor lo sigue', tras.now === tras.alto && tras.now > +sep.now, JSON.stringify(tras));

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ NOMBRES ACCESIBLES OK — Modos, pestañas y separador');
await b.close();
process.exit(fails ? 1 : 0);

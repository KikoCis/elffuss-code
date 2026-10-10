// Elffuss Lab: que lo que se ve sea lo que corre.
//
//   1. Desde el IDE se llega al Lab (View › Elffuss Lab y la paleta); antes
//      solo escribiendo la URL.
//   2. Cambiar de cerebro en la lista descarta el cargado: antes una corrida
//      «con onnx» se ejecutaba con Reglas. «Lanzar» espera a que el cerebro
//      elegido esté cargado cuando el banco lo necesita.
//   3. Cambiar de banco repinta el ranking de ese banco.
//   4. ■ a mitad: «parado (parcial)», no «✔ terminado/completado», y no
//      entra en el ranking.
//   5. «Abrir el IDE con este cerebro» hace solo eso (antes prometía aplicar
//      algoritmo y perillas que el IDE no lee).
// El cerebro «onnx» es de mentira (page.route sirve un providers/onnx.js propio).
//
//   BASE=http://127.0.0.1:8898 node tests/lab-ux.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const FALSO = `export let name = 'falso'; export async function load() {}
export async function chat() { return 'hecho'; }`;

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const errs = [];

// 1 · el IDE lleva al Lab
const ide = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
ide.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await ide.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await ide.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 15000 });
await ide.evaluate(() => { window.__abiertas = []; window.open = (u) => { window.__abiertas.push(String(u)); return null; }; });
await ide.click('#menubar button[data-menu="view"]');
const enMenu = await ide.locator('#topmenu .menu-item', { hasText: 'Elffuss Lab' }).count();
await ide.locator('#topmenu .menu-item', { hasText: 'Elffuss Lab' }).click().catch(() => {});
await ide.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
await ide.fill('#pal-input', '>Lab');
await ide.waitForTimeout(150);
await ide.press('#pal-input', 'Enter');
const abiertas = await ide.evaluate(() => window.__abiertas);
ok('1 · View › Elffuss Lab abre el Lab', enMenu === 1 && abiertas[0] === 'lab.html', JSON.stringify(abiertas));
ok('1 · …y también la paleta', abiertas[1] === 'lab.html', JSON.stringify(abiertas));
await ide.close();

const p = await ctx.newPage({ viewport: { width: 1300, height: 900 } });
p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.route('**/js/providers/onnx.js*', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: FALSO }));
await p.goto(BASE + '/lab.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(600);
const estado = () => p.evaluate(() => ({
  led: document.querySelector('#led-model').textContent.trim(), run: document.getElementById('btn-run').disabled,
  hint: document.getElementById('run-hint').textContent, prog: document.getElementById('prog-txt').textContent,
  rank: document.getElementById('rank-tag').textContent, log: document.getElementById('log').textContent,
  ultima: document.getElementById('log').lastElementChild?.textContent || '',
}));

// 2 · cargar Reglas y cambiar a onnx
await p.click('#btn-load');                                   // Reglas
await p.waitForFunction(() => /modelo: rules/.test(document.querySelector('#led-model').textContent), null, { timeout: 5000 });
await p.locator('#brains label').nth(1).click();              // onnx
let e = await estado();
ok('2 · cambiar de cerebro descarta el que estaba cargado', /sin cargar/.test(e.led), e.led);
await p.locator('#benches label').nth(2).click();             // juegos: necesita cerebro
e = await estado();
ok('2 · con un banco que necesita cerebro, «Lanzar» espera a que se cargue', e.run && /Carga el cerebro «onnx»/.test(e.hint), JSON.stringify(e));
await p.click('#btn-load');
await p.waitForFunction(() => /modelo: onnx/.test(document.querySelector('#led-model').textContent), null, { timeout: 5000 });
e = await estado();
ok('2 · cargado el elegido, «Lanzar» se habilita', !e.run && !e.hint, JSON.stringify(e));

// 3 · el ranking sigue al banco
await p.locator('#benches label').nth(0).click();             // contexto
await p.click('#btn-run');
await p.waitForFunction(() => /completado/.test(document.getElementById('prog-txt').textContent), null, { timeout: 15000 });
await p.click('#btn-save');
e = await estado();
ok('3 · el ranking de «contexto» tiene la corrida guardada', /1 corridas · contexto/.test(e.rank), e.rank);
await p.locator('#benches label').nth(1).click();             // swe
e = await estado();
ok('3 · al cambiar a «swe» el ranking es el de swe', /sin corridas de swe/.test(e.rank), e.rank);

// 4 · ■ a mitad: parcial
await p.locator('#benches label').nth(0).click();             // contexto otra vez
await p.evaluate(() => { document.getElementById('btn-run').click(); document.getElementById('btn-stop').click(); });
await p.waitForFunction(() => !document.getElementById('btn-stop').disabled === false && /parado/.test(document.getElementById('prog-txt').textContent), null, { timeout: 15000 }).catch(() => {});
e = await estado();
ok('4 · parado a mitad: dice «parado (parcial)», no «completado»', e.prog === 'parado (parcial)' && /parado: resultado PARCIAL/.test(e.ultima) && !/terminado/.test(e.ultima), e.prog + ' · ' + e.ultima.slice(0, 90));
// Parcial no es comparable: «Guardar» no la mete en el ranking (su porcentaje
// competiría con el de corridas completas aunque fuera marcada).
const filasAntes = await p.evaluate(() => document.querySelectorAll('#rank-body tr').length);
await p.click('#btn-save');
const r4 = await p.evaluate(() => ({ filas: document.querySelectorAll('#rank-body tr').length, ultima: document.getElementById('log').lastElementChild?.textContent || '' }));
ok('4 · la corrida parada no entra en el ranking, y se dice', r4.filas === filasAntes && /no entra en el ranking/.test(r4.ultima), JSON.stringify(r4));

// 5 · abrir el IDE con este cerebro
await p.evaluate(() => { window.open = () => null; localStorage.setItem('elffusscode.ctxopts', '{"MMR":false}'); });
const etiqueta = await p.locator('#btn-launch').textContent();
await p.click('#btn-launch');
const r5 = await p.evaluate(() => ({ model: localStorage.getItem('elffusscode.model'), ctx: localStorage.getItem('elffusscode.ctxopts'), algo: localStorage.getItem('elffusscode.algo') }));
ok('5 · el botón dice lo que hace', /Abrir el IDE con este cerebro/.test(etiqueta), etiqueta);
ok('5 · guarda el cerebro y no deja claves que el IDE no lee', r5.model === 'onnx' && r5.ctx === null && r5.algo === null, JSON.stringify(r5));

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ LAB: LO QUE SE VE ES LO QUE CORRE');
await b.close();
process.exit(fails ? 1 : 0);

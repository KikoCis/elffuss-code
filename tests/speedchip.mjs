// Chip ⚡ de velocidad (velocimetro.js).
//
//   1. Con el motor cargado DOS veces (montar() otra vez), el clic sigue
//      abriendo el panel. Antes cada montar() añadía otro par de oyentes: el
//      clic abría y cerraba a la vez y el panel no se abría nunca.
//   2. aria-expanded en el chip, y Escape cierra el panel devolviendo el foco.
//   3. Al pasar a un cerebro que no mide (Básico, ONNX, externo) el chip se
//      oculta; antes seguía enseñando las cifras del motor.
// El «motor» es de mentira: un proveedor con alMedir/ultimaMedida.
//
//   BASE=http://127.0.0.1:8898 node tests/speedchip.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 20000 });

await p.evaluate(async () => {
  const vm = await import('/js/velocimetro.js');
  const medida = { prefillTokS: 240, genTokS: 21, ttftMs: 320, genTokens: 12, procesados: 300, enCurso: false };
  window.__motor = { alMedir(cb) { window.__motor.cb = cb; return () => { window.__motor.cb = null; }; }, ultimaMedida: () => medida };
  vm.montar(window.__motor);
  vm.montar(window.__motor);       // el motor cargado otra vez
});
const estado = () => p.evaluate(() => ({ chip: !document.getElementById('speed-chip').hidden, panel: !document.getElementById('speed-panel').hidden, exp: document.getElementById('speed-chip').getAttribute('aria-expanded') }));
ok('el chip se ve con el motor cargado', (await estado()).chip);
await p.click('#speed-chip');
await p.waitForTimeout(100);
let e = await estado();
ok('1 · montado dos veces, el clic abre el panel', e.panel, JSON.stringify(e));
ok('2 · aria-expanded refleja el panel abierto', e.exp === 'true', JSON.stringify(e));
await p.keyboard.press('Escape');
await p.waitForTimeout(100);
e = await estado();
ok('2 · Escape lo cierra y el foco vuelve al chip', !e.panel && e.exp === 'false' && await p.evaluate(() => document.activeElement?.id === 'speed-chip'), JSON.stringify(e));
await p.click('#speed-chip');
await p.waitForTimeout(100);
ok('1 · y se vuelve a abrir', (await estado()).panel);

// 3 · cambiar a Básico desde Ajustes
await p.click('#btn-settings');
await p.waitForTimeout(300);
await p.locator('#settings-panel .model-card', { hasText: 'Básico' }).click();
await p.waitForTimeout(400);
e = await estado();
ok('3 · al pasar a Básico el chip y el panel se ocultan', !e.chip && !e.panel, JSON.stringify(e));
ok('3 · …y se deja de escuchar al motor', await p.evaluate(() => window.__motor.cb === null));

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CHIP DE VELOCIDAD OK');
await b.close();
process.exit(fails ? 1 : 0);

// Chip ⚡ de velocidad (velocimetro.js).
//
//   1. Con el motor cargado DOS veces (montar() otra vez), el clic sigue
//      abriendo el panel. Antes cada montar() añadía otro par de oyentes: el
//      clic abría y cerraba a la vez y el panel no se abría nunca.
//   2. aria-expanded en el chip, y Escape cierra el panel devolviendo el foco.
//   3. Al pasar a un cerebro que no mide (Básico, ONNX, externo) el chip se
//      oculta; antes seguía enseñando las cifras del motor.
//   4. «Tareas» cuenta solo las del motor, de ese modelo: los turnos del modo
//      Básico entraban como si fueran suyas.
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

// 4 · «Tareas» son las del motor, no las de cualquier cerebro. Los turnos del
// modo Básico entraban como tareas del motor, y la nota decía «en esta sesión,
// medidos por el propio motor», aunque se guardan entre sesiones y las
// cronometra el IDE.
{
  const guardadas = () => p.evaluate(() => JSON.parse(localStorage.getItem('elffuss.velocimetro.v1') || '{}').tareas || []);
  const antes = (await guardadas()).length;
  for (const txt of ['hola', 'arbol']) {
    await p.fill('#prompt', txt);
    await p.press('#prompt', 'Enter');
    await p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 10000 });
  }
  const trasBasico = (await guardadas()).length;
  ok('4 · los turnos del modo Básico no se apuntan como tareas del motor', trasBasico === antes, `${antes} → ${trasBasico}`);
  // Tareas guardadas por la versión de antes (sin modelo: no se sabe de qué
  // cerebro son) y el motor (de mentira, mide) que contesta un turno.
  await p.evaluate(async () => {
    localStorage.setItem('elffuss.velocimetro.v1', JSON.stringify({ hist: [], tareas: [{ ok: true, ms: 5 }, { ok: false, ms: 7 }] }));
    const vm = await import('/js/velocimetro.js');
    const conv = await import('/js/conversations.js');
    const medida = { prefillTokS: 240, genTokS: 21, ttftMs: 320, genTokens: 12, procesados: 300, enCurso: false };
    window.__motor2 = { name: 'motor de prueba', alMedir() { return () => {}; }, ultimaMedida: () => medida, modeloEtiqueta: () => 'Modelo de prueba', chat: async () => 'hecho.' };
    vm.montar(window.__motor2);
    conv.setProvider(window.__motor2);
  });
  await p.fill('#prompt', 'una tarea para el motor');
  await p.press('#prompt', 'Enter');
  await p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 10000 });
  const ultima = (await guardadas()).at(-1);
  // (sin tiempos en la salida: solo si se resolvió y de qué modelo es)
  ok('4 · la del motor sí se apunta, con su modelo', ultima?.ok === true && ultima?.modelo === 'Modelo de prueba', JSON.stringify({ ok: ultima?.ok, modelo: ultima?.modelo }));
  await p.click('#speed-chip');
  await p.waitForTimeout(100);
  const texto = await p.evaluate(() => document.getElementById('speed-panel').innerText.replace(/\s+/g, ' '));
  ok('4 · el panel cuenta solo las de este modelo («1 de 1»), no las guardadas sin modelo', /\(1 de 1\)/.test(texto), (texto.match(/se resuelven \([^)]*\)/) || ['sin tareas'])[0]);
  const nota = (texto.match(/Son los números[^]*$/) || [''])[0];
  ok('4 · la nota no dice «en esta sesión» y dice que las tareas las cronometra el IDE', !/en esta sesión/.test(nota) && /las cronometra el IDE/.test(nota), nota.slice(0, 200));
}

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CHIP DE VELOCIDAD OK');
await b.close();
process.exit(fails ? 1 : 0);

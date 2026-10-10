// El botón de parar de verdad para: proveedor simulado que genera lento y sigue
// pidiendo tools; se aborta a mitad y se comprueba que corta y no ejecuta más.
// Además: la parada que llega DE FUERA (la conversación, el modo Objetivo, el
// cerebro CEO) por `handle(texto, onEvent, { signal })`, y que un proveedor que
// lanza AbortError cuenta como «parado» y no como error del modelo.
//
//   BASE=http://localhost:8799 node tests/stop.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await b.newContext()).newPage();
// Telemetría: se cuentan los informes en vez de dejarlos salir.
let informes = 0;
await p.route('**/proxy/report', route => { informes++; return route.fulfill({ status: 204, body: '' }); });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);

// 1. stop() a mitad de generación
const r = await p.evaluate(async () => {
  const { Agent } = await import('/js/agent.js');
  const eventos = [];
  let llamadas = 0;
  // proveedor que SIEMPRE pide una tool y respeta la señal (espera y comprueba)
  const lento = { chat: async (h, s, cb, signal) => {
    llamadas++;
    for (let i = 0; i < 20; i++) { if (signal?.aborted) break; await new Promise(r => setTimeout(r, 50)); }
    return '```tool\n{"tool":"code.tree","args":{}}\n```';
  }};
  const ag = new Agent(lento);
  const run = ag.handle('haz algo largo', ev => eventos.push(ev.type));
  await new Promise(r => setTimeout(r, 300));   // deja arrancar
  const llamadasAntes = llamadas;
  ag.stop();                                     // ← PARAR a mitad
  await run;                                     // debe terminar pronto, no agotar MAX_STEPS
  return { eventos: [...new Set(eventos)], llamadasAntes, llamadasTotal: llamadas, abortado: eventos.includes('aborted') };
});
ok('stop() a mitad: emite «aborted» y no sigue el bucle', r.abortado && r.llamadasTotal <= r.llamadasAntes + 1,
  `eventos ${r.eventos.join(',')} · llamadas antes ${r.llamadasAntes}, total ${r.llamadasTotal}`);

// 2. Parada de fuera: ya abortada antes de empezar, y abortada a mitad
const r2 = await p.evaluate(async () => {
  const { Agent } = await import('/js/agent.js');
  let llamadas = 0;
  const lento = { chat: async (h, s, cb, signal) => {
    llamadas++;
    for (let i = 0; i < 40; i++) {
      if (signal?.aborted) throw new DOMException('Parado', 'AbortError');
      cb('x'); await new Promise(r => setTimeout(r, 25));
    }
    return 'respuesta completa';
  }};
  const ag = new Agent(lento);
  const ya = new AbortController(); ya.abort();
  const ev1 = [];
  await ag.handle('no debería ni empezar', ev => ev1.push(ev.type), { signal: ya.signal });
  const tras1 = { llamadas, historial: ag.history.length, eventos: ev1 };

  const ac = new AbortController();
  const ev2 = [];
  const run = ag.handle('para a mitad', ev => { ev2.push(ev.type); if (ev.type === 'token' && ev2.filter(t => t === 'token').length === 3) ac.abort(); }, { signal: ac.signal });
  await run;
  return { tras1, llamadas, eventos2: [...new Set(ev2)], tokens: ev2.filter(t => t === 'token').length, ultimo: ag.history.at(-1)?.role };
});
ok('parada de fuera ya abortada: «aborted» sin llamar al modelo', r2.tras1.llamadas === 0 && r2.tras1.eventos.join() === 'aborted',
  `llamadas ${r2.tras1.llamadas} · eventos ${r2.tras1.eventos.join(',')}`);
ok('  …y sin apuntar el mensaje en el historial', r2.tras1.historial === 0, `historial ${r2.tras1.historial}`);
ok('parada de fuera a mitad de turno: «aborted», ni un token más', r2.eventos2.includes('aborted') && !r2.eventos2.includes('error') && r2.tokens === 3,
  `eventos ${r2.eventos2.join(',')} · tokens ${r2.tokens}`);
ok('  …y la respuesta parada no entra en el historial', r2.ultimo === 'user', `último ${r2.ultimo}`);

// 3. Un proveedor que lanza AbortError es «parado», no un fallo del modelo,
//    y no va a telemetría. Control positivo: un Error normal sí es error y sí se
//    informa (si no, el contador de informes no probaría nada).
const r3 = await p.evaluate(async () => {
  const tel = await import('/js/telemetry.js');
  tel.setEnabled(true);
  const { Agent } = await import('/js/agent.js');
  const ev1 = [];
  await new Agent({ chat: async () => { throw new DOMException('cortado', 'AbortError'); } })
    .handle('hola', ev => ev1.push(ev.type));
  await new Promise(r => setTimeout(r, 300));
  const ev2 = [];
  await new Agent({ chat: async () => { throw new Error('reventó de verdad'); } })
    .handle('hola', ev => ev2.push(ev.type));
  await new Promise(r => setTimeout(r, 300));
  tel.setEnabled(false);
  return { ev1, ev2 };
});
ok('proveedor que lanza AbortError → «aborted», no «error»', r3.ev1.includes('aborted') && !r3.ev1.includes('error'), r3.ev1.join(','));
ok('control: un Error normal sigue siendo «error»', r3.ev2.includes('error'), r3.ev2.join(','));
ok('a telemetría solo llega el error de verdad (1 informe, no 2)', informes === 1, `${informes} informes`);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ PARAR OK — de dentro y de fuera, y parar no es un error');
await b.close();
process.exit(fails ? 1 : 0);

// 🎯 Parar un objetivo a media tarea. Antes: las tareas que faltaban se quedaban
// «pendientes» y el plan terminaba en «completado»; y la tarea interrumpida
// contaba como «no usó ninguna herramienta» y se REINTENTABA, o sea que parar
// volvía a llamar al modelo. Ahora: tarea en curso «parada», el resto
// «saltadas», ningún reintento y el plan en 'stopped'.
//
// Proveedor con guion (mismo patrón que goalfail.mjs): la 1.ª llamada es el
// planificador y devuelve tres tareas; la 2.ª es la tarea 1, lenta, y se para.
//
//   BASE=http://localhost:8799 node tests/goalstop.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 120)));
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// El guion vive en la página: window.__guion() crea uno nuevo con su contador.
await p.evaluate(() => {
  window.__guion = () => {
    const g = { llamadas: 0, vistasTrasParar: 0 };
    const PLAN = JSON.stringify({ plan: 'tres pasos', tasks: [
      { title: 'Paso uno', description: 'mira el árbol' },
      { title: 'Paso dos', description: 'lee el README' },
      { title: 'Paso tres', description: 'resume' },
    ] });
    g.chat = async (h, s, cb, signal) => {
      g.llamadas++;
      if (/^ROL: PLANIFICADOR/.test(s || '')) return PLAN;
      for (let i = 0; i < 200; i++) {
        if (signal?.aborted) throw new DOMException('Parado', 'AbortError');
        cb('.'); await new Promise(r => setTimeout(r, 20));
      }
      return '```tool\n{"tool":"code.tree","args":{}}\n```';
    };
    return g;
  };
});

// A. runGoal con la señal del turno (lo que le pasa conversations.js)
const a = await p.evaluate(async () => {
  const { runGoal } = await import('/js/goal.js');
  const { Agent } = await import('/js/agent.js');
  const g = window.__guion();
  const conv = { agent: new Agent(g), stopped: false, plan: null };
  const ac = new AbortController();
  const tipos = [];
  let ultimoPlan = null;
  await runGoal(conv, 'objetivo de prueba', ev => {
    tipos.push(ev.type);
    if (ev.plan) ultimoPlan = ev.plan;
    if (ev.type === 'token' && !ac.signal.aborted) ac.abort();   // parar en cuanto la tarea 1 escribe
  }, { signal: ac.signal });
  return {
    llamadas: g.llamadas, status: conv.plan?.status, eventoFinal: ultimoPlan?.status,
    tareas: conv.plan?.tasks.map(t => t.status), reintentos: conv.plan?.tasks[0]?.retries,
    abortados: tipos.filter(t => t === 'aborted').length, errores: tipos.filter(t => t === 'error').length,
    completo: tipos.includes('plan_complete'),
  };
});
ok('A · el plan acaba en «stopped», no en «completado»', a.status === 'stopped' && a.eventoFinal === 'stopped', `${a.status} / evento ${a.eventoFinal}`);
ok('A · exactamente 2 llamadas al modelo (planificador + tarea 1), sin reintentos', a.llamadas === 2 && a.reintentos === 0, `${a.llamadas} llamadas, ${a.reintentos} reintentos`);
ok('A · tarea 1 «stopped», tareas 2 y 3 «skipped»', JSON.stringify(a.tareas) === '["stopped","skipped","skipped"]', JSON.stringify(a.tareas));
ok('A · un solo «(Parado.)» y ningún error', a.abortados === 1 && a.errores === 0, `${a.abortados} aborted, ${a.errores} error`);
ok('A · se emite plan_complete (la tarjeta se cierra)', a.completo);

// A2. Parada que llega mientras se PLANIFICA: no se ejecuta ninguna tarea.
const a2 = await p.evaluate(async () => {
  const { runGoal } = await import('/js/goal.js');
  const { Agent } = await import('/js/agent.js');
  let llamadas = 0;
  const ac = new AbortController();
  const lentoPlanificando = { chat: async (h, s, cb, signal) => {
    llamadas++;
    for (let i = 0; i < 200; i++) {
      if (signal?.aborted) throw new DOMException('Parado', 'AbortError');
      await new Promise(r => setTimeout(r, 20));
    }
    return '{"plan":"x","tasks":[{"title":"a","description":"a"}]}';
  }};
  const conv = { agent: new Agent(lentoPlanificando), stopped: false, plan: null };
  const tipos = [];
  setTimeout(() => ac.abort(), 150);
  await runGoal(conv, 'objetivo', ev => tipos.push(ev.type), { signal: ac.signal });
  return { llamadas, status: conv.plan?.status, tareas: conv.plan?.tasks.length, tipos: [...new Set(tipos)] };
});
ok('A2 · parar mientras planifica: «stopped», 1 llamada, sin error', a2.status === 'stopped' && a2.llamadas === 1 && !a2.tipos.includes('error'),
  `${a2.status} · ${a2.llamadas} llamadas · ${a2.tipos.join(',')}`);

// B. Por la conversación, como el botón ■: startGoal + stopActive
const bRes = await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  const g = window.__guion();
  const prev = conv.getProvider();
  conv.setProvider(g);
  const c = conv.getActive();
  conv.startGoal(c.id, 'objetivo por la conversación');
  const hasta = async (f, n = 300) => { for (let i = 0; i < n && !f(); i++) await new Promise(r => setTimeout(r, 20)); return f(); };
  await hasta(() => g.llamadas >= 2);
  await new Promise(r => setTimeout(r, 100));     // la tarea 1 ya está escribiendo
  const paro = conv.stopActive();
  const terminado = await hasta(() => !c.pumping);
  await new Promise(r => setTimeout(r, 200));
  conv.setProvider(prev);
  return { paro, terminado, llamadas: g.llamadas, status: c.plan?.status, tareas: c.plan?.tasks.map(t => t.status), cola: c.queue.length };
});
ok('B · stopActive() durante la tarea 1 termina el turno', bRes.paro && bRes.terminado, `stopActive ${bRes.paro}, terminado ${bRes.terminado}`);
ok('B · plan «stopped», tareas [stopped, skipped, skipped]', bRes.status === 'stopped' && JSON.stringify(bRes.tareas) === '["stopped","skipped","skipped"]',
  `${bRes.status} ${JSON.stringify(bRes.tareas)}`);
ok('B · exactamente 2 llamadas al modelo', bRes.llamadas === 2, `${bRes.llamadas}`);
ok('B · la cola queda vacía', bRes.cola === 0, `${bRes.cola}`);

console.log('\n  errores JS:', errs[0] || 'ninguno');
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ PARAR UN OBJETIVO OK — se para, no reintenta y no se anuncia como completado');
await b.close();
process.exit(fails ? 1 : 0);

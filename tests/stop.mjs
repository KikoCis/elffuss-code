// El botón de parar de verdad para: proveedor simulado que genera lento y sigue
// pidiendo tools; se aborta a mitad y se comprueba que corta y no ejecuta más.
import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await b.newContext()).newPage();
await p.goto('https://code.elffuss.utopiaia.com/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
const r = await p.evaluate(async () => {
  const { Agent } = await import('/js/agent.js?v=' + Date.now());
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
console.log('parada del agente:');
console.log('  eventos:', r.eventos.join(', '));
console.log('  llamadas al modelo antes de parar:', r.llamadasAntes, '· total tras parar:', r.llamadasTotal);
const ok = r.abortado && r.llamadasTotal <= r.llamadasAntes + 1;   // no siguió llamando en bucle
console.log(ok ? '\n✅ para de verdad: emite «aborted» y no sigue el bucle'
               : '\n❌ no paró bien');
await b.close();
process.exit(ok ? 0 : 1);

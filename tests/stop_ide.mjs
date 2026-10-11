// stop.mjs con el IDE abierto: el botón de parar del agente para de verdad
// también con un proyecto abierto en el editor (y, en el modo extensiones de
// run-modes.sh, con el recinto de extensiones corriendo al lado, que stop.mjs
// nunca llega a arrancar porque se queda en la portada).
//
//   BASE=http://127.0.0.1:<port> node tests/stop_ide.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
const b = await chromium.launch();
const ctx = await b.newContext();
// Modo Básico: sin esto, main.js se pone a cargar el modelo local por defecto
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const f = await o.getFileHandle('app.js', { create: true });
  const s = await f.createWritable(); await s.write('function a() { return 1; }\n'); await s.close();
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 60000 });
await p.evaluate(async () => { await (await import('/js/ide.js')).openFile('app.js'); });
const ide = await p.evaluate(() => !!document.querySelector('#editor .monaco-editor') && window.monaco.editor.getEditors()[0].getModel().getValue().includes('function a'));
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
console.log('parada del agente con el IDE abierto:');
console.log('  eventos:', r.eventos.join(', '));
console.log('  llamadas al modelo antes de parar:', r.llamadasAntes, '· total tras parar:', r.llamadasTotal);
const ok = ide && r.abortado && r.llamadasTotal <= r.llamadasAntes + 1;
console.log(ide ? '✅ el IDE está abierto con el proyecto' : '❌ el IDE no se abrió');
console.log(ok ? '✅ para de verdad: emite «aborted» y no sigue el bucle'
               : '❌ no paró bien');
await b.close();
process.exit(ok ? 0 : 1);

// Demuestra el bug del modo Objetivo: una tarea que NO toca nada se marcaba
// como hecha. Proveedor de guion (sin GPU, sin modelo), determinista.
import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await b.newContext()).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 80)));
await p.goto('https://code.elffuss.utopiaia.com/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

const r = await p.evaluate(async () => {
  const { Agent } = await import('/js/agent.js?v=' + Date.now());
  const out = { eventos: [] };

  // (a) proveedor que NUNCA emite una tool-call: el agente termina en el primer
  // turno (no agota pasos), así que el criterio no puede ser 'exhausted' sino
  // que NO se usó ninguna herramienta.
  const mudo = { chat: async () => 'Voy pensando en ello, pero no hago nada.' };
  const ag = new Agent(mudo);
  await ag.handle('arregla el bug', ev => out.eventos.push(ev.type));

  // (b) proveedor cuya herramienta SIEMPRE falla
  const roto = { chat: async () => '```tool\n{"tool":"code.read","args":{"path":"noexiste.js"}}\n```' };
  const ev2 = [];
  const ag2 = new Agent(roto);
  await ag2.handle('lee un fichero que no existe', ev => ev2.push(ev.type));

  return {
    sinHerramientas: !out.eventos.includes('tool'),
    tiposA: [...new Set(out.eventos)],
    errorHerramienta: ev2.includes('tool_error'),
    tiposB: [...new Set(ev2)],
  };
});

const ok = (t, c, extra='') => console.log(`  ${c ? '✓' : '✗'} ${t}${extra ? ' — ' + extra : ''}`);
console.log('MODO OBJETIVO — detección de fallo\n');
ok('responder sin usar herramientas es detectable (goal lo marca como fallo)', r.sinHerramientas, r.tiposA.join(','));
ok('una herramienta que falla emite «tool_error»', r.errorHerramienta, r.tiposB.join(','));
console.log('\n  errores JS:', errs[0] || 'ninguno');
const fallos = [r.sinHerramientas, r.errorHerramienta].filter(x => !x).length;
console.log(fallos ? `\n❌ ${fallos} FALLO(S)` : '\n✅ el plan ya no puede terminar en verde sin haber hecho nada');
await b.close();
process.exit(fallos ? 1 : 0);

// Valida que la elfa AGUANTA sesiones largas: (1) el gestor de contexto
// (context.js, ACE-lite) mantiene el historial ACOTADO conservando lo reciente
// y lo relevante aunque crezca a cientos de mensajes; (2) el bucle del agente
// sostiene tareas de muchos pasos (varias tool-calls encadenadas) sin romperse.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// ---- 1) context.js mantiene acotada una sesión de 200 mensajes ----
const cres = await p.evaluate(async () => {
  const { packHistory } = await import('/js/context.js');
  const hist = [];
  for (let i = 0; i < 200; i++) {
    hist.push({ role: i % 2 ? 'assistant' : 'user', content: `mensaje número ${i} sobre cosas variadas y relleno para gastar tokens `.repeat(4) });
  }
  // una pista antigua que DEBE sobrevivir por relevancia a la consulta reciente
  hist[12] = { role: 'user', content: 'el token secreto del proyecto es ZANActl-42 recuérdalo' };
  hist[199] = { role: 'user', content: '¿cuál era el token secreto ZANActl del proyecto?' };
  const packed = packHistory(hist, 2200);
  const tok = packed.reduce((s, m) => s + Math.ceil((m.content || '').length / 4), 0);
  return {
    inLen: hist.length, outLen: packed.length, tok,
    keptRecent: packed.some(m => m.content.includes('¿cuál era el token secreto')),
    keptRelevant: packed.some(m => m.content.includes('ZANActl-42')),
    hasOmission: packed.some(m => /omitidos/.test(m.content)),
  };
});
ok('200 msgs → historial ACOTADO (evicción)', cres.outLen < cres.inLen && cres.tok <= 2600, `${cres.inLen}→${cres.outLen} msgs, ~${cres.tok} tok`);
ok('conserva el mensaje reciente (la consulta)', cres.keptRecent);
ok('conserva el mensaje ANTIGUO relevante por BM25 (token secreto)', cres.keptRelevant);
ok('marca los huecos con marca de omisión', cres.hasOmission);

// ---- 2) bucle largo del agente: 10 rondas de tool-calls sin romperse ----
const loop = await p.evaluate(async () => {
  const { Agent } = await import('/js/agent.js');
  let n = 0;
  const fake = { chat: async () => {
    n++;
    if (n <= 10) return `Paso ${n}, sigo trabajando:\n\`\`\`tool\n{"tool":"code.tree","args":{}}\n\`\`\``;
    return 'He terminado la tarea larga.';
  } };
  const a = new Agent(fake);
  const ev = [];
  await a.handle('haz una tarea larga de muchos pasos', e => ev.push(e.type));
  return { tools: ev.filter(t => t === 'tool_result').length, finishedText: ev.at(-1) === 'text', turns: n };
});
ok('el agente sostiene ~10 pasos de herramientas en una tarea', loop.tools >= 9, `${loop.tools} tool-results en ${loop.turns} turnos`);
ok('la tarea larga termina con respuesta final (no se cuelga)', loop.finishedText);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ SESIONES LARGAS OK — contexto acotado + bucle multi-paso');
await b.close();
process.exit(fails ? 1 : 0);

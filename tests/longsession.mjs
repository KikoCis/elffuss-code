// Valida que la elfa AGUANTA sesiones largas: (1) el gestor de contexto
// (context.js, ACE-lite) mantiene el historial ACOTADO conservando lo reciente
// y lo relevante aunque crezca a cientos de mensajes; (2) el bucle del agente
// sostiene tareas de muchos pasos (varias tool-calls encadenadas) sin romperse.
//
// Se ejecuta DOS veces, con el lado semántico apagado y encendido:
//     node tests/longsession.mjs                 → sólo BM25 (por defecto)
//     SEMANTIC=on node tests/longsession.mjs     → BM25 + embeddings
// La segunda descarga el modelo de embeddings la primera vez que se corre.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
const SEM = process.env.SEMANTIC === 'on';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(sem => {
  try {
    localStorage.setItem('elffusscode.model', 'rules');
    if (sem) localStorage.setItem('elffuss.semantic', 'on');
    else localStorage.removeItem('elffuss.semantic');
  } catch {}
}, SEM);
const p = await ctx.newPage();
console.log(`— lado semántico: ${SEM ? 'ENCENDIDO' : 'apagado'} —`);
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// ---- 0) coste REAL de la primera carga del lado semántico ------------------
// Se mide aparte y ANTES que nada para que no se cuele dentro del coste de un
// turno. Contexto de navegador limpio ⇒ es la descarga completa, el peor caso.
if (SEM) {
  const load = await p.evaluate(async () => {
    const t0 = performance.now();
    const mod = await import('/js/embed.js');
    await mod.warmup();
    return { ms: Math.round(performance.now() - t0), backend: mod.backend };
  });
  ok('el modelo de embeddings carga (perezoso, a la primera petición)', !!load.backend,
     `${load.backend.device}/${load.backend.dtype} · descarga ${load.backend.sizeMB} MB · primera carga en frío ${load.ms} ms`);
}

// ---- 1) context.js mantiene acotada una sesión de 200 mensajes ----
const cres = await p.evaluate(async () => {
  const { packHistoryAsync } = await import('/js/context.js');
  const hist = [];
  for (let i = 0; i < 200; i++) {
    hist.push({ role: i % 2 ? 'assistant' : 'user', content: `mensaje número ${i} sobre cosas variadas y relleno para gastar tokens `.repeat(4) });
  }
  // una pista antigua que DEBE sobrevivir por relevancia a la consulta reciente
  hist[12] = { role: 'user', content: 'el token secreto del proyecto es ZANActl-42 recuérdalo' };
  hist[199] = { role: 'user', content: '¿cuál era el token secreto ZANActl del proyecto?' };
  const packed = await packHistoryAsync(hist, 2200);
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

// ---- 1b) MISMA prueba pero con mensajes del TAMAÑO REAL de una herramienta ----
// El caso de arriba usa mensajes de ~68 tokens; un [resultado code.read] real son
// ~1.5k. Con tamaños reales, los últimos RECENT mensajes por sí solos se salían del
// presupuesto → no sobrevivía NINGÚN mensaje antiguo y se devolvían 2× los tokens
// pedidos. Esta prueba es la que lo detecta; sin ella el fallo es invisible.
const rres = await p.evaluate(async () => {
  const { packHistoryAsync } = await import('/js/context.js');
  const relleno = (i) => `linea ${i} de salida de herramienta con rutas web/js/mod${i}.js y detalles varios`;
  const hist = [];
  for (let i = 0; i < 40; i++) {
    hist.push({ role: 'assistant', content: `Voy a mirar esto.\n{"tool":"code.read","args":{"path":"web/js/mod${i}.js"}}` });
    hist.push({ role: 'user', content: `[resultado code.read]\n` + Array.from({ length: 90 }, (_, k) => relleno(i * 100 + k)).join('\n') });
  }
  hist[13] = { role: 'user', content: '[resultado code.read]\nconst TOKEN_SECRETO = "ZANActl-42";\n' + Array.from({ length: 80 }, (_, k) => relleno(k)).join('\n') };
  hist.push({ role: 'user', content: '¿cuál era el valor de TOKEN_SECRETO? cítame la línea' });
  const packed = await packHistoryAsync(hist, 2200);
  const tok = packed.reduce((s, m) => s + Math.ceil((m.content || '').length / 4), 0);
  return { tok, kept: packed.some(m => m.content.includes('ZANActl-42')) };
});
ok('presupuesto RESPETADO con mensajes de tamaño real', rres.tok <= 2400, `~${rres.tok} tok para un presupuesto de 2200`);
ok('el dato antiguo que se vuelve a pedir SOBREVIVE (tamaños reales)', rres.kept);

// ---- 1c) PUNTO CIEGO LÉXICO: la pregunta NO nombra lo que busca ------------
// Los dos casos de arriba tienen solape literal (la pregunta dice "ZANActl"),
// que es donde BM25 brilla. Este es el caso contrario y es la razón entera de
// que exista el lado semántico: la línea antigua y la pregunta SIGNIFICAN lo
// mismo pero no comparten ni una palabra con contenido. Medido en LoCoMo,
// partiendo las preguntas por solape de vocabulario con la respuesta:
//   sin solape (n=107): BM25 18,60 · embeddings 24,28 · fusión 24,05
//   con solape  (n=93): BM25 29,33 · embeddings 23,58 · fusión 32,73
// Sin esta prueba nadie sabría si el lado semántico hace algo o no.
const sres = await p.evaluate(async () => {
  const { packHistoryAsync } = await import('/js/context.js');
  const hist = [];
  // El relleno comparte con la pregunta una palabra ubicua y sin contenido
  // ("cuando"), así que TODAS estas líneas puntúan algo en BM25 y compiten por
  // el presupuesto. La línea que de verdad responde no comparte NINGUNA.
  for (let i = 0; i < 200; i++) {
    hist.push({ role: i % 2 ? 'assistant' : 'user', content: `nota ${i}: se revisaron cosas menores y quedaron apuntadas cuando tocaba, sin conclusiones` });
  }
  // Solape léxico CERO con la pregunta: ni una palabra en común (ni siquiera de
  // relleno). Sólo coinciden en SIGNIFICADO — password↔credencial,
  // servidor interno↔staging, subir cambios↔autenticarme.
  hist[12] = { role: 'user', content: 'el password para subir cambios al servidor interno es ZANActl-42' };
  hist[199] = { role: 'user', content: '¿qué credencial necesito cuando quiero autenticarme contra staging?' };

  const t0 = performance.now();
  const packed = await packHistoryAsync(hist, 2200);
  const primerTurno = Math.round(performance.now() - t0);

  // segundo turno: la caché por contenido debe hacer que sólo se codifique
  // lo NUEVO; si el coste no baja, la caché no está sirviendo de nada
  hist.push({ role: 'assistant', content: 'Déjame comprobarlo.' });
  hist.push({ role: 'user', content: '¿y con qué credencial entraba uno en staging?' });
  const t1 = performance.now();
  await packHistoryAsync(hist, 2200);
  const segundoTurno = Math.round(performance.now() - t1);

  const mod = await import('/js/embed.js').catch(() => null);
  return {
    kept: packed.some(m => m.content.includes('ZANActl-42')),
    tok: packed.reduce((s, m) => s + Math.ceil((m.content || '').length / 4), 0),
    primerTurno, segundoTurno,
    backend: mod && mod.backend ? `${mod.backend.device}/${mod.backend.dtype} · ${mod.backend.sizeMB} MB` : 'sin modelo',
    cacheados: mod && mod.embedCacheSize ? mod.embedCacheSize() : 0,
  };
});
if (SEM) {
  ok('la línea antigua PARAFRASEADA (sin solape léxico) sobrevive', sres.kept,
     `${sres.backend}, ${sres.cacheados} textos en caché`);
  ok('la caché por contenido abarata el segundo turno', sres.segundoTurno < sres.primerTurno,
     `1er turno ${sres.primerTurno} ms → 2º turno ${sres.segundoTurno} ms (modelo ya cargado; el 2º sólo codifica lo nuevo)`);
  ok('el presupuesto se sigue respetando por la vía híbrida', sres.tok <= 2600, `~${sres.tok} tok`);
} else {
  // No es un fallo: es el punto ciego DOCUMENTADO de la vía léxica. Si algún día
  // esto pasa a verde con la bandera apagada, la sonda ha dejado de sondear.
  ok('(semántico apagado) punto ciego conocido: la paráfrasis NO sobrevive a BM25', !sres.kept);
  ok('(semántico apagado) no se toca el modelo de embeddings', sres.backend === 'sin modelo', sres.backend);
}

// ---- 1d) compatibilidad: packHistory síncrona sigue existiendo e igual ------
const compat = await p.evaluate(async () => {
  const { packHistory, packHistoryAsync } = await import('/js/context.js');
  const hist = [];
  for (let i = 0; i < 60; i++) hist.push({ role: i % 2 ? 'assistant' : 'user', content: `linea ${i} con contenido variado y algo de relleno para gastar tokens` });
  hist.push({ role: 'user', content: '¿qué decía la linea 7?' });
  const s = packHistory(hist, 1200);
  const a = await packHistoryAsync(hist, 1200);
  return { esFuncion: typeof packHistory === 'function', sinPromesa: !(s instanceof Promise), len: s.length, iguales: JSON.stringify(s) === JSON.stringify(a) };
});
ok('packHistory sigue exportada y SÍNCRONA (compatibilidad)', compat.esFuncion && compat.sinPromesa && compat.len > 0);
if (!SEM) ok('con el semántico apagado, sync y async dan lo MISMO', compat.iguales);

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

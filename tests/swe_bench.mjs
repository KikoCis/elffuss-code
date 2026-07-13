// Arnés SWE-bench-style para el elfo del navegador. Corre la batería de
// tasks.js: por cada tarea siembra el repo con bug, deja que el AGENTE lo
// arregle (con sus tools reales), EJECUTA el test de verdad y puntúa `resolved`.
//
// Modos:
//   SOLVER=scripted (por defecto) — solver determinista (read→write) que valida
//     el arnés end-to-end sin depender de la GPU. Debe dar N/N.
//   SOLVER=model M=onnx|litert:gemma-e2b — usa el MODELO real del navegador
//     (mide al elfo de verdad). Pesado: WebGPU headless + descarga de pesos.
//
// Salida estilo results.tsv de agentic-install + score final resolved/N.
import { chromium } from 'playwright';
import { TASKS } from './swe/tasks.js';
const BASE = process.env.BASE || 'http://localhost:8799';
const SOLVER = process.env.SOLVER || 'scripted';
const MODEL = process.env.M || 'rules';
const TIMEOUT = +(process.env.TIMEOUT || (SOLVER === 'model' ? 180000 : 15000));

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(m => { try { localStorage.setItem('elffusscode.model', m); } catch {} }, SOLVER === 'model' ? MODEL : 'rules');
const p = await ctx.newPage();
p.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) console.log('   pageerror:', e.message.slice(0, 120)); });
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(SOLVER === 'model' ? 3000 : 1500);
if (SOLVER === 'model') {
  console.log(`esperando a que cargue el modelo «${MODEL}»…`);
  await p.waitForFunction(() => document.getElementById('model-dot')?.classList.contains('on'), null, { timeout: 300000 })
    .catch(() => console.log('  (aviso: el indicador de modelo no confirmó; continúo igualmente)'));
}

const clearOPFS = () => p.evaluate(async () => { const o = await navigator.storage.getDirectory(); for await (const e of o.values()) await o.removeEntry(e.name, { recursive: true }); });
const seed = files => p.evaluate(async files => {
  const o = await navigator.storage.getDirectory();
  for (const [path, txt] of Object.entries(files)) {
    const parts = path.split('/'); const name = parts.pop(); let d = o;
    for (const x of parts) d = await d.getDirectoryHandle(x, { create: true });
    const f = await d.getFileHandle(name, { create: true }); const w = await f.createWritable(); await w.write(txt); await w.close();
  }
}, files);

// Solver determinista: lee el objetivo y escribe la solución (valida el arnés).
// OJO: a evaluate() solo van campos serializables (task.test es función → fuera).
const runScripted = task => p.evaluate(async t => {
  const { Agent } = await import('/js/agent.js');
  const fake = { chat: async history => {
    const read = history.some(m => m.content.startsWith('[resultado code.read]'));
    const wrote = history.some(m => m.content.includes('Escrito ' + t.target));
    if (!read) return '```tool\n' + JSON.stringify({ tool: 'code.read', args: { path: t.target } }) + '\n```';
    if (!wrote) return 'Arreglo:\n```tool\n' + JSON.stringify({ tool: 'code.write', args: { path: t.target, content: t.solution } }) + '\n```';
    return 'Resuelto.';
  } };
  const a = new Agent(fake);
  const ev = []; await a.handle(t.task, e => ev.push(e.type + (e.tool ? ':' + e.tool : '')));
  return { tools: ev.filter(x => x.startsWith('tool_result')).length };
}, { target: task.target, solution: task.solution, task: task.task });

// Solver con MODELO real: envía la tarea por el composer y espera a que el
// modelo REESCRIBA el fichero objetivo (contenido distinto al sembrado) o timeout.
// (La página se recarga por tarea en el bucle → historial del agente limpio.)
const runModel = async task => {
  const original = task.files[task.target];
  await p.fill('#prompt', task.task + ' Usa code.read y luego code.write con el contenido corregido COMPLETO. No pidas permiso.');
  await p.press('#prompt', 'Enter');
  const t0 = Date.now();
  while (Date.now() - t0 < TIMEOUT) {
    await p.waitForTimeout(2500);
    const cur = await p.evaluate(async target => {
      try { const o = await navigator.storage.getDirectory(); const parts = target.split('/'); const name = parts.pop(); let d = o; for (const x of parts) d = await d.getDirectoryHandle(x); return await (await (await d.getFileHandle(name)).getFile()).text(); } catch { return null; }
    }, task.target);
    if (cur != null && cur !== original) { await p.waitForTimeout(1500); break; }
  }
  return { tools: -1 };
};
async function waitModel() {
  await p.waitForFunction(() => document.getElementById('model-dot')?.classList.contains('on'), null, { timeout: 300000 })
    .catch(() => console.log('  (aviso: modelo no confirmó carga; continúo)'));
}

const verify = task => p.evaluate(async ({ target, testSrc }) => {
  const o = await navigator.storage.getDirectory();
  const read = async path => { const parts = path.split('/'); const name = parts.pop(); let d = o; for (const x of parts) d = await d.getDirectoryHandle(x); return (await (await d.getFileHandle(name)).getFile()).text(); };
  let src; try { src = await read(target); } catch { return { passed: false, err: 'sin fichero' }; }
  try {
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const mod = await import(url);
    const testFn = (0, eval)('(' + testSrc + ')');
    return { passed: !!testFn(mod) };
  } catch (e) { return { passed: false, err: String(e.message || e).slice(0, 60) }; }
}, { target: task.target, testSrc: task.test.toString() });

const LIMIT = +(process.env.LIMIT || TASKS.length);
const BATCH = TASKS.slice(0, LIMIT);
console.log(`\nSWE-style · solver=${SOLVER}${SOLVER === 'model' ? ' · modelo=' + MODEL : ''} · ${BATCH.length} tareas\n`);
console.log('instance'.padEnd(12), 'resolved', 'tools', 'nota');
let resolved = 0;
for (const task of BATCH) {
  await clearOPFS();
  await seed(task.files);
  let tools = '-';
  try {
    if (SOLVER === 'model') {
      // recargar para historial de agente limpio; el modelo carga desde caché
      await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
      await waitModel();
      const r = await runModel(task); tools = r.tools;
    } else {
      const r = await runScripted(task); tools = r.tools;
    }
  } catch (e) { /* el solver falló */ }
  const v = await verify(task);
  if (v.passed) resolved++;
  console.log(task.id.padEnd(12), (v.passed ? '  ✅   ' : '  ❌   '), String(tools).padStart(4), '  ', v.err || '');
}
const pct = Math.round(resolved / TASKS.length * 100);
console.log(`\n📊 resolved ${resolved}/${TASKS.length} (${pct}%) · solver=${SOLVER}${SOLVER === 'model' ? ' modelo=' + MODEL : ''}`);
await b.close();
// en modo scripted exigimos 100% (valida el arnés); en modo modelo solo informamos
process.exit(SOLVER === 'scripted' && resolved !== TASKS.length ? 1 : 0);

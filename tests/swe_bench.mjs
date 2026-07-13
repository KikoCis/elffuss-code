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

// Solver con MODELO real: conduce el Agent con el PROVEEDOR ya cargado por la app
// (mismo singleton del módulo → generator listo) y captura los eventos, así vemos
// SI tool-callea y qué produce (diagnóstico del score, no solo pass/fail).
const runModel = async task => p.evaluate(async ({ task, model, timeout }) => {
  const provPath = model.startsWith('litert') ? '/js/providers/litert.js' : '/js/providers/onnx.js';
  const prov = await import(provPath);
  const { Agent } = await import('/js/agent.js');
  const a = new Agent({ chat: (h, s, cb) => prov.chat(h, s, cb) });
  const ev = []; let lastText = '';
  const done = a.handle(task + ' Lee el fichero con code.read y escríbelo corregido con code.write (contenido COMPLETO). No pidas permiso.',
    e => { ev.push(e.type + (e.tool ? ':' + e.tool : '')); if (e.type === 'text') lastText = (e.text || '').slice(0, 140); });
  await Promise.race([done, new Promise(r => setTimeout(r, timeout))]);
  const reads = ev.filter(x => x === 'tool_result:code.read').length;
  const writes = ev.filter(x => x === 'tool_result:code.write').length;
  return { tools: reads + writes, reads, writes, note: writes ? '' : (lastText || 'sin write') };
}, { task: task.task, model: MODEL, timeout: TIMEOUT });
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
  let tools = '-', diag = '';
  try {
    if (SOLVER === 'model') {
      // recargar para historial de agente limpio; el modelo carga desde caché
      await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
      await waitModel();
      const r = await runModel(task); tools = r.tools; diag = `r${r.reads}/w${r.writes} ${r.note}`;
    } else {
      const r = await runScripted(task); tools = r.tools;
    }
  } catch (e) { diag = 'ERR ' + String(e.message || e).slice(0, 50); }
  const v = await verify(task);
  if (v.passed) resolved++;
  console.log(task.id.padEnd(12), (v.passed ? '  ✅   ' : '  ❌   '), String(tools).padStart(4), '  ', (v.err || diag).slice(0, 70));
}
const pct = Math.round(resolved / BATCH.length * 100);
console.log(`\n📊 resolved ${resolved}/${BATCH.length} (${pct}%) · solver=${SOLVER}${SOLVER === 'model' ? ' modelo=' + MODEL : ''}`);
await b.close();
// en modo scripted exigimos 100% (valida el arnés); en modo modelo solo informamos
process.exit(SOLVER === 'scripted' && resolved !== BATCH.length ? 1 : 0);

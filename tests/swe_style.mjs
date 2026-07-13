// Test estilo SWE-bench (reproducible en el navegador): sembramos un repo con un
// BUG y un test que FALLA; el agente lee los ficheros REALES, deduce el arreglo y
// escribe la corrección con code.write; después EJECUTAMOS el test de verdad
// (import del módulo arreglado) y verificamos que pasa — igual que la métrica
// `resolved` de SWE-bench, pero autocontenido.
//
// El "solver" aquí es un proveedor guiado (lee→transforma→escribe) para que el
// harness sea determinista en CI. Cambiando `fake` por el provider real (Gemma/
// heal) se mide al modelo de verdad: el arnés y la verificación son los mismos.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

// sembrar el repo con BUG (add resta) + test que lo comprueba
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (path, txt) => { const parts = path.split('/'); const name = parts.pop(); let d = o; for (const x of parts) d = await d.getDirectoryHandle(x, { create: true }); const f = await d.getFileHandle(name, { create: true }); const s = await f.createWritable(); await s.write(txt); await s.close(); };
  await w('src/math.js', 'export function add(a, b) {\n  return a - b; // BUG: debería sumar\n}\n');
  await w('test/math.test.js', "import { add } from '../src/math.js';\n// add(2,3) debe ser 5 y add(10,-4) debe ser 6\n");
  await w('README.md', '# calc\nUna librería de aritmética. `add(a,b)` suma dos números.');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2000);

// correr el agente con un solver guiado que USA las tools reales (read→write)
const trace = await p.evaluate(async () => {
  const { Agent } = await import('/js/agent.js');
  const fake = {
    chat: async (history) => {
      const seen = t => history.some(m => m.content.includes(t));
      const readSrc = history.find(m => m.content.startsWith('[resultado code.read]') && m.content.includes('return a'));
      if (!seen('[resultado code.read]\n') && !readSrc) return '```tool\n{"tool":"code.read","args":{"path":"src/math.js"}}\n```';
      if (readSrc && history.every(m => !m.content.includes('return a + b'))) {
        const fixed = 'export function add(a, b) {\n  return a + b;\n}\n';
        return 'Veo el bug (resta en vez de sumar). Lo arreglo:\n```tool\n{"tool":"code.write","args":{"path":"src/math.js","content":' + JSON.stringify(fixed) + '}}\n```';
      }
      return 'Arreglado: add ahora suma.';
    },
  };
  const a = new Agent(fake);
  const ev = [];
  await a.handle('el test test/math.test.js falla porque add() resta en vez de sumar; arréglalo', e => ev.push(e.type + (e.tool ? ':' + e.tool : '')));
  return ev;
});
ok('el agente lee y luego escribe el arreglo (read→write)', trace.includes('tool_result:code.read') && trace.includes('tool_result:code.write'), trace.join(','));

// EJECUTAR el test de verdad contra el fichero arreglado en OPFS
const result = await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const read = async (path) => { const parts = path.split('/'); const name = parts.pop(); let d = o; for (const x of parts) d = await d.getDirectoryHandle(x); return (await (await d.getFileHandle(name)).getFile()).text(); };
  const src = await read('src/math.js');
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const mod = await import(url);
  const cases = [[2, 3, 5], [10, -4, 6], [0, 0, 0]];
  const passed = cases.filter(([a, b, exp]) => mod.add(a, b) === exp).length;
  return { total: cases.length, passed, src: src.slice(0, 60) };
});
ok('SWE resolved: el test PASA tras el arreglo del agente', result.passed === result.total, `${result.passed}/${result.total} · ${result.src.replace(/\n/g, ' ')}`);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ SWE-STYLE OK — repo con bug → agente lo arregla → test verde (resolved)');
await b.close();
process.exit(fails ? 1 : 0);

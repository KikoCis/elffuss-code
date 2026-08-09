// PROBE (desechable) — ronda 4: ¿mienten tree() y search() en proyectos grandes?
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8790';

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
p.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 200)); });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

// --- sembrar: 1 fichero GRANDE (>200KB) con el término, + árbol ancho/profundo ---
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  // A) fichero de 300KB que contiene NEEDLE_BIG
  {
    const w = await (await o.getFileHandle('huge.js', { create: true })).createWritable();
    let s = '';
    for (let i = 0; i < 6000; i++) s += `function h${i}(){ return ${i}; } // padding padding padding\n`;
    s += 'export const NEEDLE_BIG = 1;\n';
    await w.write(s); await w.close();
  }
  // B) proyecto ANCHO: 40 dirs × 20 ficheros = 800 entradas
  for (let d = 0; d < 40; d++) {
    const dir = await o.getDirectoryHandle('mod' + String(d).padStart(2, '0'), { create: true });
    for (let f = 0; f < 20; f++) {
      const w = await (await dir.getFileHandle('f' + f + '.js', { create: true })).createWritable();
      await w.write('export const X = ' + f + ';\n'); await w.close();
    }
  }
  // C) fichero PROFUNDO: zz/a/b/c/deep.js  (el último alfabéticamente)
  {
    let dir = o;
    for (const seg of ['zz', 'a', 'b', 'c']) dir = await dir.getDirectoryHandle(seg, { create: true });
    const w = await (await dir.getFileHandle('deep.js', { create: true })).createWritable();
    await w.write('export const DEEP_MARKER = 1;\n'); await w.close();
  }
  // D) fichero MULTI-MB para medir el difuso
  {
    const w = await (await o.getFileHandle('mb.js', { create: true })).createWritable();
    let s = '';
    for (let i = 0; i < 60000; i++) s += (i === 45000)
      ? '        function targetFn(a){\n            return a * 2;\n        }\n'
      : `function m${i}(){ return ${i}; }\n`;
    await w.write(s); await w.close();
  }
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

const r = await p.evaluate(async () => {
  const code = await import('/js/tools/code.js');
  const out = {};

  // A) ¿search encuentra algo dentro de un fichero de >200KB?
  out.searchBig = await code.search({ query: 'NEEDLE_BIG' });

  // B) ¿tree avisa de que corta? ¿cuánto enseña de 800+ entradas?
  const t = await code.tree({ path: '', depth: 3 });
  out.treeLines = t.split('\n').length;
  out.treeEllipsis = (t.match(/…/g) || []).length;
  out.treeSaysTruncated = /cort|truncad|más|incompleto/i.test(t);
  out.treeTail = t.split('\n').slice(-4).join(' | ');
  out.treeHasMod39 = t.includes('mod39');
  out.treeHasZz = t.includes('zz');

  // C) profundidad: ¿avisa de que hay más hondo?
  const t2 = await code.tree({ path: 'zz', depth: 1 });
  out.treeDepth1 = t2;

  // D) difuso en fichero multi-MB: ¿cuánto tarda? (bloquea el hilo principal)
  const t0 = performance.now();
  let fuzzErr = null;
  try {
    await code.edit({
      path: 'mb.js',
      search: 'function targetFn(a){\nreturn a * 2;\n}',
      replace: 'function targetFn(a){\n    return a * 3;\n}',
    });
  } catch (e) { fuzzErr = e.message; }
  out.fuzzMs = Math.round(performance.now() - t0);
  out.fuzzErr = fuzzErr;
  const o = await navigator.storage.getDirectory();
  const txt = await (await (await o.getFileHandle('mb.js')).getFile()).text();
  out.fuzzApplied = txt.includes('a * 3');
  out.mbBytes = txt.length;

  return out;
});

console.log(JSON.stringify(r, null, 2));
await b.close();

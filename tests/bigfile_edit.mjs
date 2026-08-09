// Guardia de regresión: code.edit sobre ficheros y proyectos GRANDES.
// Cada assert nació de un bug real (ago-2026):
//   1) edit() leía la vista recortada de read() (MAX_READ=60KB) y al reescribir
//      TRUNCABA cualquier fichero >60KB, metiendo «… (recortado)» en el código.
//   2) search() cortaba a 400 ficheros / 80 hits EN SILENCIO (el modelo no sabía
//      que la búsqueda estaba incompleta).
//   3) el fallback difuso (diff-match-patch por esm.sh) no localizaba objetivos
//      profundos, aplicaba el parche en OTRO sitio y REPORTABA ÉXITO (falso
//      positivo); además dependía de la red (rompía la edición sin conexión).
// Determinista, sin modelo (modo rules). Corre contra local o producción:
//   BASE=http://localhost:8790 node bigfile_edit.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8790';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

// ---------- 1 · edición exacta en fichero grande (>60KB) sin truncar ----------
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = await (await o.getFileHandle('big.js', { create: true })).createWritable();
  let s = 'export const VERSION = "1.0.0"; // EDIT_ME\n';
  for (let i = 1; i <= 3000; i++) s += `function f${i}(){ return ${i}; } // relleno\n`;
  s += 'export const TAIL = "SENTINEL_END";\n';
  await w.write(s); await w.close();
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
{
  const r = await p.evaluate(async () => {
    const code = await import('/js/tools/code.js');
    await code.edit({ path: 'big.js', search: 'VERSION = "1.0.0"', replace: 'VERSION = "2.0.0"' });
    const o = await navigator.storage.getDirectory();
    const t = await (await (await o.getFileHandle('big.js')).getFile()).text();
    return { edit: t.includes('2.0.0'), tail: t.includes('SENTINEL_END'), trunc: t.includes('recortado'), lines: t.split('\n').length };
  });
  ok('1 · fichero >60KB: la edición se aplica', r.edit);
  ok('1 · fichero >60KB: el final SOBREVIVE (no trunca)', r.tail, `${r.lines} líneas`);
  ok('1 · fichero >60KB: no inyecta «recortado» en el código', !r.trunc);
}

// ---------- 2 · edición DIFUSA (sangría distinta) en lo hondo, y rechazo seguro ----------
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = await (await o.getFileHandle('deep.js', { create: true })).createWritable();
  let s = 'const HEAD=1;\n';
  for (let i = 1; i <= 3000; i++) s += (i === 2000)
    ? '  function computeTax(rate){\n    return rate * 0.21;\n  }\n'
    : `function g${i}(){ return ${i}; }\n`;
  s += 'const TAIL="KEEP_ME";\n';
  await w.write(s); await w.close();
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000);
{
  const A = await p.evaluate(async () => {
    const code = await import('/js/tools/code.js');
    let err = null;
    try { await code.edit({ path: 'deep.js', search: 'function computeTax(rate){\nreturn rate * 0.21;\n}', replace: 'function computeTax(rate){\n    return rate * 0.27;\n  }' }); } catch (e) { err = e.message; }
    const o = await navigator.storage.getDirectory();
    const t = await (await (await o.getFileHandle('deep.js')).getFile()).text();
    return { err, applied: t.includes('0.27'), tail: t.includes('KEEP_ME'), tax: (t.match(/computeTax/g) || []).length, lines: t.split('\n').length };
  });
  ok('2 · difuso: aplica pese a sangría distinta, en lo hondo del fichero', A.applied && !A.err);
  ok('2 · difuso: sin duplicar, cola preservada, sin truncar', A.tax === 1 && A.tail && A.lines >= 3000);

  const B = await p.evaluate(async () => {
    const code = await import('/js/tools/code.js');
    const o = await navigator.storage.getDirectory();
    const before = await (await (await o.getFileHandle('deep.js')).getFile()).text();
    let threw = false; try { await code.edit({ path: 'deep.js', search: 'function noExiste(zzz){ return 42; }', replace: 'BOOM' }); } catch { threw = true; }
    const after = await (await (await o.getFileHandle('deep.js')).getFile()).text();
    return { threw, intact: before === after };
  });
  ok('2 · seguridad: un search inexistente se RECHAZA sin tocar el fichero', B.threw && B.intact);
}

// ---------- 3 · proyecto grande: search encuentra y AVISA al cortar ----------
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const d = await o.getDirectoryHandle('lib', { create: true });
  for (let i = 0; i < 100; i++) {
    const w = await (await d.getFileHandle('c' + i + '.js', { create: true })).createWritable();
    await w.write('const WIDGET = ' + i + ';\n'); await w.close();
  }
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000);
{
  const r = await p.evaluate(async () => {
    const code = await import('/js/tools/code.js');
    const s = await code.search({ query: 'WIDGET' });
    return { hits: s.split('\n').filter(l => /c\d+\.js/.test(l)).length, capped: /cortada/.test(s) };
  });
  ok('3 · proyecto grande: search encuentra resultados', r.hits > 0);
  ok('3 · proyecto grande: AVISA cuando corta (no corte silencioso)', r.capped);
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ TODO VERDE — edición y búsqueda robustas en grande');
await b.close();
process.exit(fails ? 1 : 0);

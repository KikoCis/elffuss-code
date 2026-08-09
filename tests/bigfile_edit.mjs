// Guardia de regresión: code.edit sobre ficheros y proyectos GRANDES.
// Cada assert nació de un bug real (ago-2026):
//   1) edit() leía la vista recortada de read() (MAX_READ=60KB) y al reescribir
//      TRUNCABA cualquier fichero >60KB, metiendo «… (recortado)» en el código.
//   2) search() cortaba a 400 ficheros / 80 hits EN SILENCIO (el modelo no sabía
//      que la búsqueda estaba incompleta).
//   3) el fallback difuso (diff-match-patch por esm.sh) no localizaba objetivos
//      profundos, aplicaba el parche en OTRO sitio y REPORTABA ÉXITO (falso
//      positivo); además dependía de la red (rompía la edición sin conexión).
//   4) code.tree cortaba a 350 entradas con un «…» pelado: el modelo daba por
//      completo un árbol que no lo estaba.
//   5) search se saltaba EN SILENCIO todo fichero >200KB — «Sin resultados»
//      sonaba a «ese código no existe» siendo mentira, y justo en los ficheros
//      grandes, que son los que el modelo no puede leer enteros.
//   6) read con offset más allá del final devolvía un rango imposible
//      («líneas 999-998 de 6») y ningún contenido.
//   7) el difuso rehacía el fichero con split/join('\n'): un fichero CRLF salía
//      con finales de línea MEZCLADOS (se tocaba lo que no se había editado).
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

// ---------- 4 · code.tree: al cortar, AVISA y guía (no un «…» pelado) ----------
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const d = await o.getDirectoryHandle('many', { create: true });
  for (let i = 0; i < 900; i++) { const w = await (await d.getFileHandle('t' + i + '.js', { create: true })).createWritable(); await w.write('//' + i); await w.close(); }
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000);
{
  const t = await p.evaluate(async () => (await import('/js/tools/code.js')).tree({ depth: 3 }));
  ok('4 · proyecto grande: code.tree AVISA al cortar y dice cómo ver más', /recortado/.test(t) && /(code\.tree|code\.search)/.test(t));
}

// ---------- 5 · fichero de varios MB: edita rápido, sin truncar ----------
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = await (await o.getFileHandle('huge.js', { create: true })).createWritable();
  const parts = ['const HEAD=1;\n'];
  for (let i = 1; i <= 40000; i++) parts.push(i === 30000 ? 'export function target(){ return "AAA"; }\n' : `function h${i}(){ return ${i}; }\n`);
  parts.push('const TAIL="HUGE_TAIL";\n');
  await w.write(parts.join('')); await w.close();
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
{
  const r = await p.evaluate(async () => {
    const code = await import('/js/tools/code.js');
    const t0 = performance.now();
    await code.edit({ path: 'huge.js', search: 'export function target(){ return "AAA"; }', replace: 'export function target(){ return "BBB"; }' });
    const ms = performance.now() - t0;
    const o = await navigator.storage.getDirectory();
    const t = await (await (await o.getFileHandle('huge.js')).getFile()).text();
    return { ms: Math.round(ms), edit: t.includes('"BBB"'), tail: t.includes('HUGE_TAIL'), lines: t.split('\n').length };
  });
  ok('5 · fichero de varios MB: edición aplicada, cola intacta, sin truncar', r.edit && r.tail && r.lines >= 40000);
  ok('5 · fichero de varios MB: rápido (<4s)', r.ms < 4000, `${r.ms}ms`);
}

// ---------- 6 · search DENTRO de ficheros grandes, y confiesa lo que no miró ----------
// Bug: se saltaba EN SILENCIO todo fichero >200KB, así que «Sin resultados» se
// leía como «ese código no existe» — mentira. Y un fichero grande es justo el
// que el modelo no puede leer entero: el que más falta hace poder buscar.
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const put = async (n, s) => { const w = await (await o.getFileHandle(n, { create: true })).createWritable(); await w.write(s); await w.close(); };
  let mid = ''; for (let i = 0; i < 5000; i++) mid += `const p${i} = ${i}; // relleno relleno relleno\n`;
  await put('mid.js', mid + 'const MID_NEEDLE = 1;\n');                 // ~250KB (antes: invisible)
  let mb = ''; for (let i = 0; i < 60000; i++) mb += `function m${i}(){ return ${i}; }\n`;
  await put('mb.js', mb);                                               // >2MB (fuera de tope: hay que DECIRLO)
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
{
  const r = await p.evaluate(async () => {
    const code = await import('/js/tools/code.js');
    const s = await code.search({ query: 'MID_NEEDLE' });
    return { found: /mid\.js:\d+/.test(s), declares: /NO buscados por tamaño/.test(s) && /mb\.js/.test(s), raw: s.slice(0, 200) };
  });
  ok('6 · search encuentra dentro de un fichero de ~250KB', r.found, r.raw);
  ok('6 · search DECLARA los ficheros que no pudo mirar por tamaño', r.declares);
}

// ---------- 7 · bordes: leer más allá del final, y CRLF que sobrevive a edit ----------
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const put = async (n, s) => { const w = await (await o.getFileHandle(n, { create: true })).createWritable(); await w.write(s); await w.close(); };
  await put('small.js', 'a\nb\nc\nd\ne\n');
  await put('crlf.js', 'const A = 1;\r\n  function calc(x){\r\n    return x + 1;\r\n  }\r\nconst B = 2;\r\n');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000);
{
  const r = await p.evaluate(async () => {
    const code = await import('/js/tools/code.js');
    const past = await code.read({ path: 'small.js', offset: 999, limit: 10 });
    // sangría distinta a propósito → entra por el camino difuso, que es el que
    // reescribía el bloque con finales de línea LF y dejaba el fichero mezclado
    await code.edit({ path: 'crlf.js', search: 'function calc(x){\nreturn x + 1;\n}', replace: 'function calc(x){\n    return x + 2;\n  }' });
    const o = await navigator.storage.getDirectory();
    const t = await (await (await o.getFileHandle('crlf.js')).getFile()).text();
    return {
      pastSane: !/líneas 999-998/.test(past) && /6/.test(past),
      applied: t.includes('x + 2'),
      crs: (t.match(/\r/g) || []).length,
      lfAlone: /[^\r]\n/.test(t),
    };
  });
  ok('7 · read más allá del final: mensaje útil, no un rango imposible', r.pastSane);
  ok('7 · CRLF: la edición se aplica…', r.applied);
  ok('7 · CRLF: …y NO mezcla finales de línea (los 5 CR siguen ahí)', r.crs === 5 && !r.lfAlone, `${r.crs} CR`);
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ TODO VERDE — edición y búsqueda robustas en grande');
await b.close();
process.exit(fails ? 1 : 0);

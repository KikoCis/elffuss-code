// code.edit: edicion PARCIAL de ficheros (no reescribir enteros). Exacta,
// fuzzy (diff-match-patch, contexto ligeramente desplazado), ambigua
// (rechaza), y fallo limpio (ni exacta ni aproximada con confianza).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERROR:', e.message));
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('exact.py', 'def hola():\n    print("mundo")\n    return 1\n');
  await w('dup.py', 'x = 1\nx = 1\nx = 1\n');
  await w('shifted.py', 'def f():\n    # un comentario nuevo que el modelo no vio\n    valor = 10\n    print(valor)\n    return valor\n');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

// 1) coincidencia EXACTA
const r1 = await p.evaluate(async () => {
  const code = await import('/js/tools/code.js');
  await code.edit({ path: 'exact.py', search: 'print("mundo")', replace: 'print("adiós")' });
  return code.read({ path: 'exact.py' });
});
ok('edición exacta aplica el cambio', r1.includes('print("adiós")'), r1);
ok('edición exacta NO toca el resto del fichero', r1.includes('return 1'), r1);

// 2) AMBIGUA: search aparece más de una vez → rechaza sin adivinar
const r2 = await p.evaluate(async () => {
  const code = await import('/js/tools/code.js');
  try { await code.edit({ path: 'dup.py', search: 'x = 1', replace: 'x = 2' }); return 'NO LANZÓ ERROR'; }
  catch (e) { return 'ERROR: ' + e.message; }
});
ok('ambigüedad (aparece 2+ veces) se rechaza con mensaje claro', /más de una vez/.test(r2), r2);
const dupUnchanged = await p.evaluate(async () => (await import('/js/tools/code.js')).read({ path: 'dup.py' }));
ok('el fichero ambiguo queda INTACTO (no escribió nada al azar)', dupUnchanged === 'x = 1\nx = 1\nx = 1\n');

// 3) FUZZY: el modelo "recuerda" el código SIN el comentario nuevo que se
// añadió después — el texto exacto ya no existe, pero diff-match-patch debe
// localizar el punto real igualmente.
const r3 = await p.evaluate(async () => {
  const code = await import('/js/tools/code.js');
  const before = await code.read({ path: 'shifted.py' });
  await code.edit({
    path: 'shifted.py',
    search: 'def f():\n    valor = 10\n    print(valor)',
    replace: 'def f():\n    valor = 20\n    print(valor)',
  });
  const after = await code.read({ path: 'shifted.py' });
  return { before, after };
});
ok('fuzzy: encuentra el punto pese al comentario que no vio', r3.after.includes('valor = 20'), r3.after);
ok('fuzzy: preserva el resto del fichero (comentario y return intactos)', r3.after.includes('un comentario nuevo') && r3.after.includes('return valor'), r3.after);

// 4) FALLO LIMPIO: search que no se parece a nada del fichero
const r4 = await p.evaluate(async () => {
  const code = await import('/js/tools/code.js');
  try { await code.edit({ path: 'exact.py', search: 'esto no existe en ningún sitio del fichero para nada', replace: 'x' }); return 'NO LANZÓ ERROR'; }
  catch (e) { return 'ERROR: ' + e.message; }
});
ok('sin coincidencia ni exacta ni aproximada, falla con mensaje que invita a reintentar', /No encontré|reintenta|relee/i.test(r4), r4);
const exactStillOk = await p.evaluate(async () => (await import('/js/tools/code.js')).read({ path: 'exact.py' }));
ok('tras el fallo, el fichero sigue con el cambio previo válido (nada corrupto)', exactStillOk.includes('print("adiós")'));

// 5) registrado en el catálogo de tools del agente
const registered = await p.evaluate(async () => {
  const idx = await import('/js/tools/index.js');
  return Object.keys(idx.TOOLS).includes('code.edit');
});
ok('code.edit está en el catálogo de herramientas del agente', registered);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ code.edit (exacto + fuzzy + ambiguo + fallo limpio) OK');
await b.close();
process.exit(fails ? 1 : 0);

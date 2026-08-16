// BATERÍA DURA DE EDICIÓN — sin modelo, determinista.
// Aísla code.edit del resto del agente: cada caso es una forma REAL en que un
// modelo pequeño cita mal el bloque a cambiar. Así «la edición falla» deja de
// ser una queja y pasa a ser una lista de causas con nombre.
import { createRequire } from 'module';
// playwright se resuelve desde NODE_PATH o desde node_modules del proyecto
const { chromium } = createRequire(import.meta.url)('playwright');

const CASOS = [
  // id, fichero, search, replace, qué debe pasar
  { id: 'exacta', desc: 'cita literal',
    f: 'a.js', txt: 'const a = 1;\nconst b = 2;\n', s: 'const b = 2;', r: 'const b = 3;', esperado: 'const b = 3;' },

  { id: 'sangria-mal', desc: 'el modelo reindenta al citar',
    f: 'a.js', txt: 'function f() {\n    return 1;\n}\n', s: 'function f() {\n  return 1;\n}', r: 'function f() {\n  return 2;\n}', esperado: 'return 2;' },

  { id: 'tabs-vs-espacios', desc: 'el fichero usa tabs, el modelo espacios',
    f: 'a.js', txt: 'function f() {\n\treturn 1;\n}\n', s: 'function f() {\n    return 1;\n}', r: 'function f() {\n    return 9;\n}', esperado: 'return 9;' },

  { id: 'numeros-de-linea', desc: 'el modelo copia «12→» de la lectura paginada',
    f: 'a.js', txt: 'const a = 1;\nconst b = 2;\n', s: '2→const b = 2;', r: '2→const b = 7;', esperado: 'const b = 7;' },

  { id: 'linea-extra-dentro', desc: 'el fichero tiene un comentario que el modelo no vio',
    f: 'a.js', txt: 'function f() {\n  // añadido luego\n  return 1;\n}\n', s: 'function f() {\n  return 1;\n}', r: 'function f() {\n  return 5;\n}', esperado: 'return 5;', conserva: 'añadido luego' },

  { id: 'duplicado', desc: 'el bloque aparece dos veces → debe NEGARSE',
    f: 'a.js', txt: 'function f() {\n  return 1;\n}\nfunction g() {\n  return 1;\n}\n', s: '  return 1;', r: '  return 2;', debeFallar: true },

  { id: 'crlf', desc: 'fichero con finales de línea de Windows',
    f: 'a.js', txt: 'const a = 1;\r\nconst b = 2;\r\nconst c = 3;\r\n', s: 'const b = 2;', r: 'const b = 4;', esperado: 'const b = 4;', sinMezcla: true },

  { id: 'sin-salto-final', desc: 'el bloque es la última línea y no hay salto final',
    f: 'a.js', txt: 'const a = 1;\nconst b = 2;', s: 'const b = 2;', r: 'const b = 8;', esperado: 'const b = 8;' },

  { id: 'borrado', desc: 'replace vacío = borrar el bloque',
    f: 'a.js', txt: 'const a = 1;\nconst basura = 0;\nconst c = 3;\n', s: 'const basura = 0;\n', r: '', noContiene: 'basura' },

  { id: 'acentos', desc: 'texto con acentos y eñes',
    f: 'a.js', txt: 'const msg = "año de diseño";\n', s: 'const msg = "año de diseño";', r: 'const msg = "año nuevo";', esperado: 'año nuevo' },

  { id: 'llave-sola', desc: 'search es «}» a secas: aparece mil veces → debe NEGARSE',
    f: 'a.js', txt: 'function f() {\n  return 1;\n}\nfunction g() {\n  return 2;\n}\n', s: '}', r: '} // fin', debeFallar: true },

  { id: 'elision', desc: 'el modelo elide el centro con «…»',
    f: 'a.js', txt: 'function f() {\n  const x = 1;\n  const y = 2;\n  return x + y;\n}\n', s: 'function f() {\n  …\n  return x + y;\n}', r: 'function f() {\n  …\n  return x * y;\n}', esperado: 'return x * y;', conserva: 'const x = 1;' },

  { id: 'comillas-distintas', desc: 'cambia comillas al citar → NO debe adivinar (cambian el significado)',
    f: 'a.js', txt: "const s = 'hola';\nconst t = 'adios';\n", s: 'const s = "hola";', r: 'const s = "HOLA";', debeFallar: true },

  { id: 'sin-cambio', desc: 'search y replace idénticos → debe NEGARSE',
    f: 'a.js', txt: 'const a = 1;\n', s: 'const a = 1;', r: 'const a = 1;', debeFallar: true },

  { id: 'fichero-grande', desc: 'el bloque está en la línea 800 de un fichero largo',
    f: 'a.js', txt: Array.from({length:1500},(_,i)=>`const v${i} = ${i};`).join('\n')+'\n', s: 'const v800 = 800;', r: 'const v800 = 999;', esperado: 'const v800 = 999;', intactas: 1500 },
];

const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await b.newContext()).newPage();
await p.goto('https://code.elffuss.utopiaia.com/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);

const res = await p.evaluate(async (CASOS) => {
  const code = await import('/js/tools/code.js?v=' + Date.now());
  const raiz = await navigator.storage.getDirectory();
  await code.openProject(raiz);
  code.resetEditStats();
  const out = [];
  for (const c of CASOS) {
    for await (const [n] of raiz.entries()) await raiz.removeEntry(n, { recursive: true }).catch(() => {});
    const fh = await raiz.getFileHandle(c.f, { create: true });
    const w = await fh.createWritable(); await w.write(c.txt); await w.close();
    code.invalidateFileList();
    let error = null, despues = c.txt;
    const antes = { ...code.editStats };
    try { await code.edit({ path: c.f, search: c.s, replace: c.r }); }
    catch (e) { error = e.message.slice(0, 90); }
    try { despues = await (await (await raiz.getFileHandle(c.f)).getFile()).text(); } catch {}
    const via = ['exacta','nucleo','difusa','ambigua','noEncontrado','sinCambio','noExiste']
      .find(k => code.editStats[k] > (antes[k] || 0)) || '—';
    out.push({ id: c.id, error, via, cambio: despues !== c.txt,
      texto: despues, lineas: despues.split('\n').length,
      mezclaEOL: /\r\n/.test(despues) && /[^\r]\n/.test(despues) });
  }
  return out;
}, CASOS);

console.log('BATERÍA DE EDICIÓN — 15 formas reales de citar mal\n');
let ok = 0;
for (const c of CASOS) {
  const r = res.find(x => x.id === c.id);
  let bien, nota = '';
  if (c.debeFallar) { bien = !!r.error && !r.cambio; nota = bien ? 'se negó, como debe' : '⚠ EDITÓ CUANDO NO DEBÍA'; }
  else {
    bien = !r.error && r.texto.includes(c.esperado ?? '');
    if (bien && c.conserva && !r.texto.includes(c.conserva)) { bien = false; nota = `se comió «${c.conserva}»`; }
    if (bien && c.noContiene && r.texto.includes(c.noContiene)) { bien = false; nota = 'no borró'; }
    if (bien && c.sinMezcla && r.mezclaEOL) { bien = false; nota = 'mezcló CRLF y LF'; }
    if (bien && c.intactas && r.lineas !== c.intactas + 1) { bien = false; nota = `el fichero pasó de ${c.intactas} a ${r.lineas-1} líneas`; }
    if (!bien && !nota) nota = r.error || 'no aplicó el cambio';
  }
  if (bien) ok++;
  console.log(` ${bien ? '✓' : '✗'} ${c.id.padEnd(19)} ${String(r.via).padEnd(13)} ${c.desc}`);
  if (!bien) console.log(`     └─ ${nota}`);
}
console.log(`\n  ${ok}/${CASOS.length} casos correctos`);
if (process.argv[2]) { const r = res.find(x => x.id === process.argv[2]); console.log('\n--- resultado de ' + process.argv[2] + ' ---\n' + JSON.stringify(r.texto)); }
process.exit(ok === CASOS.length ? 0 : 1);
await b.close();

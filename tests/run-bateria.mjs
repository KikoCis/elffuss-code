// code.run — ejecutar el código y ver qué hace de verdad.
// La guarda de sintaxis no ve un fichero válido PERO incorrecto; eso solo se
// caza ejecutándolo. Aquí se comprueba que ejecuta, que aguanta lo que puede
// salir mal (bucle infinito, excepción, fichero que no parsea) y que resuelve
// imports relativos, que sin build no se resuelven solos.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');

const CASOS = [
  { id: 'valor', desc: 'devuelve el valor de verdad',
    files: { 'm.js': 'export const suma = (a,b) => a+b;\n' }, path: 'm.js', expr: 'm.suma(2,3)', trae: '5' },

  { id: 'undefined', desc: 'distingue undefined de un fallo',
    files: { 'm.js': 'export const max = a => a.length ? Math.max(...a) : undefined;\n' }, path: 'm.js', expr: 'm.max([])', trae: 'undefined' },

  { id: 'el-bug-real', desc: 'caza el arreglo por partida doble que la sintaxis no ve',
    files: { 'm.js': 'const MINIMO = 4;\nexport function valida(s) {\n  if (s.length <= MINIMO) return false;\n  return true;\n}\n' },
    path: 'm.js', expr: 'm.valida("abcd")', trae: 'false' },

  { id: 'excepcion', desc: 'una excepción se informa, no rompe el IDE',
    files: { 'm.js': 'export const revienta = () => { throw new Error("boom"); };\n' }, path: 'm.js', expr: 'm.revienta()', trae: 'boom' },

  { id: 'bucle-infinito', desc: 'un bucle infinito NO puede colgar el IDE',
    files: { 'm.js': 'export const cuelga = () => { while (true) {} };\n' }, path: 'm.js', expr: 'm.cuelga()', trae: 'no terminó' },

  { id: 'no-parsea', desc: 'un fichero roto lo dice en vez de callarse',
    files: { 'm.js': 'export function rota( {\n' }, path: 'm.js', expr: 'm.rota()', trae: 'lanzó' },

  { id: 'import-relativo', desc: 'resuelve imports relativos (sin build no se resuelven solos)',
    files: { 'lib/util.js': 'export const doble = n => n*2;\n', 'm.js': 'import { doble } from "./lib/util.js";\nexport const cuadruple = n => doble(doble(n));\n' },
    path: 'm.js', expr: 'm.cuadruple(3)', trae: '12' },

  { id: 'import-anidado', desc: 'y en cadena, dos niveles',
    files: { 'a/b.js': 'export const uno = () => 1;\n', 'a/c.js': 'import { uno } from "./b.js";\nexport const dos = () => uno()+1;\n',
             'm.js': 'import { dos } from "./a/c.js";\nexport const tres = () => dos()+1;\n' },
    path: 'm.js', expr: 'm.tres()', trae: '3' },

  { id: 'no-js', desc: 'no intenta ejecutar lo que no es JS',
    files: { 'a.md': '# hola\n' }, path: 'a.md', expr: '1', debeFallar: true },

  // La forma en que el modelo lo escribe DE VERDAD (medido): sin «m.», con un
  // import dentro, o nombrando algo que no existe. Cada una de estas le hizo
  // concluir que su código estaba mal y ponerse a romperlo.
  { id: 'sin-prefijo', desc: 'llamar por el nombre a secas, como lo escribe el modelo',
    files: { 'm.js': 'export const slugify = s => s.toLowerCase();\n' }, path: 'm.js', expr: "slugify('Hola')", trae: 'hola' },

  { id: 'import-en-expr', desc: 'un import dentro de expr se explica, no se ejecuta',
    files: { 'm.js': 'export const f = () => 1;\n' }, path: 'm.js', expr: "import { f } from './m.js'; f()", debeFallar: true },

  { id: 'nombre-inventado', desc: 'si nombra algo que no existe, el error DICE qué hay',
    files: { 'm.js': 'export const clamp = v => v;\nexport const otra = () => 2;\n' }, path: 'm.js', expr: 'noExiste(1)', trae: 'exporta: clamp, otra' },

  { id: 'no-culpa-al-fichero', desc: 'y deja claro que el fichero no tiene por qué estar mal',
    files: { 'm.js': 'export const clamp = v => v;\n' }, path: 'm.js', expr: 'clampp(1)', trae: 'NO tiene por qué estar mal' },
];

const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await b.newContext()).newPage();
await p.goto('https://code.elffuss.utopiaia.com/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);

const res = await p.evaluate(async (CASOS) => {
  const code = await import('/js/tools/code.js?v=' + Date.now());
  const raiz = await navigator.storage.getDirectory();
  await code.openProject(raiz);
  const out = [];
  for (const c of CASOS) {
    for await (const [n] of raiz.entries()) await raiz.removeEntry(n, { recursive: true }).catch(() => {});
    for (const [ruta, txt] of Object.entries(c.files)) {
      const partes = ruta.split('/'); let d = raiz;
      for (const x of partes.slice(0, -1)) d = await d.getDirectoryHandle(x, { create: true });
      const w = await (await d.getFileHandle(partes.at(-1), { create: true })).createWritable();
      await w.write(txt); await w.close();
    }
    code.invalidateFileList();
    const t0 = performance.now();
    let salida = null, error = null;
    try { salida = await code.run({ path: c.path, expr: c.expr }); }
    catch (e) { error = e.message; }
    out.push({ id: c.id, salida, error, ms: Math.round(performance.now() - t0) });
  }
  return out;
}, CASOS);

console.log('code.run — ejecutar para comprobar\n');
let ok = 0;
for (const c of CASOS) {
  const r = res.find(x => x.id === c.id);
  const bien = c.debeFallar ? !!r.error : (!r.error && String(r.salida).includes(c.trae));
  if (bien) ok++;
  console.log(` ${bien ? '✓' : '✗'} ${c.id.padEnd(16)} ${c.desc}`);
  console.log(`     ${(r.error ? 'error: ' + r.error : r.salida) || ''}`.slice(0, 118));
}
console.log(`\n  ${ok}/${CASOS.length} correctos`);
await b.close();
process.exit(ok === CASOS.length ? 0 : 1);

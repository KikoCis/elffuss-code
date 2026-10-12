// code.read / code.search: encontrar un fichero POR SU NOMBRE.
//
// El bug que origina este banco: se pidió «obj_1_Zusammenbau.stl», el fichero
// existía en una subcarpeta, y las dos herramientas dijeron que no:
//   · code.read   → «no existe en este proyecto» (falso) + sugería otro fichero
//   · code.search → «Sin resultados» (falso)
// Causas: findByName se rendía a las 500 entradas visitadas, read lanzaba
// aunque la búsqueda SÍ hubiera encontrado el fichero, y search solo grepeaba
// contenido y de un binario ni abría.
//
// Cada aserto lleva su control negativo: si el banco no se ha visto fallar, no
// prueba nada.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
p.on('pageerror', e => { console.log('❌ pageerror: ' + e.message); fails++; });
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// Siembra: 700 ficheros de relleno ANTES (en orden de recorrido) del que
// buscamos, para que el tope viejo de 500 no llegue. El .stl va en una
// subcarpeta y es binario, que es el caso real.
const sembrado = await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const relleno = await root.getDirectoryHandle('aaa_relleno', { create: true });
  for (let i = 0; i < 700; i++) {
    const fh = await relleno.getFileHandle(`relleno_${String(i).padStart(4, '0')}.txt`, { create: true });
    const w = await fh.createWritable(); await w.write('x'); await w.close();
  }
  const zzz = await root.getDirectoryHandle('zzz_piezas', { create: true });
  const stl = await zzz.getFileHandle('obj_1_Zusammenbau.stl', { create: true });
  const w = await stl.createWritable();
  await w.write(new Uint8Array([0x73, 0x6f, 0x6c, 0x69, 0x64, 0x00, 0xff, 0x01]));  // binario de verdad
  await w.close();
  // Un segundo fichero con el MISMO nombre en otra carpeta, para el caso ambiguo.
  const otra = await root.getDirectoryHandle('zzz_copia', { create: true });
  const dup = await otra.getFileHandle('duplicado.txt', { create: true });
  const w2 = await dup.createWritable(); await w2.write('A'); await w2.close();
  const otra2 = await root.getDirectoryHandle('zzz_copia2', { create: true });
  const dup2 = await otra2.getFileHandle('duplicado.txt', { create: true });
  const w3 = await dup2.createWritable(); await w3.write('B'); await w3.close();
  return 702;
});
ok('sembrados 700 ficheros de relleno + el .stl en subcarpeta', sembrado === 702);

const llama = (fn, args) => p.evaluate(async ([f, a]) => {
  const c = await import('/js/tools/code.js');
  try { return { ok: true, v: await c[f](a) }; } catch (e) { return { ok: false, v: String(e.message || e) }; }
}, [fn, args]);

// ── 1) findByName tiene que ATRAVESAR el relleno ────────────────────────────
const fbn = await llama('findByName', 'obj_1_Zusammenbau.stl');
ok('findByName encuentra el .stl detrás de 700 ficheros',
  fbn.ok && Array.isArray(fbn.v) && fbn.v.includes('zzz_piezas/obj_1_Zusammenbau.stl'),
  JSON.stringify(fbn.v).slice(0, 160));

const tope = await p.evaluate(async () => (await import('/js/tools/code.js')).FIND_MAX_VISITED);
ok('el tope de visitas es mayor que el relleno sembrado', tope > 700, 'tope=' + tope);

// Control negativo del tope, forzado: el orden de recorrido de OPFS es
// ARBITRARIO (en esta misma siembra «zzz_copia2» sale antes que «zzz_copia»),
// así que sembrar 700 ficheros no garantiza agotar nada: con el tope viejo el
// .stl se encontraba o no según la suerte del orden. Se inyecta el tope.
// Se busca un nombre que NO existe, para que el resultado sea vacío Y parcial a
// la vez: es el caso en el que la herramienta antes mentía.
const rendido = await p.evaluate(async () => {
  const c = await import('/js/tools/code.js');
  const h = await c.findByName('zzzz_no_existe_qwz.txt', 5, 1);
  const pleno = await c.findByName('zzzz_no_existe_qwz.txt');
  return { n: h.length, agotado: !!h.agotado, nPleno: pleno.length, agotadoPleno: !!pleno.agotado };
});
ok('tope agotado: cero resultados y marcado como incompleto (control negativo)',
  rendido.n === 0 && rendido.agotado === true, JSON.stringify(rendido));
ok('…y con el tope normal el mismo nombre sale vacío pero COMPLETO',
  rendido.nPleno === 0 && rendido.agotadoPleno === false, JSON.stringify(rendido));

// Y la diferencia tiene que llegar al mensaje: «no existe» ≠ «no he podido mirar».
const honesto = await p.evaluate(async () => {
  const c = await import('/js/tools/code.js');
  try { await c.read({ path: 'zzzz_no_existe_qwz.txt' }); return 'no lanzó'; }
  catch (e) { return String(e.message); }
});
ok('con búsqueda completa el mensaje SÍ afirma que no existe', honesto.includes('no existe'), honesto.slice(0, 120));

// ── 2) code.read por nombre pelado: LEE, no sermonea ────────────────────────
const r = await llama('read', { path: 'obj_1_Zusammenbau.stl' });
ok('code.read resuelve el nombre pelado y devuelve contenido', r.ok, r.v.slice(0, 200));
ok('code.read dice por qué ruta lo ha leído',
  r.ok && r.v.includes('zzz_piezas/obj_1_Zusammenbau.stl'), String(r.v).slice(0, 200));
ok('code.read NO afirma que no existe', !(String(r.v).includes('no existe «obj_1_Zusammenbau.stl»')));

// ── 3) ambiguo: NO adivina, enumera ─────────────────────────────────────────
const amb = await llama('read', { path: 'duplicado.txt' });
ok('con dos coincidencias, code.read no adivina', !amb.ok, String(amb.v).slice(0, 160));
ok('…y enumera las dos rutas',
  !amb.ok && String(amb.v).includes('zzz_copia/duplicado.txt') && String(amb.v).includes('zzz_copia2/duplicado.txt'),
  String(amb.v).slice(0, 200));

// ── 4) lo que de verdad no existe sigue dando error ─────────────────────────
const no = await llama('read', { path: 'no_existe_jamas_xyz.txt' });
ok('un fichero inexistente sigue siendo error', !no.ok && String(no.v).includes('no existe'), String(no.v).slice(0, 120));

// ── 5) code.search casa NOMBRES, binarios incluidos ─────────────────────────
const s = await llama('search', { query: 'obj_1_Zusammenbau' });
ok('code.search encuentra el .stl por su nombre',
  s.ok && String(s.v).includes('zzz_piezas/obj_1_Zusammenbau.stl'), String(s.v).slice(0, 200));
ok('code.search NO dice «Sin resultados»', s.ok && !String(s.v).includes('Sin resultados'), String(s.v).slice(0, 120));

// Control negativo: una búsqueda que de verdad no casa nada sigue diciéndolo.
const s0 = await llama('search', { query: 'cadena_que_no_esta_en_ningun_sitio_qwz' });
ok('una búsqueda vacía sigue diciendo «Sin resultados»', s0.ok && String(s0.v).includes('Sin resultados'), String(s0.v).slice(0, 120));

// Y el contenido sigue buscándose (no se ha roto lo que ya iba).
const sc = await llama('search', { query: 'solid' });
ok('la búsqueda por contenido sigue viva', sc.ok, String(sc.v).slice(0, 120));

await b.close();
console.log(fails ? `\n${fails} fallo(s)` : '\nTodo en verde');
process.exit(fails ? 1 : 0);

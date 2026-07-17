// code.read: además del fichero entero (comportamiento de siempre), ahora
// pagina de 100 en 100 líneas (offset/limit) y puede centrarse en una línea
// dada (around) — para encadenar con los números de línea que ya devuelve
// code.search y traer contexto antes/después sin volcar el fichero completo.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// siembra un fichero de 250 líneas numeradas L1..L250, con una marca en la 173
await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const lines = Array.from({ length: 250 }, (_, i) => (i + 1 === 173 ? 'MARCA_BUSCADA_XYZ' : `L${i + 1}`));
  const fh = await root.getFileHandle('big.py', { create: true });
  const w = await fh.createWritable();
  await w.write(lines.join('\n'));
  await w.close();
});

const read = async args => p.evaluate(async a => {
  const c = await import('/js/tools/code.js');
  return c.read(a);
}, args);
const search = async args => p.evaluate(async a => {
  const c = await import('/js/tools/code.js');
  return c.search(a);
}, args);

// 1) sin parámetros: fichero ENTERO, comportamiento de siempre (no roto)
const whole = await read({ path: 'big.py' });
ok('sin offset/limit/around, lee el fichero entero', whole.split('\n').length === 250 && whole.includes('L1') && whole.includes('L250'));
ok('el fichero entero NO lleva números de línea (compat con code.edit)', !whole.includes('1→'));

// 2) paginado: offset+limit trae exactamente ese rango, numerado
const page1 = await read({ path: 'big.py', offset: 1, limit: 100 });
ok('página 1 (offset:1, limit:100) empieza en la línea 1 numerada', page1.includes('1→L1'));
ok('página 1 llega hasta la línea 100', page1.includes('100→L100') && !page1.includes('101→'));
ok('avisa de que quedan más líneas y cómo seguir', /offset:101/.test(page1), page1.split('\n').pop());

const page2 = await read({ path: 'big.py', offset: 101, limit: 100 });
ok('página 2 (offset:101) sigue justo donde acabó la 1', page2.includes('101→L101') && !page2.includes('100→'));

const lastPage = await read({ path: 'big.py', offset: 201, limit: 100 });
ok('última página no promete más líneas de las que hay (fichero tiene 250)', lastPage.includes('250→L250') && !/offset:251/.test(lastPage));

// 3) code.search sigue devolviendo número de línea real
const found = await search({ query: 'MARCA_BUSCADA_XYZ' });
ok('code.search devuelve el número de línea del hit', /big\.py:173:/.test(found), found);

// 4) around: centra ~100 líneas alrededor del número que dio la búsqueda
const around = await read({ path: 'big.py', around: 173 });
ok('around:173 incluye la línea exacta de la marca, numerada', around.includes('173→MARCA_BUSCADA_XYZ'));
ok('around:173 trae líneas de ANTES', around.includes('150→L150') || around.includes('140→L140'));
ok('around:173 trae líneas de DESPUÉS', around.includes('190→L190') || around.includes('200→L200'));

// 5) code.edit (que usa read({path}) internamente) sigue funcionando sin cambios
const editOut = await p.evaluate(async () => {
  const c = await import('/js/tools/code.js');
  return c.edit({ path: 'big.py', search: 'MARCA_BUSCADA_XYZ', replace: 'MARCA_EDITADA' });
});
ok('code.edit sigue funcionando tal cual (no afectado por el nuevo modo paginado)', /Escrito big\.py/.test(editOut), editOut);
const afterEdit = await read({ path: 'big.py', around: 173 });
ok('el cambio de code.edit se ve reflejado', afterEdit.includes('MARCA_EDITADA'));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ code.read PAGINADO + around OK, code.search/code.edit intactos');
await b.close();
process.exit(fails ? 1 : 0);

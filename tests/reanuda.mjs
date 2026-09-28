// ¿Se reanuda de verdad una descarga cortada, o solo lo parece?
//
// Antes, un corte borraba lo ya escrito y la vez siguiente empezaba de cero.
// Con un modelo de gigas eso convierte un tropiezo de red en media hora
// perdida, y el usuario lo vive como «vuelve a descargar el modelo».
//
// La prueba corta la descarga A PROPÓSITO a mitad y vuelve a pedirla. Lo que se
// comprueba no es que «funcione» sino las dos cosas que pueden ir mal:
//   · que la segunda vez pida sólo el RESTO (si no, no hay reanudación);
//   · que el fichero final sea BYTE A BYTE el original (si no, la reanudación
//     ha empalmado mal y tendríamos un modelo corrupto que carga y da basura,
//     que es peor que volver a bajarlo).
//
// Se usa un fichero pequeño servido en local, no el modelo de 7 GB: lo que se
// prueba es la lógica de reanudación, y para eso da igual el tamaño.
import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

// ── Un servidor que habla rangos y que puede CORTAR a mitad ────────────────
const TAM = 3 * 1024 * 1024;
const DATOS = Buffer.alloc(TAM);
for (let i = 0; i < TAM; i++) DATOS[i] = (i * 7 + 13) & 0xff;   // patrón, no ceros:
// con ceros, un empalme mal hecho seguiría dando el mismo hash y pasaría.
const SHA = createHash('sha256').update(DATOS).digest('hex');

let cortar = false;              // cuando está puesto, el servidor corta a la mitad
const peticiones = [];
const srv = createServer((req, res) => {
  const rango = req.headers.range;
  const m = rango && /bytes=(\d+)-/.exec(rango);
  const desde = m ? +m[1] : 0;
  peticiones.push({ rango: rango || null, desde });
  // El sondeo de un byte se responde BIEN aunque estemos simulando un corte: una
  // red que se cae a mitad de una descarga de gigas no impide hacer una
  // petición de un byte. La primera versión cortaba también el sondeo, así que
  // la descarga moría a nivel de red antes de escribir nada y no había nada que
  // reanudar — el banco marcaba en rojo por culpa del banco.
  const sondeo = /bytes=0-0$/.test(rango || '');
  const hasta = sondeo ? 0 : TAM - 1;
  const cuerpo = DATOS.subarray(desde, hasta + 1);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
  if (m) {
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${desde}-${hasta}/${TAM}`);
  }
  res.setHeader('Content-Length', String(cuerpo.length));
  if (cortar && !sondeo && cuerpo.length > 1024) {
    // Se manda la mitad, se deja que LLEGUE, y entonces se corta. Destruir el
    // socket en el mismo tick hacía que Chrome invalidara la respuesta entera y
    // rechazara el `fetch`: no llegaba un solo byte a la aplicación, y entonces
    // no hay nada que reanudar. Una red que se cae de verdad entrega lo que ya
    // iba en camino y corta después; esto reproduce eso.
    res.write(cuerpo.subarray(0, Math.floor(cuerpo.length / 2)));
    setTimeout(() => { try { res.destroy(); } catch { /* — */ } }, 400);
    return;
  }
  res.end(cuerpo);
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const PUERTO = srv.address().port;
const BASE = `http://127.0.0.1:${PUERTO}`;

// La página tiene que servirse por HTTP para tener OPFS: se sirve desde el
// mismo servidor una página mínima que importa el almacén de verdad.
const RAIZ = join(homedir(), 'work2026/elffuss-code/web');
const srv2 = createServer((req, res) => {
  const ruta = req.url.split('?')[0];
  if (ruta === '/') {
    res.setHeader('Content-Type', 'text/html');
    return res.end('<!doctype html><meta charset=utf-8><title>reanuda</title>');
  }
  const f = join(RAIZ, ruta);
  if (!existsSync(f)) { res.statusCode = 404; return res.end('no'); }
  res.setHeader('Content-Type', ruta.endsWith('.js') ? 'text/javascript' : 'text/plain');
  res.end(readFileSync(f));
});
await new Promise(r => srv2.listen(0, '127.0.0.1', r));
const APP = `http://127.0.0.1:${srv2.address().port}`;

const rutas = [join(homedir(), 'work2026/elffuss-claw/tests/node_modules/playwright-core/index.mjs'),
  join(homedir(), '.claude/skills/browser-post/node_modules/playwright-core/index.mjs')];
const { chromium } = await import(rutas.find(existsSync));
const perfil = mkdtempSync(join(tmpdir(), 'reanuda-'));
const ctx = await chromium.launchPersistentContext(perfil, {
  channel: 'chrome', ignoreDefaultArgs: ['--use-mock-keychain'],
});
const p = await ctx.newPage();
p.on('pageerror', e => console.log('· PAGEERROR: ' + e.message.slice(0, 120)));

try {
  await p.goto(APP + '/', { waitUntil: 'domcontentloaded' });

  const baja = async (url) => p.evaluate(async (u) => {
    const m = await import('/js/runtime/model-store.js');
    try {
      const f = await m.getModelFile(u, () => {});
      if (!f) return { err: 'sin fichero' };
      const buf = new Uint8Array(await f.arrayBuffer());
      let h = 0; const cr = await crypto.subtle.digest('SHA-256', buf);
      void h;
      return { size: f.size, sha: [...new Uint8Array(cr)].map(b => b.toString(16).padStart(2, '0')).join('') };
    } catch (e) { return { err: String(e.message || e), pila: String(e.stack || '').split('\n').slice(0, 4).join(' | ') }; }
  }, url);

  const url = BASE + '/modelo.bin';

  // 1) Primer intento CORTADO a la mitad.
  cortar = true;
  const a = await baja(url);
  ok('el primer intento falla (la red se corta)', !!a.err, (a.err || '') + ' :: ' + (a.pila || ''));

  // Qué quedó en disco tras el corte: es lo que decide si hay reanudación.
  const estado = await p.evaluate(async () => {
    const out = { ficheros: [] };
    try {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('elffuss-models', { create: true });
      for await (const [n, h] of dir.entries()) {
        const f = await h.getFile();
        out.ficheros.push({ n, size: f.size, txt: f.size < 200 ? await f.text() : '' });
      }
    } catch (e) { out.err = String(e.message || e); }
    return out;
  });
  console.log('· en disco tras el corte: ' + (estado.err || JSON.stringify(estado.ficheros)));

  // 2) Segundo intento, servidor sano: tiene que pedir el RESTO, no todo.
  cortar = false;
  peticiones.length = 0;
  const b = await baja(url);
  const conRango = peticiones.filter(x => x.desde > 0);
  ok('la segunda vez pide sólo el resto', conRango.length > 0,
    peticiones.map(x => x.rango || 'sin rango').join(' · '));
  ok('el fichero queda completo', b.size === TAM, `${b.size} de ${TAM}`);
  // Lo que de verdad importa: que no se haya empalmado mal.
  ok('el contenido es byte a byte el original', b.sha === SHA,
    b.sha ? `${b.sha.slice(0, 16)}… contra ${SHA.slice(0, 16)}…` : JSON.stringify(b));
} finally {
  await ctx.close(); srv.close(); srv2.close();
}
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ REANUDA OK — un corte ya no cuesta la descarga entera');
process.exit(fails ? 1 : 0);

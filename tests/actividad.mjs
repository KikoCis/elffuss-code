// Bus de actividad: cada llamada de la elfa se anuncia (inicio y fin) para que la
// vista de ciudad encienda el fichero que toca y muestre el registro.
//
// Controles negativos incluidos: si el banco no se ha visto fallar, no prueba nada.
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

await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const d = await root.getDirectoryHandle('src', { create: true });
  const fh = await d.getFileHandle('app.js', { create: true });
  const w = await fh.createWritable(); await w.write('export const hola = 1;\n'); await w.close();
});

const eventos = await p.evaluate(async () => {
  const act = await import('/js/actividad.js');
  const tools = await import('/js/tools/index.js');
  const recogidos = [];
  const quitar = act.escuchar(e => recogidos.push(e));
  // Un oyente que LANZA no debe tumbar la herramienta.
  const quitarMalo = act.escuchar(() => { throw new Error('oyente roto'); });
  let leido = null, error = null;
  try { leido = await tools.runTool('code.read', { path: 'src/app.js' }); } catch (e) { error = String(e.message); }
  let fallo = null;
  try { await tools.runTool('code.read', { path: 'src/no_existe_zz.js' }); } catch (e) { fallo = String(e.message); }
  quitarMalo(); quitar();
  return { recogidos, leido: String(leido || '').slice(0, 60), error, fallo };
});

const inicio = eventos.recogidos.find(e => e.fase === 'inicio' && e.herramienta === 'code.read' && e.ruta === 'src/app.js');
const fin = eventos.recogidos.find(e => e.fase === 'fin' && e.herramienta === 'code.read' && e.ok === true);
ok('la lectura anuncia INICIO con la ruta y el modo «lee»', !!inicio && inicio.modo === 'lee', JSON.stringify(inicio));
ok('la lectura anuncia FIN con ok:true y un resumen', !!fin && typeof fin.resumen === 'string' && fin.resumen.length > 0, JSON.stringify(fin));
ok('la herramienta devolvió el contenido pese a un oyente roto',
  eventos.leido.includes('hola') || eventos.leido.includes('export'), eventos.leido);
ok('sin error inesperado en la lectura buena', eventos.error === null, String(eventos.error));

// Un fallo también se anuncia (ok:false) y SIGUE lanzando.
const finFallo = eventos.recogidos.find(e => e.fase === 'fin' && e.ok === false && e.ruta === 'src/no_existe_zz.js');
ok('un fallo se anuncia con ok:false', !!finFallo, JSON.stringify(finFallo));
ok('y el error llega igual al que llama', !!eventos.fallo && eventos.fallo.includes('no existe'), String(eventos.fallo));

// Escritura: modo «escribe», no «lee».
const escrito = await p.evaluate(async () => {
  const act = await import('/js/actividad.js');
  const t = await import('/js/tools/index.js');
  const recogidos = []; const q = act.escuchar(e => recogidos.push(e));
  try { await t.runTool('code.write', { path: 'src/nuevo.js', content: 'x' }); } catch {}
  q();
  return recogidos;
});
const inicioW = escrito.find(e => e.fase === 'inicio' && e.herramienta === 'code.write');
ok('la escritura anuncia el modo «escribe»', !!inicioW && inicioW.modo === 'escribe', JSON.stringify(inicioW));

// Herramienta sin fichero (terminal.run): se anuncia pero sin ruta.
const sinFichero = await p.evaluate(async () => {
  const act = await import('/js/actividad.js');
  const t = await import('/js/tools/index.js');
  const recogidos = []; const q = act.escuchar(e => recogidos.push(e));
  try { await t.runTool('terminal.run', { command: 'ls' }); } catch {}
  q();
  return recogidos.find(e => e.fase === 'inicio');
});
ok('terminal.run se anuncia sin ruta (no toca un fichero concreto)',
  !!sinFichero && sinFichero.ruta === undefined && sinFichero.args.command === 'ls', JSON.stringify(sinFichero));

// Control negativo: sin suscriptor no hay eventos, y tocar un fichero sin oyentes no falla.
const silencio = await p.evaluate(async () => {
  const t = await import('/js/tools/index.js');
  try { await t.runTool('code.read', { path: 'src/app.js' }); return 'ok'; } catch (e) { return 'FALLA: ' + e.message; }
});
ok('sin oyentes, runTool funciona igual', silencio === 'ok', silencio);

await b.close();
console.log(fails ? `\n${fails} fallo(s)` : '\nTodo en verde');
process.exit(fails ? 1 : 0);

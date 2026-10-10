// Ajustes: lo que ofrecen tiene que ser lo correcto, y usarse sin ratón.
//
//   1. Bridge para un Mac ARM: antes se ofrecía la versión Intel (todos los Mac
//      dicen «MacIntel» en navigator.platform). Si no se puede saber la
//      arquitectura, se ofrecen las dos versiones de Mac.
//   2. Token y carpeta del bridge con su etiqueta asociada; «Olvidar token» y
//      «Desconectar» existen (antes no había forma).
//   3. El permiso dice lo que controla (ficheros), no «y comandos de terminal».
//   4. Los interruptores de proveedores externos tienen nombre accesible.
//   5. El punto del modelo dice con palabras qué modelo y en qué estado, y es
//      un botón que lleva a Ajustes.
//   6. Al elegir un modelo, su tarjeta dice «cargando…» y, al terminar, queda
//      resaltada (antes el resaltado se quedaba en el anterior). Lo escrito en
//      Ajustes mientras carga no se pierde y el foco no se va a <body>.
//   5. El punto del modelo lleva el foco a la tarjeta del modelo activo.
// El modelo es de mentira: page.route sirve un providers/onnx.js propio.
//
//   BASE=http://127.0.0.1:8898 node tests/settings-ux.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const FALSO = `export const name = 'onnx falso'; export function configure() {}
export async function load(onProgress = () => {}) { onProgress('cargando falso'); await new Promise(r => setTimeout(r, 900)); }
export async function chat() { return 'hola'; }`;

const b = await chromium.launch();
const errs = [];
const abre = async (arch) => {
  const ctx = await b.newContext({ locale: 'es-ES', userAgent: MAC_UA });
  await ctx.addInitScript((arch) => {
    try { localStorage.setItem('elffusscode.model', 'rules'); localStorage.setItem('elffusscode.bridgeToken', 'tok-de-prueba'); } catch {}
    const datos = arch === null ? undefined : { getHighEntropyValues: async () => ({ architecture: arch }) };
    Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => datos, configurable: true });
  }, arch);
  const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.route('**/js/providers/onnx.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FALSO }));
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 15000 });
  return { ctx, p };
};
const descargas = (p) => p.evaluate(() => [...document.querySelectorAll('#br-dl a')].map(a => a.dataset.file));

// 1 · Mac ARM
let { ctx, p } = await abre('arm');
await p.click('#btn-settings');
await p.waitForTimeout(500);
ok('1 · en un Mac ARM se ofrece la versión Apple Silicon', JSON.stringify(await descargas(p)) === '["elffuss-bridge-mac-arm64"]', JSON.stringify(await descargas(p)));

// 2 · etiquetas, Olvidar token
const etiquetas = await p.evaluate(() => ['br-token', 'br-folder'].map(id => document.getElementById(id).labels?.length || 0));
ok('2 · token y carpeta tienen su etiqueta asociada', etiquetas.every(n => n === 1), JSON.stringify(etiquetas));
ok('2 · con un token guardado se ofrece «Olvidar token»', await p.locator('#br-forget').isVisible());
await p.click('#br-forget');
await p.waitForTimeout(150);
const olvido = await p.evaluate(() => ({ ls: localStorage.getItem('elffusscode.bridgeToken'), input: document.getElementById('br-token').value, msg: document.querySelector('.bridge-card .br-msg')?.textContent || '' }));
ok('2 · «Olvidar token» lo borra del navegador y lo dice', olvido.ls === null && olvido.input === '' && /olvidado/.test(olvido.msg), JSON.stringify(olvido));
const disc = await p.evaluate(() => !!document.getElementById('br-disconnect'));
ok('2 · existe «Desconectar» (visible cuando el bridge está conectado)', disc);

// 3 · permiso
const permiso = await p.evaluate(() => document.querySelector('#perm-autoedit').closest('label').textContent);
ok('3 · el permiso dice que controla escribir y editar ficheros', /Escribir y editar ficheros/.test(permiso) && !/comandos de terminal/.test(permiso), permiso);

// 4 · proveedores
const nombres = await p.evaluate(() => [...document.querySelectorAll('#settings-panel .prov-head input[type=checkbox]')].map(c => c.getAttribute('aria-label')));
ok('4 · cada interruptor de proveedor tiene nombre accesible', nombres.length >= 3 && nombres.every(n => /^Activar /.test(n || '')), JSON.stringify(nombres));

// 6 · tarjeta de modelo: cargando… y resaltada al terminar
const tarjetaQwen = p.locator('#settings-panel .model-card', { hasText: 'Qwen3.5-0.8B' }).first();
await tarjetaQwen.click();
await p.waitForTimeout(150);
const durante = await p.evaluate(() => { const c = [...document.querySelectorAll('#settings-panel .model-card')].find(x => /Qwen3.5-0.8B/.test(x.textContent)); return { busy: c?.getAttribute('aria-busy'), txt: c?.textContent }; });
ok('6 · al elegir un modelo, su tarjeta dice «cargando…» (aria-busy)', durante.busy === 'true' && /cargando/.test(durante.txt), JSON.stringify(durante));
// …y mientras carga se puede seguir escribiendo en Ajustes: al terminar la carga
// el panel ya no se rehace entero (antes se borraba el texto y el foco iba a <body>)
await p.locator('#tel-feedback').fill('texto a medio escribir');
await p.waitForTimeout(1500);
const tras = await p.evaluate(() => { const c = [...document.querySelectorAll('#settings-panel .model-card')].find(x => /Qwen3.5-0.8B/.test(x.textContent)); return { activa: c?.classList.contains('active'), pressed: c?.getAttribute('aria-pressed') }; });
ok('6 · al terminar, la tarjeta del modelo cargado queda resaltada', tras.activa && tras.pressed === 'true', JSON.stringify(tras));
const escrito = await p.evaluate(() => ({ valor: document.getElementById('tel-feedback')?.value, foco: document.activeElement?.id || document.activeElement?.tagName }));
ok('6 · lo escrito en Ajustes mientras cargaba sigue ahí, con el foco', escrito.valor === 'texto a medio escribir' && escrito.foco === 'tel-feedback', JSON.stringify(escrito));
// Con el teclado: Enter en una tarjeta deja el foco en ELLA (antes, en <body>)
const enfocada = () => p.evaluate(() => { const a = document.activeElement; return a?.classList.contains('model-card') ? a.querySelector('b')?.textContent : (a?.id || a?.tagName); });
await p.locator('#settings-panel .model-card', { hasText: 'Básico' }).first().focus();
await p.keyboard.press('Enter');
await p.waitForTimeout(200);
ok('6 · Enter en la tarjeta «Básico» deja el foco en esa tarjeta', /Básico/.test(await enfocada() || ''), await enfocada());
await tarjetaQwen.focus();
await p.keyboard.press('Enter');
await p.waitForTimeout(150);
const focoCargando = await enfocada();
await p.waitForTimeout(1500);
ok('6 · Enter en una tarjeta que carga: el foco sigue en ella durante y después de la carga', /Qwen3.5-0.8B/.test(focoCargando || '') && /Qwen3.5-0.8B/.test(await enfocada() || ''),
  JSON.stringify({ focoCargando, despues: await enfocada() }));

// 5 · el punto del modelo
await p.click('#btn-settings');   // cierra
const punto = await p.evaluate(() => { const d = document.getElementById('model-dot'); return { tag: d.tagName, aria: d.getAttribute('aria-label') }; });
ok('5 · el punto del modelo es un botón que dice qué modelo y su estado', punto.tag === 'BUTTON' && /Qwen3.5-0.8B/.test(punto.aria) && /listo/.test(punto.aria), JSON.stringify(punto));
await p.click('#model-dot');
await p.waitForTimeout(300);
ok('5 · …y lleva a Ajustes', await p.evaluate(() => !document.getElementById('settings-panel').hidden && !!document.querySelector('#settings-panel .model-grid')));
ok('5 · …con el foco en la tarjeta del modelo ACTIVO (no en la primera)', await p.evaluate(() =>
  document.activeElement?.classList.contains('model-card') && document.activeElement.classList.contains('active') && /Qwen3.5-0.8B/.test(document.activeElement.textContent)),
  await p.evaluate(() => document.activeElement?.textContent?.slice(0, 40)));
await ctx.close();

// 1 · Mac sin datos de arquitectura (Safari): las dos versiones
({ ctx, p } = await abre(null));
await p.click('#btn-settings');
await p.waitForTimeout(500);
ok('1 · si no se sabe la arquitectura del Mac, se ofrecen las dos versiones', JSON.stringify(await descargas(p)) === '["elffuss-bridge-mac-arm64","elffuss-bridge-mac-intel"]', JSON.stringify(await descargas(p)));
await ctx.close();

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ AJUSTES: LO QUE OFRECEN ES LO CORRECTO');
await b.close();
process.exit(fails ? 1 : 0);

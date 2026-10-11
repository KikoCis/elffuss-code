// Ajustes que decían una cosa y hacían otra:
//
//   1. Espacio de trabajo · «Guardar solo»: no guardaba NUNCA (nada llamaba a
//      workspace.touch()). Ahora un mensaje nuevo acaba en .elffuss/code/ del
//      disco sin pulsar «Guardar ahora».
//   2. Feedback · Enviar: decía «¡enviado, gracias!» aunque el servidor
//      contestara 404, y borraba el texto. Ahora dice que falló y lo conserva;
//      cuando el servidor lo acepta, sí lo da por enviado.
//   3. Chip 💾 y «Vaciar caché»: contaban el origen ENTERO como «modelos» y al
//      vaciar solo borraban una caché vieja. Ahora cuentan solo los modelos
//      (almacén OPFS de modelos + caché de transformers) y los vacían de verdad
//      sin tocar lo demás, diciendo cuánto se liberó. Con un SDK de broker que
//      sabe del almacén compartido, se cuentan y vacían también el broker por
//      defecto y los hosts del motor, todos a la vez.
// Ningún broker de verdad: sus páginas las contesta un doble local.
//
//   BASE=http://127.0.0.1:8898 node tests/storage-honest.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
// Ningún broker de verdad: las páginas de broker (models, m1, m2… de elffuss) las
// contesta un doble local que dice «listo», mide 0 y vacía. Con el SDK de broker
// que sabe del almacén compartido (el de main), este test cargaba las páginas de
// producción y esperaba sus tiempos muertos.
const BROKER_FALSO = `<!doctype html><script>
parent.postMessage({ kind: 'elffuss-broker-ready' }, '*');
addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'elffuss-broker-diag') e.source.postMessage({ kind: 'diag', id: d.id, usado: 0, quota: 0 }, e.origin);
  if (d.type === 'elffuss-model-clear') e.source.postMessage({ kind: 'cleared', id: d.id, liberado: 0 }, e.origin);
});
<\/script>`;
const BROKERS = /^https:\/\/(models|m\d+)\.elffuss\.(com|utopiaia\.com)\//;
const brokersPedidos = [];
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.route(BROKERS, r => { brokersPedidos.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/html', body: BROKER_FALSO }); });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} window.confirm = () => true; });
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));

const MB = 1048576;
await p.goto(BASE + '/manifest.json');
await p.evaluate(async (MB) => {
  const root = await navigator.storage.getDirectory();
  const escribe = async (dir, name, bytes) => { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(new Uint8Array(bytes)); await w.close(); };
  await escribe(root, 'datos-del-proyecto.bin', 3 * MB);                        // NO es un modelo
  await escribe(await root.getDirectoryHandle('elffuss-models', { create: true }), 'pesos.bin', 2 * MB);
  const c = await caches.open('transformers-cache');
  await c.put('https://huggingface.co/x/onnx/model.onnx', new Response(new Uint8Array(1 * MB), { headers: { 'content-length': String(1 * MB) } }));
}, MB);
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.() && !document.getElementById('disk-chip').hidden, null, { timeout: 20000 }).catch(() => {});

// 3 · el chip cuenta solo los modelos
const chip = await p.evaluate(() => ({ txt: document.getElementById('disk-chip').textContent, title: document.getElementById('disk-chip').title }));
ok('3 · el chip cuenta solo los modelos (3 MB), no los 3 MB de datos del proyecto', /💾 3 MB/.test(chip.txt), JSON.stringify(chip));
await p.click('#disk-chip');
await p.waitForFunction(() => /Liberados/.test(document.getElementById('statusbar').textContent), null, { timeout: 10000 }).catch(() => {});
const tras = await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const hay = async (n) => { try { await root.getDirectoryHandle(n); return true; } catch { return false; } };
  const fichero = async (n) => { try { return (await (await root.getFileHandle(n)).getFile()).size; } catch { return -1; } };
  return {
    estado: document.getElementById('statusbar').textContent, modelos: await hay('elffuss-models'),
    transformers: (await caches.keys()).includes('transformers-cache'), proyecto: await fichero('datos-del-proyecto.bin'),
    chipOculto: document.getElementById('disk-chip').hidden,
  };
});
ok('3 · vaciar borra el almacén de modelos y la caché de transformers', !tras.modelos && !tras.transformers, JSON.stringify(tras));
ok('3 · …sin tocar los datos del proyecto', tras.proyecto === 3 * MB, JSON.stringify(tras));
ok('3 · …y dice cuánto liberó', /Liberados 3 MB/.test(tras.estado), tras.estado);
ok('3 · el chip desaparece cuando no queda ningún modelo', tras.chipOculto);

// 3 · «Vaciar caché» de Ajustes usa la misma rutina
await p.evaluate(async (MB) => {
  const root = await navigator.storage.getDirectory();
  const w = await (await (await root.getDirectoryHandle('elffuss-models', { create: true })).getFileHandle('otro.bin', { create: true })).createWritable();
  await w.write(new Uint8Array(1 * MB)); await w.close();
}, MB);
await p.click('#btn-settings');
await p.waitForTimeout(500);
const tarjeta = await p.evaluate(() => [...document.querySelectorAll('#settings-panel .prov-card')].map(c => c.textContent).find(t => /modelos guardados|Ningún modelo/.test(t)) || '');
ok('3 · la tarjeta de Ajustes habla de modelos guardados (1 MB)', /1 MB en modelos guardados/.test(tarjeta), tarjeta.slice(0, 120));
await p.locator('#settings-panel button', { hasText: 'Vaciar caché' }).click();
await p.waitForTimeout(800);
const ajustes = await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  let hay = true; try { await root.getDirectoryHandle('elffuss-models'); } catch { hay = false; }
  return { hay, msg: [...document.querySelectorAll('#settings-panel [role="status"]')].map(n => n.textContent).join(' | ') };
});
ok('3 · «Vaciar caché» de Ajustes vacía los modelos y lo dice', !ajustes.hay && /Liberados 1 MB/.test(ajustes.msg), JSON.stringify(ajustes));

// 2 · Feedback: el 404 del servidor local NO es «enviado»
await p.fill('#tel-feedback', 'un fallo que vi');
await p.click('#tel-send');
await p.waitForTimeout(600);
const f1 = await p.evaluate(() => ({ msg: document.getElementById('tel-msg').textContent, texto: document.getElementById('tel-feedback').value }));
ok('2 · si el servidor no lo acepta, dice que falló', /No se pudo enviar/.test(f1.msg) && !/enviado, gracias/.test(f1.msg), JSON.stringify(f1));
ok('2 · …y conserva el texto', f1.texto === 'un fallo que vi', JSON.stringify(f1));
await p.route('**/proxy/report', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
await p.click('#tel-send');
await p.waitForTimeout(600);
const f2 = await p.evaluate(() => ({ msg: document.getElementById('tel-msg').textContent, texto: document.getElementById('tel-feedback').value }));
ok('2 · si el servidor lo acepta, lo da por enviado y vacía la caja', /enviado, gracias/.test(f2.msg) && f2.texto === '', JSON.stringify(f2));
await p.unroute('**/proxy/report');

// 1 · «Guardar solo» guarda de verdad
await p.locator('#settings-panel button', { hasText: 'Usar la del proyecto' }).click();
await p.waitForTimeout(400);
const auto = p.locator('#settings-panel label', { hasText: 'Guardar solo' }).locator('input[type=checkbox]');
await auto.check();
await p.click('#btn-settings');           // cerrar Ajustes
await p.fill('#prompt', 'mensaje que tiene que acabar en disco');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(4500);              // el autoguardado espera 3 s a que paren los cambios
const disco = await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  try {
    const app = await (await root.getDirectoryHandle('.elffuss')).getDirectoryHandle('code');
    const idx = JSON.parse(await (await (await app.getFileHandle('index.json')).getFile()).text());
    const conv = await app.getDirectoryHandle('conversations');
    let contiene = false;
    for await (const e of conv.values()) if (e.kind === 'file' && (await (await e.getFile()).text()).includes('mensaje que tiene que acabar en disco')) contiene = true;
    return { razon: idx.reason, contiene };
  } catch (e) { return { error: e.message }; }
});
ok('1 · con «Guardar solo», el mensaje nuevo acaba en .elffuss/code/ sin pulsar Guardar', disco.razon === 'auto' && disco.contiene, JSON.stringify(disco));

// 3 · con el SDK de broker que sabe del almacén compartido (el de main)
// Doble local: el model-broker.js de este árbol con sharedUsage/clearShared que
// apuntan lo que se les pide, y un registro del motor con dos hosts de pesos.
{
  const DOBLE = `
export async function sharedUsage(o) { (window.__comp ||= []).push(['medir', JSON.stringify(o)]); return { usage: 0, quota: 0, ok: true }; }
export async function clearShared(o) {
  window.__vuelo = (window.__vuelo || 0) + 1; window.__maxVuelo = Math.max(window.__maxVuelo || 0, window.__vuelo);
  (window.__comp ||= []).push(['vaciar', o]);
  await new Promise(r => setTimeout(r, 400));
  window.__vuelo--;
  return { liberado: 0, ok: true };
}`;
  const c2 = await b.newContext({ locale: 'es-ES' });
  await c2.route(BROKERS, r => { brokersPedidos.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/html', body: BROKER_FALSO }); });
  await c2.route('**/js/runtime/model-broker.js*', async route => {
    const r = await route.fetch();
    // El SDK de main YA trae sharedUsage/clearShared: los suyos se renombran y se
    // ponen los dobles. Añadir los dobles sin más duplicaba los export y el
    // módulo entero no cargaba (y model-cache.js se quedaba sin broker).
    const propio = (await r.text())
      .replace(/export async function sharedUsage\(/, 'async function sharedUsageReal(')
      .replace(/export async function clearShared\(/, 'async function clearSharedReal(');
    await route.fulfill({ response: r, body: propio + DOBLE, headers: { ...r.headers(), 'content-type': 'text/javascript' } });
  });
  await c2.route('**/js/engine/registro.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript',
    body: "export const MODELS = {}; export async function disponible() { return false; } export function origenesAlmacen() { return ['https://m1.elffuss.com/', 'https://m2.elffuss.com/']; }" }));
  await c2.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} window.confirm = () => true; });
  const q = await c2.newPage();
  q.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await q.goto(BASE + '/manifest.json');
  const r = await q.evaluate(async () => {
    const mc = await import('/js/model-cache.js');
    await mc.modelUsage();
    const v = await mc.clearModels();
    return { comp: window.__comp || [], max: window.__maxVuelo || 0, fallos: v.fallos };
  });
  const medido = r.comp.find(([k]) => k === 'medir')?.[1] || '';
  ok('3 · el almacén compartido se mide en los hosts del motor Y en el broker por defecto (donde están los modelos de Hugging Face)',
    /m1\.elffuss/.test(medido) && /m2\.elffuss/.test(medido) && /models\.elffuss/.test(medido), medido);
  const vaciados = r.comp.filter(([k]) => k === 'vaciar').map(([, o]) => o);
  ok('3 · «Vaciar» los vacía todos, también el broker por defecto', vaciados.length === 3 && vaciados.some(o => /models\.elffuss/.test(o)), JSON.stringify(vaciados));
  ok('3 · …y a la vez, no uno detrás de otro (un broker mudo no suma esperas)', r.max === 3, JSON.stringify(r));
  await c2.close();
}
console.log('  páginas de broker pedidas (todas las contesta el doble, ninguna sale a la red):', brokersPedidos.length ? brokersPedidos.join(' ') : 'ninguna');

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ AJUSTES QUE HACEN LO QUE DICEN');
await b.close();
process.exit(fails ? 1 : 0);

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
//      sin tocar lo demás, diciendo cuánto se liberó.
//
//   BASE=http://127.0.0.1:8898 node tests/storage-honest.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
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

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ AJUSTES QUE HACEN LO QUE DICEN');
await b.close();
process.exit(fails ? 1 : 0);

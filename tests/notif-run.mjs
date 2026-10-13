// «▶ Ejecutar» en una notificación con la app CERRADA: el IDE se abre con
// ?notif=execute&id=… (sw.js guardó la propuesta en Cache Storage con ese id) y
// la propuesta se manda en cuanto hay un modelo de verdad cargado. Antes la
// ventana nueva no recibía la propuesta: abría la Mente y no ejecutaba nada,
// sin decirlo. (La parte del service worker la prueba tests/sw-notif.mjs.)
//
//   1. Con un modelo que carga (transformers.js de mentira): la propuesta sale
//      sola cuando está listo, y la guardada se borra.
//   2. En modo Básico no se gasta con el motor de reglas: se dice que espera a
//      un modelo, y sale al elegir uno.
//   3. Si la propuesta ya no está: se dice y se abre la Mente.
//
//   BASE=http://localhost:8799 node tests/notif-run.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const FALSO_TF = `
export const env = {};
export class TextStreamer { constructor(t, o) { this.o = o; } }
export class InterruptableStoppingCriteria { interrupt() {} }
export async function pipeline() {
  const g = async (messages) => { (window.__recibido ||= []).push(messages.at(-1)?.content || ''); return [{ generated_text: 'hecho' }]; };
  g.tokenizer = {}; g.dispose = () => {};
  return g;
}`;
const MD = '# Propuestas de mejora — ciclo 7\n\n## Calidad\nAñadir pruebas a app.js';
const b = await chromium.launch();
const errs = [];

async function abre({ modelo, sembrar = true, id = 'abc123def' }) {
  const ctx = await b.newContext({ locale: 'es-ES' });
  await ctx.addInitScript(m => {
    // WebGPU simulada y pequeña (no entra Gemma): desde d526a74 el ONNX ligero
    // solo se ofrece con WebGPU, y este test va del flujo de la notificación,
    // no de la GPU. transformers.js es de mentira: no se baja nada.
    const falsa = { requestAdapter: async () => ({ limits: { maxBufferSize: 2 ** 28 }, features: new Set(), info: {}, requestDevice: async () => { throw new Error('no hace falta'); } }) };
    try { Object.defineProperty(Navigator.prototype, 'gpu', { get() { return falsa; }, configurable: true }); } catch { /* */ }
    try { localStorage.setItem('elffusscode.model', m); } catch { /* */ }
  }, modelo);
  const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.route(/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@4/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FALSO_TF }));
  await p.goto(BASE + '/manifest.json');
  if (sembrar) await p.evaluate(async ({ id, md }) => { await (await caches.open('elffuss-notif')).put('./notif/' + id, new Response(md)); }, { id, md: MD });
  await p.goto(BASE + `/?test-opfs&notif=execute&id=${id}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 20000 });
  return { ctx, p };
}
const estado = p => p.evaluate(async () => ({
  url: location.search,
  usuario: [...document.querySelectorAll('#chat-log .msg.user')].map(n => n.textContent.slice(0, 60)),
  sistema: [...document.querySelectorAll('#chat-log .msg.sys')].map(n => n.textContent).join(' | '),
  recibido: window.__recibido || [],
  guardada: await (await caches.open('elffuss-notif')).match('./notif/abc123def').then(r => !!r),
  mente: !!document.getElementById('mind-overlay') && getComputedStyle(document.getElementById('mind-overlay')).display !== 'none',
}));

// 1 · con un modelo que carga
{
  const { ctx, p } = await abre({ modelo: 'onnx:qwen3.5-0.8b' });
  await p.waitForFunction(() => (window.__recibido || []).length > 0, null, { timeout: 20000 }).catch(() => {});
  await p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 10000 }).catch(() => {});
  const e = await estado(p);
  ok('1 · la propuesta de la notificación se manda sola en cuanto el modelo está listo', e.usuario.some(u => /Implementa esta propuesta/.test(u)) && e.recibido.some(r => /Añadir pruebas a app\.js/.test(r)), JSON.stringify({ usuario: e.usuario, recibido: e.recibido.length }));
  ok('1 · …una sola vez', e.usuario.filter(u => /Implementa esta propuesta/.test(u)).length === 1, JSON.stringify(e.usuario));
  ok('1 · …la guardada se borra y la URL queda limpia', !e.guardada && !/notif|id=/.test(e.url), JSON.stringify({ guardada: e.guardada, url: e.url }));
  await ctx.close();
}

// 2 · modo Básico: espera a un modelo y no se gasta con las reglas
{
  const { ctx, p } = await abre({ modelo: 'rules' });
  await p.waitForTimeout(800);
  const e = await estado(p);
  ok('2 · en modo Básico no se manda (se gastaría con el motor de reglas)', !e.usuario.some(u => /Implementa esta propuesta/.test(u)), JSON.stringify(e.usuario));
  ok('2 · …y se dice que espera a un modelo', /se ejecuta en cuanto haya un modelo cargado/.test(e.sistema), e.sistema.slice(0, 200));
  await p.click('#btn-settings');
  await p.locator('.model-card[data-model="onnx:qwen3.5-0.8b"]').click();
  await p.waitForFunction(() => (window.__recibido || []).length > 0, null, { timeout: 20000 }).catch(() => {});
  const e2 = await estado(p);
  ok('2 · al elegir un modelo, sale', e2.recibido.some(r => /Añadir pruebas a app\.js/.test(r)), JSON.stringify(e2.recibido.length));
  await ctx.close();
}

// 3 · la propuesta ya no está
{
  const { ctx, p } = await abre({ modelo: 'rules', sembrar: false });
  await p.waitForTimeout(800);
  const e = await estado(p);
  ok('3 · sin la propuesta guardada lo dice y abre la Mente', /No encuentro la propuesta/.test(e.sistema) && e.mente, JSON.stringify({ sistema: e.sistema.slice(0, 120), mente: e.mente }));
  await ctx.close();
}

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ NOTIFICACIÓN «▶ Ejecutar» CON LA APP CERRADA: la propuesta llega y sale');
await b.close();
process.exit(fails ? 1 : 0);

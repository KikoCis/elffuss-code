// Sin WebGPU (no hay Gemma que ofrecer) y sin modelo elegido, el IDE carga solo
// el ONNX ligero, Qwen3.5-0.8B, con el id que ofrece el selector.
//
// Antes se pedía 'onnx' a secas, un id que ya no está entre las opciones
// (b7d7db0): preloadModel() solo carga lo que se ofrece, así que no quedaba
// nada que cargar y el IDE arrancaba sin cerebro, sin decir nada.
//
// transformers.js es de mentira (page.route): no se descarga ningún modelo.
//
//   BASE=http://localhost:8799 node tests/onnx-autoload.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const FALSO_TF = `
export const env = {};
export class TextStreamer { constructor(t, o) { this.o = o; } }
export class InterruptableStoppingCriteria { interrupt() {} }
export async function pipeline(task, id, opts) {
  (window.__tf = window.__tf || []).push({ task, id, device: opts?.device, dtype: opts?.dtype });
  const g = async () => [{ generated_text: 'hola' }];
  g.tokenizer = {}; g.dispose = () => {};
  return g;
}`;

const b = await chromium.launch();
async function arranca(guardado) {
  const ctx = await b.newContext({ locale: 'es-ES' });
  await ctx.addInitScript(g => {
    try { Object.defineProperty(Navigator.prototype, 'gpu', { get() { return undefined; }, configurable: true }); } catch { /* */ }
    try { if (g) localStorage.setItem('elffusscode.model', g); } catch { /* */ }
  }, guardado);
  const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.route(/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@4/, r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FALSO_TF }));
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => /dot on/.test(document.getElementById('model-dot')?.className || ''), null, { timeout: 20000 }).catch(() => {});
  const r = await p.evaluate(() => ({
    tf: window.__tf || [], guardado: localStorage.getItem('elffusscode.model'),
    dot: document.getElementById('model-dot')?.className, nombre: document.getElementById('model-dot')?.getAttribute('aria-label'),
    sel: document.getElementById('model-select')?.value,
    opciones: [...document.querySelectorAll('#model-select option')].map(o => o.value),
  }));
  await ctx.close();
  return { ...r, errs };
}

const r1 = await arranca(null);
ok('sin WebGPU y sin modelo guardado, el IDE carga solo el ONNX ligero (Qwen3.5-0.8B, por wasm)',
  r1.tf.length === 1 && r1.tf[0].id === 'onnx-community/Qwen3.5-0.8B-ONNX' && r1.tf[0].device === 'wasm', JSON.stringify(r1.tf));
ok('…y queda elegido con el id que ofrece el selector', r1.guardado === 'onnx:qwen3.5-0.8b' && r1.sel === 'onnx:qwen3.5-0.8b' && r1.opciones.includes(r1.sel), JSON.stringify({ guardado: r1.guardado, sel: r1.sel, opciones: r1.opciones }));
ok('…con el punto de estado encendido y el nombre del modelo', /\bon\b/.test(r1.dot || '') && /Qwen3\.5-0\.8B/.test(r1.nombre || ''), JSON.stringify({ dot: r1.dot, nombre: r1.nombre }));

// Quien tenía guardado el id viejo ('onnx' a secas, de cuando era Elffuss LM)
// también arranca con el ligero, no sin modelo.
const r2 = await arranca('onnx');
ok('con el id viejo «onnx» guardado, carga el ligero con el id nuevo', r2.tf.length === 1 && r2.guardado === 'onnx:qwen3.5-0.8b' && r2.sel === 'onnx:qwen3.5-0.8b', JSON.stringify({ tf: r2.tf.length, guardado: r2.guardado, sel: r2.sel }));

// Con el modo Básico elegido no se carga nada (eso no cambia).
const r3 = await arranca('rules');
ok('con «Básico» elegido no se carga ningún modelo', r3.tf.length === 0 && r3.guardado === 'rules', JSON.stringify({ tf: r3.tf.length, guardado: r3.guardado }));

const errs = [...r1.errs, ...r2.errs, ...r3.errs];
console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ SIN GPU EL IDE ARRANCA CON EL MODELO LIGERO');
await b.close();
process.exit(fails ? 1 : 0);

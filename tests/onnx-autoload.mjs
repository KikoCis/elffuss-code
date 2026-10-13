// Cuándo se carga solo el ONNX ligero (Qwen3.5-0.8B).
//
// Desde d526a74 SOLO con WebGPU: sin ella ningún dtype funciona en wasm, y
// ofrecerlo era bajar ~600 MB para acabar en «básico». Así que:
//   · sin WebGPU y sin modelo guardado: no se carga nada, ni se ofrece;
//   · sin WebGPU y con el id viejo «onnx» guardado: tampoco se baja nada;
//   · con WebGPU (simulada, pequeña: no entra Gemma) sí se carga el ligero,
//     con el id que ofrece el selector. Es el control positivo: sin él, el test
//     pasaría igual si el ONNX hubiera dejado de cargarse en todas partes.
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
async function arranca(guardado, { gpu = false } = {}) {
  const ctx = await b.newContext({ locale: 'es-ES' });
  await ctx.addInitScript(([g, conGPU]) => {
    // con GPU: un adaptador pequeño (256 MB de buffer), donde no entra Gemma
    const falsa = { requestAdapter: async () => ({ limits: { maxBufferSize: 2 ** 28 }, features: new Set(), info: {}, requestDevice: async () => { throw new Error('no hace falta'); } }) };
    try { Object.defineProperty(Navigator.prototype, 'gpu', { get() { return conGPU ? falsa : undefined; }, configurable: true }); } catch { /* */ }
    try { if (g) localStorage.setItem('elffusscode.model', g); } catch { /* */ }
  }, [guardado, gpu]);
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
ok('sin WebGPU y sin modelo guardado no se baja ningún modelo', r1.tf.length === 0, JSON.stringify(r1.tf));
ok('…el ONNX ligero ni se ofrece en el selector', !r1.opciones.includes('onnx:qwen3.5-0.8b'), JSON.stringify(r1.opciones));
ok('…y el IDE queda en «básico», con el punto apagado', r1.sel === 'rules' && !/\bon\b/.test(r1.dot || ''), JSON.stringify({ sel: r1.sel, dot: r1.dot }));

// Quien tenía guardado el id viejo ('onnx' a secas) tampoco se baja nada sin GPU.
const r2 = await arranca('onnx');
ok('sin WebGPU, con el id viejo «onnx» guardado, tampoco se baja nada', r2.tf.length === 0 && r2.sel === 'rules', JSON.stringify({ tf: r2.tf.length, guardado: r2.guardado, sel: r2.sel }));

// Con el modo Básico elegido no se carga nada (eso no cambia).
const r3 = await arranca('rules');
ok('con «Básico» elegido no se carga ningún modelo', r3.tf.length === 0 && r3.guardado === 'rules', JSON.stringify({ tf: r3.tf.length, guardado: r3.guardado }));

// ⊕ Control positivo: CON WebGPU (pequeña, donde no entra Gemma) el ligero sí
// se carga solo, con el id del selector. Sin esto, todo lo de arriba pasaría
// igual si el ONNX hubiera dejado de cargarse en todas partes.
const r4 = await arranca(null, { gpu: true });
ok('⊕ con WebGPU y sin modelo guardado, se carga solo el ONNX ligero', r4.tf.length === 1 && r4.tf[0].id === 'onnx-community/Qwen3.5-0.8B-ONNX', JSON.stringify(r4.tf));
ok('⊕ …y queda elegido con el id que ofrece el selector', r4.sel === 'onnx:qwen3.5-0.8b' && r4.opciones.includes(r4.sel), JSON.stringify({ sel: r4.sel, opciones: r4.opciones }));

const errs = [...r1.errs, ...r2.errs, ...r3.errs, ...r4.errs];
console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ EL ONNX LIGERO SOLO SE CARGA CON WEBGPU');
await b.close();
process.exit(fails ? 1 : 0);

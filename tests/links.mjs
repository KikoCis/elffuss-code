// Enlaces que llevan a un sitio concreto, y de dónde sale lo que se usa.
//
//   1. #/conv/<id> reabre esa conversación; su menú tiene «Copiar enlace».
//   2. #/mind abre la Mente, #/settings Ajustes y #/lab el banco de pruebas.
//      (Antes solo existía #/file/<ruta>.)
//   3. Ajustes enlaza la ficha de cada modelo local (Hugging Face) y la
//      documentación de la API de cada proveedor externo.
//   4. Cada descarga del bridge enseña su SHA-256, el de bridge-dl/SHA256SUMS.
//
//   BASE=http://localhost:8799 node tests/links.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const BASE = process.env.BASE || 'http://localhost:8799';
const SUMAS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'bridge-dl', 'SHA256SUMS'), 'utf8');
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES', permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.addInitScript(() => {
  try { localStorage.setItem('elffusscode.model', 'rules'); } catch {}
  try { Object.defineProperty(Navigator.prototype, 'gpu', { get() { return undefined; }, configurable: true }); } catch {}
});
const errs = [];
const abre = async (ruta = '') => {
  const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.goto(BASE + '/?test-opfs' + ruta, { waitUntil: 'domcontentloaded' });
  if (ruta !== '#/lab') await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 20000 });
  return p;
};

// 1 · conversaciones
let p = await abre();
const ids = await p.evaluate(async () => {
  const conv = window.elffussClaw.conv;
  const primera = conv.getActive().id;
  conv.send(primera, 'hola');
  await new Promise(r => setTimeout(r, 600));
  const segunda = conv.create().id;
  return { primera, segunda };
});
// el menú de la pestaña de la primera: «Copiar enlace»
await p.locator(`#conv-tabs .tab[data-id="${ids.primera}"]`).click({ button: 'right' }).catch(async () => {
  await p.locator('#conv-tabs .tab').first().click({ button: 'right' });
});
await p.locator('#conv-menu [role="menuitem"]', { hasText: 'Copiar enlace' }).click();
await p.waitForTimeout(200);
const copiado = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
ok('1 · «Copiar enlace» copia #/conv/<id> de esa conversación', copiado.endsWith('#/conv/' + ids.primera), copiado);
await p.close();
p = await abre('#/conv/' + ids.primera);
await p.waitForTimeout(500);
const activa = await p.evaluate(() => window.elffussClaw.conv.getActive().id);
ok('1 · abrir ese enlace reabre esa conversación', activa === ids.primera, JSON.stringify({ activa, esperada: ids.primera }));
await p.close();
p = await abre('#/conv/cnoexiste1234');
await p.waitForTimeout(500);
ok('1 · un enlace a una conversación que ya no está lo dice', /ya no está/.test(await p.locator('#statusbar').textContent()), await p.locator('#statusbar').textContent());
await p.close();

// 2 · Mente, Ajustes y Lab
p = await abre('#/mind');
await p.waitForTimeout(800);
ok('2 · #/mind abre la Mente', await p.evaluate(() => { const o = document.getElementById('mind-overlay'); return !!o && getComputedStyle(o).display !== 'none'; }));
await p.close();
p = await abre('#/settings');
await p.waitForTimeout(500);
ok('2 · #/settings abre Ajustes', !(await p.locator('#settings-panel').isHidden()) && /Ajustes/.test(await p.locator('#settings-title').textContent()));

// 3 · fichas de modelos y documentación de proveedores (con Ajustes abierto)
await p.waitForTimeout(500);
const enlaces = await p.evaluate(() => ({
  fichas: [...document.querySelectorAll('.model-cards-links a')].map(a => ({ t: a.textContent, href: a.href, nombre: a.getAttribute('aria-label') })),
  docs: [...document.querySelectorAll('#settings-panel .prov-docs')].map(a => ({ href: a.href, nombre: a.getAttribute('aria-label') })),
}));
ok('3 · Ajustes enlaza la ficha del modelo ligero en Hugging Face', enlaces.fichas.some(f => f.href === 'https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX' && /Qwen3\.5-0\.8B/.test(f.nombre)), JSON.stringify(enlaces.fichas));
ok('3 · …y la documentación de la API de cada proveedor externo', enlaces.docs.some(d => /platform\.openai\.com/.test(d.href) && /OpenAI/.test(d.nombre)) && enlaces.docs.some(d => /docs\.anthropic\.com/.test(d.href)) && enlaces.docs.some(d => /ollama/.test(d.href)), JSON.stringify(enlaces.docs));

// 4 · huella SHA-256 de las descargas del bridge
await p.waitForSelector('.br-sha', { timeout: 5000 }).catch(() => {});
const huellas = await p.evaluate(() => [...document.querySelectorAll('.br-sha')].map(d => ({ f: d.dataset.file, h: d.querySelector('code')?.textContent })));
const esperado = new Map(SUMAS.split('\n').filter(Boolean).map(l => { const [h, f] = l.split(/\s+/); return [f, h]; }));
ok('4 · cada descarga del bridge enseña su SHA-256', huellas.length === esperado.size && huellas.every(x => esperado.get(x.f) === x.h), JSON.stringify(huellas.map(x => x.f)));
ok('4 · …y cómo comprobarlo, con el enlace a SHA256SUMS', await p.locator('.br-sha-how a[href="bridge-dl/SHA256SUMS"]').count() === 1);
await p.close();

p = await ctx.newPage();
await p.goto(BASE + '/#/lab', { waitUntil: 'domcontentloaded' });
await p.waitForURL(/lab\.html/, { timeout: 10000 }).catch(() => {});
ok('2 · #/lab lleva al banco de pruebas', /lab\.html$/.test(new URL(p.url()).pathname), p.url());
await p.close();

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ ENLACES: conversación, Mente, Ajustes y Lab; fichas, docs y huellas');
await b.close();
process.exit(fails ? 1 : 0);

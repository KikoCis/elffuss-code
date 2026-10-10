// La landing: sin píldora fantasma y sin fallos mudos.
//
//   1. Sin descarga a medias, la píldora «Reanudar / Descartar» NO se ve. Antes
//      `.resume-clone { display:flex }` le ganaba al atributo hidden y salía
//      siempre, vacía y con dos botones sin manejador (también en producción).
//   2. Con una descarga a medias sí sale, enlaza owner/repo al repositorio y
//      «Descartar» la quita.
//   3. Clonar: URL vacía o no reconocida se dice ANTES de abrir el selector de
//      carpeta (antes se elegía carpeta y luego fallaba, o no pasaba nada).
//   4. Abrir carpeta: cancelar el selector no es un error; cualquier otro fallo
//      se dice en la landing.
//   5. Sin File System Access (Firefox, Safari): los botones que no pueden
//      funcionar se desactivan con el motivo, y se ofrece probar en la carpeta
//      privada del navegador: una carpeta propia, donde no se ven ni se tocan
//      los pesos de los modelos (que viven en la raíz de ese almacenamiento).
// Nada sale a la red: el selector de carpetas va de mentira y nunca se llega a
// listar un repo.
//
//   BASE=http://127.0.0.1:8898 node tests/landing.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const errs = [];
const nueva = async ({ sinSelector = false } = {}) => {
  const ctx = await b.newContext({ locale: 'es-ES' });
  await ctx.addInitScript((sinSelector) => {
    try { localStorage.setItem('elffusscode.model', 'rules'); } catch {}
    if (sinSelector) { delete window.showDirectoryPicker; return; }
    window.__picker = { llamadas: 0, error: 'AbortError' };
    window.showDirectoryPicker = async () => { window.__picker.llamadas++; throw new DOMException('selector de prueba', window.__picker.error); };
  }, sinSelector);
  const p = await ctx.newPage({ viewport: { width: 1300, height: 850 } });
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  return { ctx, p };
};
const estado = (p) => p.evaluate(() => document.getElementById('clone-status').textContent);

// 1 · píldora oculta sin descarga a medias
let { ctx, p } = await nueva();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
const pildora = await p.evaluate(() => {
  const el = document.getElementById('resume-clone');
  return { display: getComputedStyle(el).display, visible: !!(el.offsetWidth || el.offsetHeight) };
});
ok('1 · sin descarga a medias, la píldora Reanudar/Descartar no se ve', pildora.display === 'none' && !pildora.visible, JSON.stringify(pildora));
ok('1 · …y sus botones no son paradas del tabulador', !(await p.locator('#resume-clone-btn').isVisible()) && !(await p.locator('#discard-clone-btn').isVisible()));

// 3 · clonar: validar antes del selector
await p.click('#clone-btn');
await p.waitForTimeout(150);
ok('3 · URL vacía: lo dice y no abre el selector', /Pega la URL/.test(await estado(p)) && await p.evaluate(() => window.__picker.llamadas) === 0, await estado(p));
await p.fill('#clone-url', 'esto no es un repo');
await p.press('#clone-url', 'Enter');
await p.waitForTimeout(200);
ok('3 · URL no reconocida: lo dice ANTES de abrir el selector', /URL no reconocida/.test(await estado(p)) && await p.evaluate(() => window.__picker.llamadas) === 0, await estado(p));
await p.fill('#clone-url', 'https://github.com/octo/demo');
await p.click('#clone-btn');
await p.waitForTimeout(200);
ok('3 · URL válida: abre el selector; cancelarlo no es un error', await p.evaluate(() => window.__picker.llamadas) === 1 && !/⚠️/.test(await estado(p)), await estado(p));

// 4 · abrir carpeta: cancelar calla, otro fallo se dice
await p.click('#open-project');
await p.waitForTimeout(150);
ok('4 · cancelar el selector de «Abrir carpeta» no muestra error', !/⚠️/.test(await estado(p)), await estado(p));
await p.evaluate(() => { window.__picker.error = 'SecurityError'; });
await p.click('#open-project');
await p.waitForTimeout(150);
ok('4 · cualquier otro fallo al abrir se dice en la landing', /No pude abrir la carpeta/.test(await estado(p)), await estado(p));

// 2 · con descarga a medias: píldora visible, enlace y Descartar
await p.evaluate(async () => {
  const db = await import('/js/db.js');
  const handle = await navigator.storage.getDirectory();
  await db.set('kv', 'cloneJob', { url: 'https://github.com/octo/demo', host: 'github', owner: 'octo', repo: 'demo', branch: 'main', handle, files: [{ path: 'a.txt' }, { path: 'b.txt' }], done: ['a.txt'], skipped: 0 });
});
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
const banner = await p.evaluate(() => {
  const el = document.getElementById('resume-clone');
  const a = el.querySelector('.rc-text a');
  return { visible: !!(el.offsetWidth || el.offsetHeight), texto: el.querySelector('.rc-text').textContent, href: a?.href, rel: a?.rel };
});
ok('2 · con una descarga a medias, la píldora sale con su progreso', banner.visible && /octo\/demo \(1\/2 ficheros\)/.test(banner.texto), JSON.stringify(banner));
ok('2 · owner/repo enlaza al repositorio', banner.href === 'https://github.com/octo/demo' && /noopener/.test(banner.rel), JSON.stringify(banner));
await p.click('#discard-clone-btn');
await p.waitForTimeout(200);
const trasDescartar = await p.evaluate(async () => {
  const db = await import('/js/db.js');
  return { visible: !!document.getElementById('resume-clone').offsetHeight, job: await db.get('kv', 'cloneJob') };
});
ok('2 · Descartar quita la píldora y olvida la descarga', !trasDescartar.visible && !trasDescartar.job, JSON.stringify(trasDescartar));
await ctx.close();

// 5 · navegador sin File System Access
({ ctx, p } = await nueva({ sinSelector: true }));
// pesos de modelo de mentira donde los guarda runtime/model-store.js: la raíz del OPFS
await p.goto(BASE + '/manifest.json');
await p.evaluate(async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models', { create: true });
  for (const n of ['abc123.bin', 'abc123.bin.done']) { const w = await (await dir.getFileHandle(n, { create: true })).createWritable(); await w.write('x'); await w.close(); }
});
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
const sinFS = await p.evaluate(() => ({
  abrir: document.getElementById('open-project').disabled, clonar: document.getElementById('clone-btn').disabled,
  motivo: document.getElementById('clone-status').textContent, probar: !document.getElementById('try-browser').hidden,
}));
ok('5 · sin File System Access: abrir y clonar desactivados, con el motivo', sinFS.abrir && sinFS.clonar && /Chrome o Edge/.test(sinFS.motivo), JSON.stringify(sinFS));
ok('5 · …y se ofrece probar en el navegador', sinFS.probar);
await p.click('#try-browser');
await p.waitForFunction(() => !document.getElementById('ide').hidden, null, { timeout: 30000 }).catch(() => {});
ok('5 · «Probar en el navegador» abre el IDE', await p.evaluate(() => !document.getElementById('ide').hidden));
await p.waitForTimeout(800);
const visto = await p.evaluate(async () => ({
  arbol: [...document.querySelectorAll('#tree [data-path]')].map(e => e.dataset.path),
  lista: await (await import('/js/tools/code.js')).tree({ path: '' }).catch(e => 'error: ' + e.message),
  ficheros: await (await import('/js/tools/code.js')).fileList().catch(e => 'error: ' + e.message),
}));
ok('5 · …en su propia carpeta: ni el explorador ni las herramientas ven los pesos de los modelos',
  !visto.arbol.some(x => /elffuss-models/.test(x)) && !/elffuss-models/.test(JSON.stringify([visto.lista, visto.ficheros])), JSON.stringify(visto));
ok('5 · …y los pesos siguen intactos', await p.evaluate(async () => {
  try { await (await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-models')).getFileHandle('abc123.bin'); return true; } catch { return false; }
}));
await ctx.close();

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ LANDING SIN PÍLDORA FANTASMA NI FALLOS MUDOS');
await b.close();
process.exit(fails ? 1 : 0);

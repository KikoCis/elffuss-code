// Los paths entre backticks en el chat deben poder abrirse directamente (sin
// tener que ir a buscarlos a mano), y NO confundirse con código real que
// también use backticks.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext(); await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('README.md', '# el fichero real que se abrirá');
  const dir = await o.getDirectoryHandle('.elffuss', { create: true }).then(d => d.getDirectoryHandle('soul', { create: true }));
  const f = await dir.getFileHandle('nota.md', { create: true }); const s = await f.createWritable(); await s.write('# nota real'); await s.close();
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

const addMsg = (cls, text) => p.evaluate(async ({ cls, text }) => {
  // addMsg no está exportado (closure de main.js): la disparamos vía el mismo
  // camino real que usa la app — reportImprovements, que SÍ está exportado y
  // hace addMsg con un path entre backticks, exactamente el caso real.
  const m = await import('/js/main.js');
  m.reportImprovements({ proposals: [{ dept: 'Arquitectura', text: 'Propuesta con sustancia suficiente para pasar el filtro de calidad, de verdad.' }, { dept: 'Calidad', text: 'Otra propuesta sólida y con contenido real para el segundo departamento.' }], path: text });
}, { cls, text });

await addMsg('assistant', 'README.md');
await p.waitForTimeout(300);
const link1 = p.locator('.msg.md code.file-link', { hasText: 'README.md' });
ok('el path entre backticks se convierte en enlace clicable', await link1.count() > 0);

// clic → abre el fichero REAL en el editor (Monaco)
await link1.first().click();
await p.waitForTimeout(600);
const tabText = await p.locator('#tabs-bar').innerText().catch(() => '');
ok('el clic abre el fichero REAL en una pestaña del editor', /README\.md/.test(tabText), tabText);
const editorContent = await p.evaluate(() => window.monaco?.editor.getModels().map(m => m.getValue()).join('|') || '');
ok('el contenido mostrado es el REAL del fichero', /el fichero real que se abrirá/.test(editorContent), editorContent.slice(0, 60));

// ruta con subcarpetas también debe funcionar
await addMsg('assistant', '.elffuss/soul/nota.md');
await p.waitForTimeout(300);
const link2 = p.locator('.msg.md code.file-link', { hasText: '.elffuss/soul/nota.md' });
ok('rutas con subcarpetas también se linkan', await link2.count() > 0);
await link2.first().click();
await p.waitForTimeout(600);
ok('abre el fichero real dentro de subcarpetas', /nota\.md/.test(await p.locator('#tabs-bar').innerText()));

// un código que NO es un path (JS de verdad) no debe volverse clicable ni romperse
const codeMsgOk = await p.evaluate(async () => {
  const m = await import('/js/main.js');
  m.reportImprovements({ proposals: [{ dept: 'Rendimiento', text: 'usa `const x = 1` en vez de var, y sustancia de sobra para el filtro' }, { dept: 'Producto/DX', text: 'otra propuesta con suficiente sustancia real para el segundo hueco' }], path: null });
  return true;
});
ok('reportImprovements con snippet de código no-path no rompe nada', codeMsgOk);
const nonFileLink = p.locator('.msg.md code', { hasText: 'const x = 1' });
ok('un snippet de código real NO se vuelve un file-link', await nonFileLink.evaluate(el => el.classList.contains('file-link')).catch(() => false) === false);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ PATHS CLICABLES EN EL CHAT OK');
await b.close();
process.exit(fails ? 1 : 0);

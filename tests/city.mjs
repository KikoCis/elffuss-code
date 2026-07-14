// Verifica la Ciudad 3D (motor VibeCodeViewer vendorizado): siembra un proyecto
// anidado, abre la vista, comprueba que el WebGL pinta la metrópolis y captura.
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1500, height: 900 } });
p.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) console.log('   pageerror:', e.message.slice(0, 160)); });
p.on('console', m => { if (m.type() === 'error' && !/allow-same-origin/.test(m.text())) console.log('   console.error:', m.text().slice(0, 160)); });

// proyecto anidado (varios distritos, edificios con plantas y ficheros)
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (path, txt) => { const parts = path.split('/'); const name = parts.pop(); let d = o; for (const x of parts) d = await d.getDirectoryHandle(x, { create: true }); const f = await d.getFileHandle(name, { create: true }); const s = await f.createWritable(); await s.write(txt); await s.close(); };
  const body = n => 'x'.repeat(200 + n * 137);
  await w('README.md', '# demo city\n' + body(3));
  await w('package.json', '{ "name": "demo" }');
  for (const [i, f] of ['index.js', 'app.js', 'router.js', 'store.js'].entries()) await w('src/' + f, body(i + 2));
  for (const [i, f] of ['Button.jsx', 'Modal.jsx', 'Nav.jsx'].entries()) await w('src/components/' + f, body(i + 1));
  for (const [i, f] of ['api.js', 'auth.js'].entries()) await w('src/services/' + f, body(i + 4));
  for (const [i, f] of ['helpers.js', 'format.js', 'dates.js'].entries()) await w('lib/' + f, body(i));
  for (const [i, f] of ['unit.test.js', 'e2e.test.js'].entries()) await w('tests/' + f, body(i + 1));
  await w('docs/guide.md', body(6));
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);

// abrir la Ciudad 3D
await p.click('#act-city');
await p.waitForTimeout(4500); // construir modelo + montar three + primeros frames

const head = await p.locator('#view-body .view-head').textContent().catch(() => '');
ok('cabecera de la ciudad presente', /distritos/.test(head), head.slice(0, 60));
const hasCanvas = await p.locator('#city-canvas').count();
ok('canvas de la ciudad montado', hasCanvas > 0);

// el motor real montó la escena (canvas con tamaño real + contexto WebGL vivo).
// El brillo de píxeles se valida por la CAPTURA (readPixels fuera del loop da
// negro por preserveDrawingBuffer:false, no es fiable aquí).
const glState = await p.evaluate(() => {
  const c = document.getElementById('city-canvas'); if (!c) return { ok: false };
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return { ok: !!gl, w: c.width, h: c.height, lost: gl ? gl.isContextLost() : true };
});
ok('canvas con tamaño real y contexto WebGL vivo', glState.ok && glState.w > 100 && glState.h > 100 && !glState.lost, JSON.stringify(glState));

// clic en el centro → debería abrir un fichero (raycast contra la ciudad)
await p.mouse.click(560, 400);
await p.waitForTimeout(600);

// captura recortada del lienzo: prueba visual de la metrópolis
const cnv = await p.locator('#city-canvas');
await cnv.screenshot({ path: OUT + '/city_vcc_canvas.png' }).catch(() => {});
await p.screenshot({ path: OUT + '/city_vcc.png' });
console.log('capturas → city_vcc.png, city_vcc_canvas.png');
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CIUDAD 3D (VibeCodeViewer) OK');
await b.close();
process.exit(fails ? 1 : 0);

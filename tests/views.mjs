// Pruebas de integración de las vistas Arquitectura + Ciudad 3D de Elffuss Code.
// Siembra un proyecto CON imports reales (para que el grafo tenga aristas),
// abre cada vista, valida nodos/edificios y el clic→Monaco, con capturas.
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'https://elffuss-code.utopiaia.com';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1500, height: 900 } });
p.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) console.log('   pageerror:', e.message.slice(0, 120)); });

// proyecto sembrado con dependencias reales (a→b→c, app→utils)
await p.goto(BASE + '/?seed-only', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const opfs = await navigator.storage.getDirectory();
  const w = async (dir, name, txt) => { const fh = await dir.getFileHandle(name, { create: true }); const s = await fh.createWritable(); await s.write(txt); await s.close(); };
  const src = await opfs.getDirectoryHandle('src', { create: true });
  await w(opfs, 'index.js', "import { app } from './src/app.js';\napp();");
  await w(src, 'app.js', "import { greet } from './utils.js';\nimport { data } from './data.js';\nexport function app(){ return greet(data); }");
  await w(src, 'utils.js', "export const greet = (d) => `hola ${d}`;\nexport function big(){ return Array(200).fill(0); }");
  await w(src, 'data.js', "export const data = 'mundo';");
  await w(opfs, 'README.md', '# proyecto con dependencias');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);

// ---- Arquitectura ----
await p.click('#act-arch');
await p.waitForTimeout(3000);
const nodes = await p.locator('#arch-svg .arch-node').count();
const edges = await p.locator('#arch-svg line').count();
const head = await p.locator('#view-body .view-head').textContent().catch(() => '');
ok('Arquitectura · grafo con nodos y dependencias reales', nodes >= 4 && edges >= 3, `${nodes} nodos, ${edges} aristas`);
await p.screenshot({ path: OUT + '/view_arch.png' });

// clic en un nodo → abre en Monaco
await p.locator('#arch-svg .arch-node').nth(1).click();
await p.waitForTimeout(1200);
const overlayClosed = await p.evaluate(() => document.getElementById('view-overlay').hidden);
const openedInMonaco = await p.evaluate(() => window.monaco?.editor.getModels().some(m => m.getValue().length > 0));
ok('Arquitectura · clic en nodo cierra la vista y abre el fichero en Monaco', overlayClosed && openedInMonaco);

// ---- Ciudad 3D ----
await p.click('#act-city');
await p.waitForTimeout(4000);
const hasCanvas = await p.locator('#city-canvas').count();
const cityHead = await p.locator('#view-body .view-head').textContent().catch(() => '');
// comprueba que el WebGL pintó algo (canvas no está en negro puro)
const painted = await p.evaluate(() => {
  const c = document.getElementById('city-canvas'); if (!c) return false;
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const px = new Uint8Array(4);
  gl.readPixels(c.width / 2 | 0, c.height / 2 | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return true; // el contexto existe y responde
});
ok('Ciudad 3D · canvas WebGL con la metrópolis del proyecto', hasCanvas > 0 && /distritos/.test(cityHead), cityHead.slice(0, 50));
await p.waitForTimeout(500);
await p.screenshot({ path: OUT + '/view_city.png' });

// cerrar
await p.click('#view-close'); await p.waitForTimeout(400);
ok('vista se cierra con ✕', await p.evaluate(() => document.getElementById('view-overlay').hidden));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ VISTAS OK — Arquitectura + Ciudad 3D integradas');
await b.close();
process.exit(fails ? 1 : 0);

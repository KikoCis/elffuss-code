// Las vistas 3D (Arquitectura y Ciudad) llevan al lado la lista de lo que
// pintan, para quien no puede (o no quiere) apuntar en un lienzo 3D: se busca
// escribiendo, se recorre con ↑/↓, Enter abre el fichero y ◎ lo enseña en la
// vista. Antes solo había el lienzo: con teclado o lector de pantalla no se
// podía llegar a ningún fichero desde ahí.
//
//   BASE=http://localhost:8799 node tests/view-list.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1500, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(BASE + '/manifest.json');
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (path, txt) => { const parts = path.split('/'); const name = parts.pop(); let d = o; for (const x of parts) d = await d.getDirectoryHandle(x, { create: true }); const f = await d.getFileHandle(name, { create: true }); const s = await f.createWritable(); await s.write(txt); await s.close(); };
  await w('index.js', "import {app} from './src/app.js';\napp();");
  await w('src/app.js', "import {greet} from './utils.js';\nexport const app=()=>greet('x');");
  await w('src/utils.js', "export const greet=d=>String(d);");
  await w('docs/notas.md', '# notas');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 20000 });

async function vista(boton, sel) {
  await p.click(boton);
  await p.waitForSelector('#view-body .view-list', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(300);
  return p.evaluate(s => ({
    hay: !!document.querySelector('#view-body .view-list'),
    nombre: document.querySelector('.view-list')?.getAttribute('aria-label'),
    filas: [...document.querySelectorAll('.view-list .vl-open')].map(b => b.dataset.path),
    cuenta: document.querySelector('.view-list .vl-count')?.textContent,
    lienzo: !!document.querySelector(s),
  }), sel);
}

// 1 · Arquitectura
let a = await vista('#act-arch', '#arch-graph canvas');
ok('1 · Arquitectura: junto al grafo, la lista de sus ficheros', a.hay && a.lienzo && JSON.stringify(a.filas) === '["index.js","src/app.js","src/utils.js"]', JSON.stringify(a));
const fila = await p.evaluate(() => { const b = document.querySelector('.view-list .vl-open[data-path="src/app.js"]'); return b?.getAttribute('aria-label'); });
ok('1 · …cada fila dice qué abre y sus conexiones', /^Abrir src\/app\.js · \d+ conexiones$/.test(fila || ''), fila);
await p.fill('.view-list .vl-filter', 'util');
await p.waitForTimeout(100);
const filtrado = await p.evaluate(() => ({ filas: [...document.querySelectorAll('.view-list .vl-open')].map(b => b.dataset.path), cuenta: document.querySelector('.view-list .vl-count').textContent }));
ok('1 · escribir filtra la lista y lo dice («1 de 3»)', JSON.stringify(filtrado.filas) === '["src/utils.js"]' && filtrado.cuenta === '1 de 3', JSON.stringify(filtrado));
await p.locator('.view-list .vl-locate').first().click();
await p.waitForTimeout(300);
ok('1 · ◎ lo enseña en la vista sin cerrarla', !(await p.locator('#view-overlay').isHidden()));
await p.focus('.view-list .vl-filter');
await p.keyboard.press('Enter');
await p.waitForSelector('#view-overlay[hidden]', { state: 'attached', timeout: 5000 }).catch(() => {});
await p.waitForTimeout(400);
const tab = await p.locator('#tabs-bar .tab.active').getAttribute('aria-label').catch(() => '');
ok('1 · Enter en el buscador abre el primero: la vista se cierra y el fichero queda abierto', await p.locator('#view-overlay').isHidden() && tab === 'utils.js', tab);

// 2 · Ciudad (todos los ficheros, no solo el código)
const c = await vista('#act-city', '#city-canvas');
ok('2 · Ciudad: la lista trae todos los ficheros del proyecto', c.hay && c.lienzo && c.filas.includes('docs/notas.md') && c.filas.includes('src/app.js'), JSON.stringify(c));
await p.focus('.view-list .vl-filter');
await p.keyboard.press('ArrowDown');
const primero = await p.evaluate(() => document.activeElement?.dataset?.path);
await p.keyboard.press('ArrowDown');
const segundo = await p.evaluate(() => document.activeElement?.dataset?.path);
await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp');
const vuelve = await p.evaluate(() => document.activeElement?.classList.contains('vl-filter'));
ok('2 · ↓ entra en la lista y la recorre; ↑ vuelve al buscador', !!primero && !!segundo && primero !== segundo && vuelve, JSON.stringify({ primero, segundo, vuelve }));
await p.locator('.view-list .vl-locate').first().click();
await p.waitForTimeout(300);
ok('2 · ◎ centra el edificio sin cerrar la vista', !(await p.locator('#view-overlay').isHidden()));
await p.locator('.view-list .vl-open[data-path="docs/notas.md"]').click();
await p.waitForTimeout(500);
const tab2 = await p.locator('#tabs-bar .tab.active').getAttribute('aria-label').catch(() => '');
ok('2 · clic en una fila abre ese fichero', await p.locator('#view-overlay').isHidden() && tab2 === 'notas.md', tab2);

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ VISTAS 3D CON LISTA: se buscan, se recorren y abren con el teclado');
await b.close();
process.exit(fails ? 1 : 0);

// El panel de Skills (el mismo sitio que Ajustes y Extensiones) ocupa entero su
// hueco y convive con la barra de actividad y el explorador.
//
//   1. Ocupa de la cabecera al pie de la ventana y del borde del explorador al
//      de la ventana. Antes era una persiana de la altura de su contenido: por
//      debajo asomaban el editor y el chat («no se abre al 100 %»).
//   2. Con Skills abierto, el icono de ficheros oculta y enseña el árbol, el
//      panel se ajusta al hueco y NO se cierra (antes el clic lo cerraba).
//   3. La barra de actividad marca Skills mientras está abierto, y pulsar otra
//      vez el icono lo cierra (antes lo cerraba y lo volvía a abrir). Lo mismo
//      con el engranaje: desde Skills abre Ajustes en vez de cerrar.
//   4. Al cambiar el tamaño de la ventana sigue lleno.
//   5. En el teléfono ocupa la pantalla bajo la cabecera, y el ☰ se abre encima
//      con Skills marcado.
//
//   BASE=http://127.0.0.1:8898 node tests/skills-panel-layout.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
async function abre(viewport, movil = false) {
  const ctx = await b.newContext({ locale: 'es-ES', viewport, isMobile: movil, hasTouch: movil });
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); localStorage.removeItem('elffusscode.chatfull'); } catch {} });
  await ctx.route(/soundcloud|huggingface|hf\.co|api\.github|raw\.githubusercontent/, r => r.abort());
  const p = await ctx.newPage();
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message.slice(0, 160)));
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 30000 });
  return { ctx, p };
}
const geo = p => p.evaluate(() => {
  const r = s => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  const panel = document.getElementById('settings-panel');
  return { vw: innerWidth, vh: innerHeight, abierto: !panel.hidden, kind: panel.dataset.kind, panel: panel.hidden ? null : r('#settings-panel'),
    cab: Math.round(document.querySelector('#ide header').getBoundingClientRect().bottom),
    arbol: getComputedStyle(document.getElementById('sidebar')).display !== 'none' ? r('#sidebar') : null,
    on: [...document.querySelectorAll('#activity button.on')].map(b => b.id) };
});
const llena = (g, izq) => g.panel && g.panel.y === g.cab && g.panel.b === g.vh && g.panel.r === g.vw && g.panel.x === izq;

// ── escritorio ──
for (const [w, h] of [[1280, 800], [1440, 900]]) {
  const { ctx, p } = await abre({ width: w, height: h });
  await p.click('#act-skills');
  await p.waitForTimeout(250);
  let g = await geo(p);
  ok(`${w} · 1 · Skills ocupa todo el hueco a la derecha del explorador`, llena(g, g.arbol?.r), JSON.stringify(g));
  ok(`${w} · 3 · la barra de actividad marca Skills (y el árbol, que sigue a la vista)`, g.on.includes('act-skills') && g.on.includes('act-files')
    && await p.getAttribute('#act-skills', 'aria-pressed') === 'true', JSON.stringify(g.on));
  await p.click('#act-files');
  await p.waitForTimeout(250);
  g = await geo(p);
  ok(`${w} · 2 · con Skills abierto, el icono de ficheros oculta el árbol y Skills sigue abierto`, g.abierto && g.kind === 'skills' && !g.arbol, JSON.stringify(g));
  ok(`${w} · 2 · …y el panel se ensancha hasta la barra de actividad`, llena(g, 46), JSON.stringify(g.panel));
  ok(`${w} · 2 · …y el icono de ficheros ya no está marcado`, !g.on.includes('act-files') && g.on.includes('act-skills'), JSON.stringify(g.on));
  await p.click('#act-files');
  await p.waitForTimeout(250);
  g = await geo(p);
  ok(`${w} · 2 · otra vez: vuelve el árbol y el panel se ajusta a su borde`, g.abierto && !!g.arbol && llena(g, g.arbol.r), JSON.stringify(g));
  await p.setViewportSize({ width: 960, height: 640 });
  await p.waitForTimeout(250);
  g = await geo(p);
  ok(`${w} · 4 · al cambiar el tamaño de la ventana sigue lleno`, llena(g, g.arbol?.r), JSON.stringify(g));
  await p.setViewportSize({ width: w, height: h });
  await p.click('#act-settings');
  await p.waitForTimeout(250);
  g = await geo(p);
  ok(`${w} · 3 · el engranaje, con Skills abierto, abre Ajustes`, g.abierto && g.kind === 'settings' && g.on.includes('act-settings') && !g.on.includes('act-skills'), JSON.stringify(g));
  await p.click('#act-skills');
  await p.waitForTimeout(250);
  await p.click('#act-skills');
  await p.waitForTimeout(250);
  g = await geo(p);
  ok(`${w} · 3 · pulsar otra vez Skills lo cierra y lo desmarca`, !g.abierto && !g.on.includes('act-skills') && await p.getAttribute('#act-skills', 'aria-pressed') === 'false', JSON.stringify(g));
  ok(`${w} · sin errores de página`, !p.errs.length, p.errs.join(' | '));
  await ctx.close();
}

// ── teléfono ──
{
  const { ctx, p } = await abre({ width: 390, height: 844 }, true);
  await p.tap('#btn-drawer');
  await p.waitForTimeout(200);
  await p.tap('#act-skills');
  await p.waitForTimeout(300);
  let g = await geo(p);
  ok('390 · 5 · Skills ocupa la pantalla entera bajo la cabecera', llena(g, 0), JSON.stringify(g));
  await p.tap('#btn-drawer');
  await p.waitForTimeout(250);
  g = await geo(p);
  ok('390 · 5 · el ☰ se abre encima sin cerrar Skills, y lo marca', g.abierto && g.kind === 'skills' && g.on.includes('act-skills')
    && await p.evaluate(() => document.body.classList.contains('drawer-open')), JSON.stringify(g));
  await p.tap('#act-skills');
  await p.waitForTimeout(250);
  g = await geo(p);
  ok('390 · 5 · y Skills en el cajón lo cierra (y cierra el cajón)', !g.abierto && !(await p.evaluate(() => document.body.classList.contains('drawer-open'))), JSON.stringify(g));
  ok('390 · sin errores de página', !p.errs.length, p.errs.join(' | '));
  await ctx.close();
}
await b.close();
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ panel de Skills: lleno y con la barra de actividad al día');
process.exit(fails ? 1 : 0);

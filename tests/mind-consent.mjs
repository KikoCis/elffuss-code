// La Mente: abrirla no enciende nada, y lo que se ve se puede pulsar.
//
//   1. Clic en la elfa: abre la Mente y NADA más. Antes el primer clic encendía
//      el cerebro autónomo en silencio y pedía permiso de notificaciones.
//   2. Sin modelo (modo Básico) el cerebro no piensa: «Pensar ahora» lo dice en
//      el panel y no se escribe nada en la carpeta-alma. Antes el motor de
//      reglas generaba «4 mejoras» con el texto de ayuda dentro del proyecto.
//   3. Las etiquetas de propuesta se pueden pulsar (antes pointer-events:none:
//      el clic se iba al lienzo) y son botones.
//   4. «Abrir en el editor» cierra la Mente antes (antes abría DETRÁS) y las
//      rutas de la propuesta abren su fichero.
//   5. La música no se carga sola: hay que pedirla, y se puede quitar.
// La red a SoundCloud va bloqueada: el test solo mira si la app la PIDE.
//
//   BASE=http://127.0.0.1:8898 node tests/mind-consent.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => {
  try { localStorage.setItem('elffusscode.model', 'rules'); } catch {}
  window.__permiso = 0;
  if (window.Notification) Notification.requestPermission = () => { window.__permiso++; return Promise.resolve('default'); };
});
const sc = [];
await ctx.route(/soundcloud/, r => { sc.push(r.request().url()); r.abort(); });
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));

await p.goto(BASE + '/manifest.json');
await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const escribe = async (path, txt) => {
    const parts = path.split('/'); const name = parts.pop(); let d = root;
    for (const x of parts) d = await d.getDirectoryHandle(x, { create: true });
    const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(txt); await w.close();
  };
  await escribe('src/app.js', 'export const a = 1;\n');
  await escribe('.elffuss/soul/2026-10-10-1200-prueba.md', '# Propuesta\n\nRevisa `src/app.js`.\n');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.monaco && document.querySelector('#tree [data-path]'), null, { timeout: 30000 });

// 1 · abrir la Mente
const esBoton = await p.evaluate(() => { const b = document.getElementById('act-mind'); return !!b && b.tagName === 'BUTTON' && !!b.getAttribute('aria-label'); });
ok('1 · la elfa es un botón con nombre accesible', esBoton);
await p.click('#act-mind');
await p.waitForSelector('#mind-overlay', { timeout: 45000 });
await p.waitForTimeout(800);
const r1 = await p.evaluate(async () => ({ on: (await import('/js/ceo.js')).isEnabled(), permiso: window.__permiso, boton: document.getElementById('mind-playstop').textContent }));
ok('1 · abrir la Mente NO enciende el cerebro', !r1.on && /activar/.test(r1.boton), JSON.stringify(r1));
ok('1 · …ni pide permiso de notificaciones', r1.permiso === 0, JSON.stringify(r1));
ok('5 · la música no se carga sola (ninguna petición a SoundCloud)', sc.length === 0, sc.join(' '));

// 2 · modo Básico: no piensa
await p.click('#mind-playstop');            // encenderlo a propósito
await p.click('#mind-config');
await p.click('#cfg-think-now');
await p.waitForTimeout(300);
const nota = await p.evaluate(() => document.getElementById('cfg-note')?.textContent || '');
ok('2 · «Pensar ahora» sin modelo lo dice en el panel', /Sin un modelo cargado/.test(nota), nota);
const r2 = await p.evaluate(async () => {
  const ceo = await import('/js/ceo.js');
  const forzado = await ceo.forceCycle();
  const root = await navigator.storage.getDirectory();
  const soul = await (await root.getDirectoryHandle('.elffuss')).getDirectoryHandle('soul');
  const nombres = []; for await (const e of soul.values()) nombres.push(e.name);
  return { forzado, nombres };
});
ok('2 · …y con el motor de reglas no se escribe ninguna propuesta', r2.forzado === false && r2.nombres.length === 1, JSON.stringify(r2));
await p.click('#cfg-x');

// 3 · etiqueta de propuesta pulsable
await p.waitForSelector('.mind-node-label', { timeout: 10000 });
const r3 = await p.evaluate(() => {
  const lab = [...document.querySelectorAll('.mind-node-label')].find(l => l.style.display !== 'none');
  const r = lab.getBoundingClientRect();
  const enPunto = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { boton: lab.tagName === 'BUTTON', recibeClic: enPunto === lab, aria: lab.getAttribute('aria-label') };
});
ok('3 · la etiqueta es un botón y recibe el clic (no el lienzo)', r3.boton && r3.recibeClic && /Abrir la propuesta/.test(r3.aria || ''), JSON.stringify(r3));
await p.evaluate(() => [...document.querySelectorAll('.mind-node-label')].find(l => l.style.display !== 'none').click());
await p.waitForSelector('#mind-panel.show');
const enlace = await p.evaluate(() => [...document.querySelectorAll('#mind-panel .mp-body a')].map(a => a.textContent));
ok('4 · las rutas de la propuesta son enlaces', enlace.includes('src/app.js'), JSON.stringify(enlace));

// 4 · Abrir en el editor: cierra la Mente y abre el fichero
await p.click('#mp-open');
await p.waitForTimeout(400);
const r4 = await p.evaluate(() => ({
  mente: getComputedStyle(document.getElementById('mind-overlay')).display,
  activa: document.querySelector('#tabs-bar .tab.active')?.dataset.path,
}));
ok('4 · «Abrir en el editor» cierra la Mente y abre la propuesta', r4.mente === 'none' && /prueba\.md$/.test(r4.activa || ''), JSON.stringify(r4));
await p.click('#act-mind');
await p.waitForTimeout(500);
await p.evaluate(() => [...document.querySelectorAll('.mind-node-label')].find(l => l.style.display !== 'none').click());
await p.waitForSelector('#mind-panel.show');
await p.locator('#mind-panel .mp-body a', { hasText: 'src/app.js' }).click();
await p.waitForTimeout(400);
const r4b = await p.evaluate(() => ({ mente: getComputedStyle(document.getElementById('mind-overlay')).display, activa: document.querySelector('#tabs-bar .tab.active')?.dataset.path }));
ok('4 · una ruta de la propuesta cierra la Mente y abre ese fichero', r4b.mente === 'none' && r4b.activa === 'src/app.js', JSON.stringify(r4b));

// 5 · la música, solo si se pide, y se puede quitar
await p.click('#act-mind');
await p.waitForTimeout(400);
await p.click('.mind-music-btn');
await p.waitForTimeout(300);
const conMusica = await p.evaluate(() => !!document.getElementById('mind-sc'));
await p.click('.mind-music-btn');
await p.waitForTimeout(200);
const sinMusica = await p.evaluate(() => !document.getElementById('mind-sc'));
ok('5 · «Poner música» carga el reproductor y «Quitar música» lo elimina', conMusica && sinMusica && sc.length > 0, `${conMusica} ${sinMusica} ${sc.length}`);
const leyenda = await p.evaluate(() => [...document.querySelectorAll('#mind-legend .ml-item')].every(x => x.tagName === 'BUTTON'));
ok('3 · la leyenda de perfiles son botones (teclado)', leyenda);

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ LA MENTE PIDE PERMISO Y SE DEJA PULSAR');
await b.close();
process.exit(fails ? 1 : 0);

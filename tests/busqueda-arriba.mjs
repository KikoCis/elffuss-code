// La búsqueda vive fija en la cabecera (como el «command center» de VS Code) y
// no detrás de una lupa en la barra lateral. Pulsarla o escribir en ella abre
// la paleta justo debajo.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const errs = [];
async function abre(width) {
  const ctx = await b.newContext({ viewport: { width, height: 800 }, locale: 'es-ES' });
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.goto(BASE + '/?test-opfs');
  await p.waitForFunction(() => !!document.querySelector('#editor .monaco-editor'), null, { timeout: 30000 });
  await p.waitForTimeout(400);
  return { ctx, p };
}
const paleta = p => p.evaluate(() => ({ abierta: !document.getElementById('palette').hidden, texto: document.getElementById('pal-input').value }));

{
  const { ctx, p } = await abre(1280);
  ok('la lupa de la barra lateral ya no existe', !(await p.$('#act-search')));
  const r = await p.evaluate(() => { const s = document.getElementById('top-search'); const box = s?.getBoundingClientRect(); return { enCabecera: !!s?.closest('header'), visible: !!box?.width, texto: s?.querySelector('.ts-txt')?.textContent, kbd: s?.querySelector('.ts-kbd')?.textContent }; });
  ok('la búsqueda está fija en la cabecera, a la vista', r.enCabecera && r.visible, JSON.stringify(r));
  ok('…dice qué busca y su atajo', /Buscar archivos/.test(r.texto || '') && /P$/.test(r.kbd || ''), JSON.stringify(r));
  ok('⊕ control: antes de tocarla, la paleta está cerrada', !(await paleta(p)).abierta);
  await p.click('#top-search');
  await p.waitForTimeout(250);
  ok('pulsarla abre la paleta (y se queda abierta)', (await paleta(p)).abierta);
  const debajo = await p.evaluate(() => { const s = document.getElementById('top-search').getBoundingClientRect(), q = document.getElementById('palette').getBoundingClientRect(); return { centroBarra: Math.round(s.left + s.width / 2), centroPaleta: Math.round(q.left + q.width / 2), barraAbajo: Math.round(s.bottom), paletaArriba: Math.round(q.top) }; });
  ok('…justo debajo de la barra y con su mismo centro', Math.abs(debajo.centroBarra - debajo.centroPaleta) <= 2 && debajo.paletaArriba >= debajo.barraAbajo && debajo.paletaArriba - debajo.barraAbajo <= 12, JSON.stringify(debajo));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  await p.focus('#top-search');
  await p.keyboard.press('a');
  await p.waitForTimeout(250);
  const t = await paleta(p);
  ok('con el foco en ella, escribir ya busca (la letra pasa a la paleta)', t.abierta && t.texto === 'a', JSON.stringify(t));
  await ctx.close();
}
{
  const { ctx, p } = await abre(390);
  const r = await p.evaluate(() => { const s = document.getElementById('top-search'); const box = s.getBoundingClientRect(); return { visible: box.width > 0, ancho: Math.round(box.width), texto: getComputedStyle(s.querySelector('.ts-txt')).display, scrollX: document.documentElement.scrollWidth > innerWidth }; });
  ok('en el móvil queda como icono y sin desbordar la cabecera', r.visible && r.texto === 'none' && !r.scrollX, JSON.stringify(r));
  await p.click('#top-search');
  await p.waitForTimeout(250);
  ok('…y también abre la paleta', (await paleta(p)).abierta);
  await ctx.close();
}
ok('sin errores de página', !errs.length, errs.join(' | '));
await b.close();
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\nTodo en verde');
process.exit(fails ? 1 : 0);

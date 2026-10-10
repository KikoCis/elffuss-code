// Cerrar o borrar la conversación ACTIVA: el chat tiene que pasar a la que
// queda activa, y lo siguiente que escribas tiene que ir a la que ves.
//
// Antes closeTab() y remove() avisaban con 'tabs' en vez de 'switch': la barra
// de pestañas cambiaba, pero el chat seguía enseñando la conversación cerrada y
// el siguiente mensaje iba a parar a otra que no estaba en pantalla. Y borrar
// una conversación que estaba trabajando la resucitaba en la Historial cuando
// su turno terminaba.
//
//   BASE=http://127.0.0.1:8898 node tests/convclose.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 15000 });

const libre = () => p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 10000 });
const escribe = async (txt) => { await p.fill('#prompt', txt); await p.press('#prompt', 'Enter'); await p.waitForTimeout(100); await libre(); };
const activa = () => p.evaluate(() => window.elffussClaw.conv.getActive().id);
const log = () => p.evaluate(() => document.getElementById('chat-log').innerText);
// la × de la pestaña activa (sea <b> o <button>)
const cierraActiva = () => p.locator('#conv-tabs .tab.active').locator('.tab-x, b').first().dispatchEvent('click');

await escribe('mensaje de la uno');
const uno = await activa();
await p.locator('#conv-tabs .tab-add').dispatchEvent('click');
await p.waitForTimeout(150);
await escribe('mensaje de la dos');
const dos = await activa();
ok('dos conversaciones distintas', uno !== dos, `${uno} / ${dos}`);

// 1 · cerrar la pestaña activa
await cierraActiva();
await p.waitForTimeout(200);
const tras1 = { activa: await activa(), log: await log() };
ok('1 · al cerrar la activa, pasa a ser activa la otra', tras1.activa === uno, tras1.activa);
ok('1 · el chat enseña la conversación que queda activa', tras1.log.includes('mensaje de la uno') && !tras1.log.includes('mensaje de la dos'), tras1.log.slice(0, 200));
await escribe('sigo en la uno');
const h1 = await p.evaluate((id) => window.elffussClaw.conv.getActive().id === id && window.elffussClaw.conv.getActive().agent.history.some(m => m.content === 'sigo en la uno'), uno);
ok('1 · lo siguiente que escribes va a la conversación que ves', h1);

// 2 · borrar desde la Historial la conversación activa
await p.click('#btn-history');
await p.waitForSelector('#history-panel .hp-row');
// reabrir la dos desde la Historial (pasa a ser la activa)
await p.evaluate((id) => window.elffussClaw.conv.open(id), dos);
await p.waitForTimeout(150);
ok('2 · la dos vuelve a estar activa', (await activa()) === dos);
await p.evaluate(() => { window.confirm = () => true; });
await p.evaluate(async () => {
  const panel = document.getElementById('history-panel');
  if (panel.hidden) document.getElementById('btn-history').click();
});
await p.waitForSelector('#history-panel .hp-row');
await p.evaluate((id) => {
  const conv = window.elffussClaw.conv;
  const titulo = conv.titleFor(conv.getActive());
  const fila = [...document.querySelectorAll('#history-panel .hp-row')].find(r => r.querySelector('.hp-title')?.textContent === titulo);
  fila.querySelector('.hp-del').click();
}, dos);
await p.waitForTimeout(400);
const tras2 = { activa: await activa(), log: await log() };
ok('2 · tras borrar la activa, la activa es otra', tras2.activa !== dos, tras2.activa);
ok('2 · y el chat enseña esa otra, no la borrada', !tras2.log.includes('mensaje de la dos') && tras2.log.includes('mensaje de la uno'), tras2.log.slice(0, 200));

// 3 · borrar una conversación MIENTRAS trabaja no la resucita al terminar su turno
const r3 = await p.evaluate(async () => {
  const conv = window.elffussClaw.conv;
  const db = await import('/js/db.js');
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  const lento = { chat: async (h, s, cb, signal) => {
    for (let i = 0; i < 30; i++) { if (signal?.aborted) throw new DOMException('Parado', 'AbortError'); cb('·'); await dormir(30); }
    return 'terminé';
  } };
  conv.setProvider(lento);
  const c = conv.create();
  conv.send(c.id, 'trabajo que se borra');
  for (let i = 0; i < 40 && !c.pumping; i++) await dormir(20);
  await conv.remove(c.id);
  for (let i = 0; i < 100 && c.pumping; i++) await dormir(30);
  await dormir(300);
  const guardadas = await db.get('kv', 'conversations');
  return { resucita: guardadas.some(x => x.id === c.id), sigue: c.pumping };
});
ok('3 · borrada mientras trabajaba: no vuelve a aparecer en IndexedDB', !r3.resucita && !r3.sigue, JSON.stringify(r3));

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CERRAR/BORRAR LA CONVERSACIÓN ACTIVA OK');
await b.close();
process.exit(fails ? 1 : 0);

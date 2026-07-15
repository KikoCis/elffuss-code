// Conversaciones: varias pestañas en paralelo + Historial (reemplaza el
// viejo botón "Nueva/eliminar" que borraba todo sin dejar rastro).
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

ok('arranca con exactamente 1 pestaña', await p.locator('#conv-tabs .tab').count() === 1);

// tab 1: manda un mensaje
await p.fill('#prompt', 'mensaje uno');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(400);
ok('mensaje uno aparece en el chat', (await p.locator('#chat-log').innerText()).includes('mensaje uno'));

// + nueva pestaña
await p.click('#conv-tabs .tab-add');
await p.waitForTimeout(200);
ok('ahora hay 2 pestañas', await p.locator('#conv-tabs .tab').count() === 2);
ok('la pestaña nueva está vacía (no ve el mensaje de la 1)', !(await p.locator('#chat-log').innerText()).includes('mensaje uno'));

// tab 2: manda otro mensaje
await p.fill('#prompt', 'mensaje dos');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(400);
ok('mensaje dos aparece en la pestaña 2', (await p.locator('#chat-log').innerText()).includes('mensaje dos'));

// volver a la pestaña 1: debe ver SOLO su propio mensaje
await p.click('#conv-tabs .tab:not(.active)');
await p.waitForTimeout(200);
const log1 = await p.locator('#chat-log').innerText();
ok('al volver a la pestaña 1, ve «mensaje uno»', log1.includes('mensaje uno'));
ok('la pestaña 1 NO ve «mensaje dos» (historiales independientes)', !log1.includes('mensaje dos'));

// volver a la 2: debe ver SOLO su mensaje
await p.click('#conv-tabs .tab:not(.active)');
await p.waitForTimeout(200);
const log2 = await p.locator('#chat-log').innerText();
ok('al volver a la pestaña 2, ve «mensaje dos»', log2.includes('mensaje dos'));
ok('la pestaña 2 NO ve «mensaje uno»', !log2.includes('mensaje uno'));

// ---- procesamiento en paralelo: mandar en una mientras la otra piensa ----
await p.evaluate(() => {
  window.elffussClaw.conv.setProvider({
    chat: async (h, s, onToken) => { await new Promise(r => setTimeout(r, 1500)); onToken('lista'); return 'lista'; },
  });
});
// estamos en la pestaña 2; mandamos ahí y sin esperar cambiamos a la 1 y mandamos también
await p.fill('#prompt', 'lenta dos');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(150);
await p.click('#conv-tabs .tab:not(.active)'); // a la 1
await p.waitForTimeout(150);
ok('la pestaña 2 (en 2º plano, procesando) se marca ocupada', await p.locator('#conv-tabs .tab.tab-busy').count() >= 1);
await p.fill('#prompt', 'lenta uno');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(200);
ok('la pestaña activa (1) también entra en cola sin bloquearse por la 2', (await p.locator('#chat-log').innerText()).includes('lenta uno'));
await p.waitForTimeout(3500); // suficiente para que el cerrojo de inferencia procese ambas
const log1b = await p.locator('#chat-log').innerText();
ok('la pestaña 1 recibió su respuesta real («lista»)', /lista/.test(log1b));
await p.click('#conv-tabs .tab:not(.active)');
await p.waitForTimeout(200);
const log2b = await p.locator('#chat-log').innerText();
ok('la pestaña 2 (que procesaba en 2º plano) también recibió su respuesta', /lista/.test(log2b));
ok('ninguna pestaña se queda "ocupada" para siempre', await p.locator('#conv-tabs .tab.tab-busy').count() === 0);

// ---- cerrar pestaña NO borra: sigue en el Historial ----
const tabCountBeforeClose = await p.locator('#conv-tabs .tab').count();
const activeTitleBeforeClose = await p.locator('#conv-tabs .tab.active .tab-name').innerText();
await p.locator('#conv-tabs .tab.active b').click();
await p.waitForTimeout(200);
ok('cerrar la pestaña activa la quita de la vista', await p.locator('#conv-tabs .tab').count() === tabCountBeforeClose - 1);

await p.click('#btn-history');
await p.waitForTimeout(200);
const hpRows = await p.locator('.hp-row .hp-title').allInnerTexts();
ok('el Historial lista AMBAS conversaciones (la cerrada no se perdió)', hpRows.length === 2, hpRows.join(' | '));

// reabrir la que se cerró (identificada por título, no la que ya está abierta)
await p.click(`.hp-row:has-text("${activeTitleBeforeClose}")`);
await p.waitForTimeout(300);
ok('reabrir desde el Historial la vuelve a poner como pestaña', await p.locator('#conv-tabs .tab').count() === tabCountBeforeClose);

// eliminar de verdad desde el Historial (la OTRA conversación, no la activa)
await p.click('#btn-history');
await p.waitForTimeout(200);
await p.evaluate(() => window.confirm = () => true); // acepta el confirm() nativo
await p.click(`.hp-row:not(:has-text("${activeTitleBeforeClose}")) .hp-del`);
await p.waitForTimeout(300);
const hpRowsAfter = await p.locator('.hp-row .hp-title').count();
ok('eliminar desde el Historial SÍ borra de verdad', hpRowsAfter === 1);

await p.screenshot({ path: OUT + '/conv_tabs.png' });

// ---- persistencia real tras recargar ----
await p.click('body'); // cierra paneles abiertos
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
const tabsAfterReload = await p.locator('#conv-tabs .tab').count();
ok('tras recargar, las pestañas abiertas se restauran', tabsAfterReload >= 1, String(tabsAfterReload));
const logAfterReload = await p.locator('#chat-log').innerText();
ok('el contenido de la conversación activa sobrevive a recargar', /mensaje (uno|dos)|lenta (uno|dos)/.test(logAfterReload), logAfterReload.slice(0, 80));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CONVERSACIONES EN PARALELO + HISTORIAL OK');
await b.close();
process.exit(fails ? 1 : 0);

// Verifica el bug real encontrado: el informe del cerebro CEO ahora se
// guarda en el historial de verdad (antes solo vivía en el DOM y
// desaparecía al cambiar de pestaña) + que el ciclo del CEO no deja
// "pumping"/"running" colgado para siempre (lo que bloquearía tanto al
// propio cerebro como al chat normal).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
const errors = [];
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

// fuerza un ciclo del CEO con un proveedor falso rápido — SIN pisar
// onEvent: main.js ya lo dejó enganchado a reportImprovements() al arrancar,
// que es justo lo que queremos probar (igual que hace mind_stars.mjs).
const cycleResult = await p.evaluate(async () => {
  const ceo = await import('/js/ceo.js');
  ceo.init({
    provider: () => ({ chat: async (h, s, cb) => { cb('ok'); return 'Propuesta de prueba con contenido suficientemente largo para contar como sustanciosa de verdad.'; } }),
    isBusy: () => false,
  });
  const t0 = Date.now();
  while (!ceo.isThisTabLeader() && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 100));
  const ran = await ceo.forceCycle();
  return { ran, runningAfter: ceo.isRunning() };
});
ok('el ciclo del CEO se ejecuta', cycleResult.ran, JSON.stringify(cycleResult));
ok('tras terminar, running() vuelve a false (no se queda colgado)', cycleResult.runningAfter === false);
await p.waitForTimeout(400);

const chatBefore = await p.locator('#chat-log').innerText();
ok('la propuesta del CEO aparece en el chat', /💡.*revisé el proyecto/.test(chatBefore), chatBefore.slice(-200));

// cambia de pestaña (fuerza un renderActiveLog() completo) y vuelve
await p.click('#conv-tabs .tab-add');
await p.waitForTimeout(200);
await p.click('#conv-tabs .tab:not(.active)');
await p.waitForTimeout(200);
const chatAfterSwitch = await p.locator('#chat-log').innerText();
ok('tras cambiar de pestaña, la propuesta del CEO SIGUE ahí (persistida de verdad)', /💡.*revisé el proyecto/.test(chatAfterSwitch), chatAfterSwitch.slice(-200));

// tras el ciclo del CEO, el chat normal SIGUE funcionando (no se ha "parado")
await p.fill('#prompt', 'sigue funcionando el chat?');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(500);
const chatFinal = await p.locator('#chat-log').innerText();
ok('el chat normal sigue respondiendo tras el ciclo del CEO', chatFinal.includes('sigue funcionando el chat?'));
ok('sin errores de consola en todo el flujo', errors.length === 0, errors.slice(0, 5).join(' | '));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CEO: SIN CUELGUES + PROPUESTA PERSISTIDA DE VERDAD');
await b.close();
process.exit(fails ? 1 : 0);

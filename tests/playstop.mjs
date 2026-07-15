// Play/stop del cerebro CEO dentro de la Mente: pausa/reanuda, y la elección
// sobrevive a recargar la página de verdad (antes no había forma de pararlo
// desde la Mente, y nada se persistía salvo el "encendido" desde la elfa).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext(); await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

// clic en la elfa activa el cerebro (comportamiento ya existente)
await p.locator('#activity img').click(); await p.waitForTimeout(1000);
ok('al entrar por primera vez, el botón dice "pausar" (el cerebro quedó activo)', /pausar/.test(await p.locator('#mind-playstop').innerText()));
const en1 = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('ceo.isEnabled() es true tras el primer clic en la elfa', en1);

// pausar desde la Mente
await p.click('#mind-playstop'); await p.waitForTimeout(200);
ok('tras pulsar, el botón pasa a "reanudar" (pausado)', /reanudar/.test(await p.locator('#mind-playstop').innerText()));
ok('el botón se ve marcado como pausado (estilo distinto)', await p.locator('#mind-playstop').evaluate(el => el.classList.contains('paused')));
const en2 = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('ceo.isEnabled() es false tras pausar', !en2);

// RECARGA REAL: la elección (pausado) debe sobrevivir
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
const enAfterReload = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('tras recargar, sigue PAUSADO (la elección se guardó)', !enAfterReload);

// reabrir la Mente NO debe reactivarlo por sorpresa (lo pausaste a propósito)
await p.locator('#activity img').click(); await p.waitForTimeout(1000);
ok('al reabrir la Mente tras una pausa explícita, SIGUE pausado (no se pisa la elección)', /reanudar/.test(await p.locator('#mind-playstop').innerText()));
const stillPaused = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('ceo.isEnabled() confirma que reabrir la Mente no lo reactivó', !stillPaused);

// reanudarlo EXPLÍCITAMENTE con el play/stop, y comprobar que ESO persiste
await p.click('#mind-playstop'); await p.waitForTimeout(200);
ok('reanudado a propósito desde la Mente, el botón dice "pausar"', /pausar/.test(await p.locator('#mind-playstop').innerText()));
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
const enAfterReload2 = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('tras recargar de nuevo, sigue ACTIVO (también se guardó al reanudar)', enAfterReload2);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ PLAY/STOP DEL CEREBRO OK — persiste de verdad entre recargas');
await b.close();
process.exit(fails ? 1 : 0);

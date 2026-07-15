// Feedback claro al enviar (antes el botón siempre se veía igual, sin
// distinguir enviado/pensando) + Enter explícito tras recuperar del
// historial con ↑ (antes dependía del submit-on-Enter nativo del <form>).
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

// proveedor lento para poder observar el estado "enviando"
await p.evaluate(() => {
  window.elffussClaw.agent.provider = {
    chat: async (h, s, onToken) => { await new Promise(r => setTimeout(r, 1200)); onToken('ok'); return 'ok'; },
  };
});

ok('el botón de enviar empieza normal (sin "sending")', !(await p.locator('#btn-send').evaluate(el => el.classList.contains('sending'))));
await p.fill('#prompt', 'hola');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(150);
ok('el botón de enviar muestra estado "pensando" (clase sending + disabled)', await p.locator('#btn-send').evaluate(el => el.classList.contains('sending') && el.disabled));
await p.waitForTimeout(1500);
ok('al terminar, el botón vuelve a su estado normal', await p.locator('#btn-send').evaluate(el => !el.classList.contains('sending') && !el.disabled));

// historial con ArrowUp + Enter EXPLÍCITO (requestSubmit, no submit nativo)
await p.click('#prompt');
await p.press('#prompt', 'ArrowUp');
await p.waitForTimeout(80);
const recalled = await p.inputValue('#prompt');
ok('ArrowUp recupera el último mensaje', recalled === 'hola', recalled);
await p.press('#prompt', 'Enter');
await p.waitForTimeout(150);
ok('Enter tras ArrowUp limpia el input (se mandó)', (await p.inputValue('#prompt')) === '');
ok('Enter tras ArrowUp SÍ manda directamente (2 mensajes de usuario)', await p.locator('.msg.user').count() === 2);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ FEEDBACK DE ENVÍO + HISTORIAL→ENTER OK');
await b.close();
process.exit(fails ? 1 : 0);

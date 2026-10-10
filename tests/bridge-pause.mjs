// «Desconectar» el bridge aguanta una recarga.
//
// Ajustes dice «No se volverá a conectar solo hasta que pulses Conectar», pero
// la pausa vivía solo en memoria: al recargar, tryAutoConnect() volvía a
// conectar con el token guardado. Ahora la pausa se guarda y «Conectar» la quita.
//
// Sin bridge de verdad: se cuentan los WebSocket que la página intenta abrir
// (contra 127.0.0.1:8765 no contesta nadie, y no hace falta).
//
//   BASE=http://127.0.0.1:8898 node tests/bridge-pause.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('elffusscode.model', 'rules');
    if (!sessionStorage.getItem('sembrado')) { localStorage.setItem('elffusscode.bridgeToken', 'tok-de-prueba'); sessionStorage.setItem('sembrado', '1'); }
  } catch {}
  window.__ws = 0;
  const W = window.WebSocket;
  window.WebSocket = function (...a) { window.__ws++; return new W(...a); };
  window.WebSocket.prototype = W.prototype;
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
const listo = () => p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 15000 });

await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await listo();
await p.waitForTimeout(800);
ok('con un token guardado, al abrir intenta conectar solo', await p.evaluate(() => window.__ws) >= 1, String(await p.evaluate(() => window.__ws)));

await p.evaluate(async () => (await import('/js/bridge.js')).disconnect());
ok('«Desconectar» se guarda', await p.evaluate(() => localStorage.getItem('elffusscode.bridgePaused')) === '1');

await p.reload({ waitUntil: 'domcontentloaded' });
await listo();
await p.waitForTimeout(1500);
const tras = await p.evaluate(async () => ({ ws: window.__ws, conectado: (await import('/js/bridge.js')).isConnected(), auto: await (await import('/js/bridge.js')).tryAutoConnect() }));
ok('tras recargar NO vuelve a conectar solo (ni lo intenta)', tras.ws === 0 && !tras.conectado && tras.auto === false, JSON.stringify(tras));

await p.evaluate(async () => { await (await import('/js/bridge.js')).connect('tok-de-prueba').catch(() => {}); });
ok('«Conectar» quita la pausa', await p.evaluate(() => localStorage.getItem('elffusscode.bridgePaused')) === null);

ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ BRIDGE: «Desconectar» aguanta una recarga');
await b.close();
process.exit(fails ? 1 : 0);

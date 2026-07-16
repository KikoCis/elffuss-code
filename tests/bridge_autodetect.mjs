// El Bridge local ahora se auto-detecta/reconecta en 2º plano (bridge.js:
// startAutoDetect) en vez de exigir reabrir Ajustes y pulsar «Conectar» cada
// vez que el proceso local se reinicia. Aquí lo comprobamos contra un Bridge
// REAL ya arrancado en esta máquina (127.0.0.1:8765).
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
const TOKEN = process.env.BRIDGE_TOKEN;
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

if (!TOKEN) { console.log('❌ falta BRIDGE_TOKEN en el entorno (token real impreso por el binario)'); process.exit(1); }

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
p.on('console', m => { if (/error/i.test(m.type()) && !/favicon/.test(m.text())) console.log('  [console]', m.text()); });
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// 1) primera conexión manual (flujo existente, sin regresión)
await p.evaluate(async (token) => {
  const bridge = await import('/js/bridge.js');
  await bridge.connect(token);
}, TOKEN);
await p.waitForTimeout(300);
const connected1 = await p.evaluate(async () => (await import('/js/bridge.js')).isConnected());
ok('conexión manual inicial funciona', connected1 === true);

// 2) recarga: tryAutoConnect() con el token guardado debe reconectar solo
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2000);
const connected2 = await p.evaluate(async () => (await import('/js/bridge.js')).isConnected());
ok('tras recargar, tryAutoConnect() reconecta con el token guardado', connected2 === true);

// 3) simular una caída (bridge.disconnect() en el cliente, el proceso REAL
//    sigue vivo) y comprobar que startAutoDetect() lo reconecta solo, sin
//    tocar nada — antes de este cambio esto se quedaba «desconectado» para
//    siempre hasta que el usuario reabriera Ajustes y pulsara Conectar.
await p.evaluate(async () => {
  const bridge = await import('/js/bridge.js');
  bridge.disconnect();
});
const disconnectedNow = await p.evaluate(async () => (await import('/js/bridge.js')).isConnected());
ok('bridge.disconnect() desconecta de verdad', disconnectedNow === false);

await p.waitForTimeout(6000); // startAutoDetect sondea cada 4s
const reconnected = await p.evaluate(async () => (await import('/js/bridge.js')).isConnected());
ok('tras una caída, startAutoDetect() reconecta SOLO en segundo plano (sin acción del usuario)', reconnected === true);

// 4) el panel de Ajustes refleja el estado reactivamente (onStatusChange)
await p.click('#btn-settings');
await p.waitForTimeout(300);
const dotClass = await p.locator('#br-dot').getAttribute('class');
ok('el panel de Ajustes muestra "conectado" sin que el usuario haga nada', /on/.test(dotClass || ''), dotClass);

// 5) comando real vía el bridge desde el propio shell (regresión end-to-end)
const out = await p.evaluate(async () => {
  const shell = await import('/js/shell.js');
  return shell.runForAgent ? await shell.runForAgent('node --version') : null;
});
ok('terminal.run("node --version") ejecuta de verdad vía Bridge', typeof out === 'string' && /v\d+\.\d+\.\d+/.test(out), out);

await p.screenshot({ path: OUT + '/bridge_autodetect.png' });
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ BRIDGE: AUTO-DETECCIÓN/RECONEXIÓN EN 2º PLANO FUNCIONA');
await b.close();
process.exit(fails ? 1 : 0);

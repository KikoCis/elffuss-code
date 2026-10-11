// El bridge viejo se nota, y la ayuda del bridge dice lo que hay.
//
// Desde la 1.1.2 parar un comando mata también lo que arrancó (npm scripts,
// servidores, «a; b»). Con una anterior la web da el comando por parado (130)
// pero el proceso sigue vivo, y nadie lo decía: la web no miraba la versión que
// el bridge da en /ping. Ahora, conectado a uno anterior a la 1.1.2, Ajustes lo
// dice (y la barra de estado, una vez). Y dos textos que se habían quedado
// viejos: «descárgalo otra vez (versión 1.1.1)» y «carpeta vacía = una
// temporal» (desde f594431 es la carpeta desde la que arrancó el bridge).
//
// Sin bridge de verdad: /ping lo contesta page.route y el WebSocket es un doble
// en la página que acepta el token.
//
//   BASE=http://localhost:8799 node tests/bridge-version.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const errs = [];
async function conBridge(version, locale = 'es-ES') {
  const ctx = await b.newContext({ locale });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* */ }
    // Un bridge de mentira: abre, acepta el token y no ejecuta nada.
    window.WebSocket = class {
      constructor(url) { this.url = url; setTimeout(() => this.onopen?.(), 10); }
      send(d) { const m = JSON.parse(d); if (m.type === 'auth') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'auth-ok' }) }), 10); }
      close() { setTimeout(() => this.onclose?.(), 0); }
    };
  });
  const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.route('http://127.0.0.1:8765/ping', r => r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, version }) }));
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 20000 });
  await p.click('#btn-settings');
  await p.waitForSelector('#br-token');
  await p.fill('#br-token', 'token-de-prueba');
  await p.click('#br-connect');
  await p.waitForFunction(() => document.getElementById('br-dot')?.classList.contains('on'), null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(400);    // la versión llega justo después de conectar
  const r = await p.evaluate(() => ({
    conectado: document.getElementById('br-dot')?.classList.contains('on'),
    aviso: document.getElementById('br-viejo')?.hidden ? '' : document.getElementById('br-viejo')?.textContent || '',
    estado: document.getElementById('statusbar').textContent,
    ayuda: document.querySelector('#settings-panel .bridge-card')?.textContent || '',
    carpeta: document.querySelector('label[for="br-folder"]')?.textContent || '',
  }));
  await ctx.close();
  return r;
}

const viejo = await conBridge('1.1.1');
ok('conectado a un bridge 1.1.1, Ajustes dice que hay que bajar la 1.1.2', viejo.conectado && /1\.1\.1/.test(viejo.aviso) && /1\.1\.2/.test(viejo.aviso), JSON.stringify(viejo.aviso));
ok('  …y por qué (parar no para lo que el comando arrancó)', /no para lo que este arrancó/.test(viejo.aviso), viejo.aviso);
ok('  …y la barra de estado lo dice también', /1\.1\.2/.test(viejo.estado), viejo.estado);

const nuevo = await conBridge('1.1.2');
ok('con el 1.1.2 no hay aviso', nuevo.conectado && nuevo.aviso === '' && !/1\.1\.1/.test(nuevo.estado), JSON.stringify({ aviso: nuevo.aviso, estado: nuevo.estado }));
ok('la ayuda del bridge pide la versión 1.1.2, no la 1.1.1', /Descárgalo otra vez \(versión 1\.1\.2\)/.test(nuevo.ayuda), nuevo.ayuda.slice(0, 200));
ok('la carpeta vacía es la de arranque del bridge (no «una temporal»)', /desde la que arrancaste el bridge/.test(nuevo.carpeta) && !/temporal/.test(nuevo.carpeta), nuevo.carpeta);

const en = await conBridge('1.1.1', 'en-US');
ok('en inglés: el aviso del bridge viejo, en inglés', /Your bridge is version 1\.1\.1: download 1\.1\.2/.test(en.aviso), en.aviso);
ok('en inglés: la carpeta vacía es la de arranque', /folder you started the bridge from/.test(en.carpeta) && !/temporary/.test(en.carpeta), en.carpeta);

ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ BRIDGE: el viejo se nota y la ayuda dice lo que hay');
await b.close();
process.exit(fails ? 1 : 0);

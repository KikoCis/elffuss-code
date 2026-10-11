// Enter mientras la elfa trabaja ENCOLA el mensaje; solo el botón ■ para.
//
// Antes Enter con la elfa trabajando paraba el trabajo en curso y el texto se
// quedaba sin enviar en la caja, aunque conversations.js acepta y encola
// mensajes. Ahora:
//   1. Enter con texto mientras trabaja: no para, la caja se vacía y el mensaje
//      aparece «en cola» (⏳) al final del chat.
//   2. La respuesta del turno en curso se pinta ANTES del mensaje encolado.
//   3. Cuando le toca, deja de estar en cola y el modelo lo recibe.
//   4. El botón ■ sí para, y lo que esperaba en cola se marca descartado.
//   5. Con OTRA conversación generando, lo que mandas aquí espera (⏳) también
//      el primero, y cada burbuja deja de estar en cola cuando empieza SU
//      turno: antes la marca se decidía por conversación y se le quitaba a la
//      primera en cola, y la respuesta al primero salía debajo del segundo.
//
//   BASE=http://127.0.0.1:8898 node tests/enterqueue.mjs
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

// proveedor lento que apunta qué recibe y cuántas veces lo paran
await p.evaluate(() => {
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  window.__prov = { llamadas: [], abortadas: 0, async chat(h, s, cb, signal) {
    const q = [...h].reverse().find(m => m.role === 'user')?.content || '';
    this.llamadas.push(q);
    const n = this.pasosPara?.(q) ?? 40;
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) { this.abortadas++; throw new DOMException('Parado', 'AbortError'); }
      cb('·'); await dormir(25);
    }
    return 'respuesta a ' + q;
  } };
  window.elffussClaw.conv.setProvider(window.__prov);
});
const estado = () => p.evaluate(() => ({
  busy: window.elffussClaw.conv.isBusy(),
  caja: document.getElementById('prompt').value,
  llamadas: window.__prov.llamadas.slice(), abortadas: window.__prov.abortadas,
  enCola: [...document.querySelectorAll('#chat-log > .msg.user.queued')].map(n => n.textContent),
  descartados: [...document.querySelectorAll('#chat-log > .msg.user.cancelled')].map(n => n.textContent),
  orden: [...document.querySelectorAll('#chat-log > .msg')].map(n => (n.classList.contains('user') ? 'U:' : n.classList.contains('assistant') ? 'A:' : '?:') + n.textContent.trim().slice(0, 30)),
}));

await p.fill('#prompt', 'primero');
await p.press('#prompt', 'Enter');
await p.waitForFunction(() => window.__prov.llamadas.length === 1, null, { timeout: 5000 });
await p.fill('#prompt', 'segundo');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(150);
const e1 = await estado();
ok('1 · Enter con la elfa trabajando NO para el turno en curso', e1.busy && e1.abortadas === 0, JSON.stringify(e1));
ok('1 · la caja se vacía (el mensaje salió)', e1.caja === '', JSON.stringify(e1.caja));
ok('1 · el mensaje aparece en cola (⏳)', e1.enCola.length === 1 && e1.enCola[0] === 'segundo', JSON.stringify(e1.enCola));

await p.waitForFunction(() => window.__prov.llamadas.length === 2, null, { timeout: 8000 });
await p.waitForTimeout(100);
const e2 = await estado();
ok('3 · cuando le toca, el modelo recibe el mensaje encolado', e2.llamadas[1] === 'segundo', JSON.stringify(e2.llamadas));
ok('3 · …y deja de estar en cola', e2.enCola.length === 0, JSON.stringify(e2.enCola));
const iResp = e2.orden.findIndex(x => x.startsWith('A:respuesta a primero'));
const iSeg = e2.orden.findIndex(x => x === 'U:segundo');
ok('2 · la respuesta al primero va ANTES del segundo mensaje', iResp >= 0 && iSeg > iResp, JSON.stringify(e2.orden));
await p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 8000 });

// 4 · ■ para, y lo encolado queda descartado
await p.fill('#prompt', 'tercero');
await p.press('#prompt', 'Enter');
await p.waitForFunction(() => window.__prov.llamadas.length === 3, null, { timeout: 5000 });
await p.fill('#prompt', 'cuarto');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(100);
await p.click('#btn-send');
await p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 8000 });
const e4 = await estado();
ok('4 · el botón ■ sí para el turno', e4.abortadas === 1, JSON.stringify(e4));
ok('4 · lo que esperaba en cola no se manda y se marca descartado', !e4.llamadas.includes('cuarto') && e4.descartados.includes('cuarto') && e4.enCola.length === 0, JSON.stringify(e4));
ok('4 · «(Parado.)» queda encima del descartado', e4.orden.indexOf('A:(Parado.)') >= 0 && e4.orden.indexOf('A:(Parado.)') < e4.orden.indexOf('U:cuarto'), JSON.stringify(e4.orden));

// 5 · otra conversación tiene el modelo
await p.evaluate(async () => {
  const conv = window.elffussClaw.conv;
  window.__prov.pasosPara = q => q === 'B larga' ? 120 : 30;   // B genera un buen rato
  const A = conv.create();
  const B = conv.create();
  conv.switchTo(A.id);                        // en pantalla, A
  conv.send(B.id, 'B larga');
});
await p.waitForFunction(() => window.__prov.llamadas.includes('B larga'), null, { timeout: 5000 });
await p.fill('#prompt', 'A-uno');
await p.press('#prompt', 'Enter');
await p.fill('#prompt', 'A-dos');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(150);
const pensando = () => p.evaluate(() => document.querySelectorAll('#chat-log > .msg.thinking').length);
const e5a = { ...(await estado()), pensando: await pensando() };
ok('5 · con B generando, el PRIMER mensaje de A también espera (⏳), y el segundo', JSON.stringify(e5a.enCola) === '["A-uno","A-dos"]' && e5a.pensando === 0, JSON.stringify({ enCola: e5a.enCola, pensando: e5a.pensando }));
await p.waitForFunction(() => window.__prov.llamadas.includes('A-uno'), null, { timeout: 10000 });
await p.waitForTimeout(100);
const e5b = await estado();
const ordenA = o => o.filter(x => /^U:A-|^A:respuesta a A-|^\?:/.test(x)).map(x => x.startsWith('?:') ? 'pensando' : x);
ok('5 · al empezar A-uno solo él deja de estar en cola; A-dos sigue esperando', JSON.stringify(e5b.enCola) === '["A-dos"]', JSON.stringify(e5b.enCola));
ok('5 · …y «pensando» queda entre los dos', JSON.stringify(ordenA(e5b.orden)) === '["U:A-uno","pensando","U:A-dos"]', JSON.stringify(ordenA(e5b.orden)));
await p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 15000 });
const e5c = await estado();
ok('5 · cada respuesta queda debajo de SU mensaje', JSON.stringify(ordenA(e5c.orden)) === '["U:A-uno","A:respuesta a A-uno","U:A-dos","A:respuesta a A-dos"]', JSON.stringify(ordenA(e5c.orden)));

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ ENTER ENCOLA, ■ PARA');
await b.close();
process.exit(fails ? 1 : 0);

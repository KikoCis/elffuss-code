// Elffuss Lab: el botón ■ PARA de verdad, y una corrida parada se dice parada.
//
// Antes el ■ solo ponía una bandera que los bancos miraban ENTRE casos, y el de
// juegos no tiene casos: generaba el juego entero (varias inferencias) y lo
// puntuaba jugándolo, pulsaras lo que pulsaras. Ahora la parada entra en la
// inferencia en curso (4º argumento de chat()) y se comprueba antes de cada fase.
//
// El cerebro es de mentira: page.route sirve un providers/onnx.js propio, lento
// y que respeta la señal, así que no se descarga ni se ejecuta ningún modelo.
//
// Parar no es ni completar ni fallar: el piloto queda neutro con «parado» (antes
// el de juegos salía en rojo «con fallo»), y una corrida de SWE parada a medias
// no sale como «✔ terminado» ni se puede guardar en el ranking (antes contaba
// con el denominador recortado: k resueltas de k).
//
//   BASE=http://localhost:8799 node tests/labstop.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const FALSO = `
export let name = 'lento (prueba)';
export async function load() {}
const st = (window.__labProv = { llamadas: 0, abortadas: 0, trasParar: 0, terminadas: 0 });
export async function chat(h, s, cb = () => {}, signal) {
  st.llamadas++; if (window.__labParado) st.trasParar++;
  for (let i = 0; i < 100; i++) {
    if (signal?.aborted) { st.abortadas++; throw new DOMException('Parado', 'AbortError'); }
    cb('·'); await new Promise(r => setTimeout(r, 30));
  }
  st.terminadas++;
  return '<!doctype html><html><body><canvas width="80" height="80"></canvas><script>const c=document.querySelector("canvas").getContext("2d");(function f(){c.fillRect(Math.random()*80,Math.random()*80,2,2);requestAnimationFrame(f)})()<\\/script></body></html>';
}
`;

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
const p = await ctx.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.route('**/js/providers/onnx.js*', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: FALSO }));
await p.goto(BASE + '/lab.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);

// cerebro «onnx» (el falso) y banco «juegos»
await p.locator('#brains label').nth(1).click();
await p.click('#btn-load');
await p.waitForFunction(() => /modelo: onnx/.test(document.querySelector('#led-model')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
await p.locator('#benches label').nth(2).click();
await p.click('#btn-run');
await p.waitForFunction(() => (window.__labProv?.llamadas || 0) >= 1, null, { timeout: 5000 }).catch(() => {});
await p.waitForTimeout(300);              // generando el juego
await p.evaluate(() => { window.__labParado = true; });
await p.click('#btn-stop');
const termino = await p.waitForFunction(() => !document.getElementById('btn-run').disabled, null, { timeout: 15000 }).then(() => true).catch(() => false);
await p.waitForTimeout(300);
const estado = () => p.evaluate(() => ({
  st: window.__labProv,
  arena: !document.getElementById('arena-panel').hidden,
  prog: document.getElementById('prog-txt').textContent,
  log: document.getElementById('log').textContent,
  led: { cls: document.getElementById('led-run').className, txt: document.getElementById('led-run').textContent.trim() },
  ranking: document.getElementById('rank-tag').textContent,
}));
const r = await estado();
ok('la corrida estaba generando con el cerebro de prueba', r.st?.llamadas >= 1, `${r.st?.llamadas} llamadas`);
ok('■ corta la inferencia en curso (el modelo recibe la parada)', r.st?.abortadas === 1 && r.st?.terminadas === 0, JSON.stringify(r.st));
ok('  …y no se lanza ninguna inferencia más', r.st?.trasParar === 0, `${r.st?.trasParar} tras parar`);
ok('la corrida termina (▶ vuelve a estar disponible)', termino);
ok('no llega a jugar el juego (la arena no se abre)', !r.arena);
ok('el progreso y el registro dicen «parado»', r.prog === 'parado' && /parado/.test(r.log), `${r.prog} · …${r.log.slice(-60)}`);
ok('  …y el piloto queda neutro con «parado», no en rojo «con fallo»', r.led.cls.trim() === 'led' && r.led.txt === 'parado', JSON.stringify(r.led));

// SWE parado a mitad: ni «✔ terminado» ni «completado», y «Guardar» no lo mete
// en el ranking.
await p.evaluate(() => { window.__labParado = false; Object.assign(window.__labProv, { llamadas: 0, abortadas: 0, trasParar: 0, terminadas: 0 }); });
await p.locator('#benches label').nth(1).click();
await p.click('#btn-run');
// Parar en la SEGUNDA tarea, con la primera ya contada: es lo que antes salía
// como corrida completa con el denominador recortado.
await p.waitForFunction(() => (window.__labProv?.llamadas || 0) >= 2, null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(300);
await p.evaluate(() => { window.__labParado = true; });
await p.click('#btn-stop');
const terminoSwe = await p.waitForFunction(() => !document.getElementById('btn-run').disabled, null, { timeout: 15000 }).then(() => true).catch(() => false);
await p.waitForTimeout(300);
const rankingAntes = (await estado()).ranking;
await p.click('#btn-save');
await p.waitForTimeout(200);
const s = await estado();
ok('SWE: la corrida parada termina, con la primera tarea ya contada', terminoSwe && /"resolved":"\d+\/1"/.test(s.log), '…' + s.log.slice(-160));
ok('SWE parado: el progreso dice «parado» y el piloto «parado» (neutro)', s.prog === 'parado' && s.led.cls.trim() === 'led' && s.led.txt === 'parado', `${s.prog} · ${JSON.stringify(s.led)}`);
ok('  …y no se anuncia como «✔ terminado»', !s.log.includes('✔ terminado'), '…' + s.log.slice(-120));
ok('  …y «Guardar» no la mete en el ranking', s.ranking === rankingAntes && /no entra en el ranking/.test(s.log), `${rankingAntes} → ${s.ranking}`);

console.log('\n  errores JS:', errs[0] || 'ninguno');
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ LAB OK — el ■ para el banco de juegos de verdad');
await b.close();
process.exit(fails ? 1 : 0);

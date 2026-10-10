// ⛏ Hard Work como un turno MÁS de la conversación: se para con ■ y se guarda.
//
// Antes runHardWork corría por fuera de la cola: el botón nunca pasaba a ■ (no
// había forma de pararlo), la conversación no constaba como ocupada y la
// pregunta y la respuesta vivían solo en el DOM, así que desaparecían al
// cambiar de pestaña o recargar. Y al apagarlo dejaba un placeholder fijo en
// español.
//
// Proveedor de mentira (sin modelo): contesta a las sub-llamadas del map y del
// reduce, lento, y cuenta las llamadas para ver que tras ■ no sale ninguna más.
//
//   BASE=http://127.0.0.1:8898 node tests/hardwork-queue.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));

const arranca = async () => {
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 15000 });
};
// proyecto sembrado en OPFS (?test-opfs lo abre como carpeta del proyecto)
const siembra = (kb) => p.evaluate(async (kb) => {
  const root = await navigator.storage.getDirectory();
  const escribe = async (name, txt) => { const w = await (await root.getFileHandle(name, { create: true })).createWritable(); await w.write(txt); await w.close(); };
  const relleno = n => Array.from({ length: n }, (_, i) => `function f${i}() { return ${i}; } // línea de relleno`).join('\n');
  await escribe('app.js', relleno(kb * 20));
  await escribe('util.js', relleno(kb * 20));
  await escribe('README.md', '# Proyecto de prueba\nUsa app.js y util.js.');
}, kb);
const ponProveedor = (pausa) => p.evaluate((pausa) => {
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  window.__hw = { llamadas: 0, trasParar: 0, parado: false, abortadas: 0 };
  window.elffussClaw.conv.setProvider({ name: 'hw-falso', async chat(h, sys, cb, signal) {
    window.__hw.llamadas++;
    if (window.__hw.parado) window.__hw.trasParar++;
    for (let i = 0; i < 10; i++) {
      if (signal?.aborted) { window.__hw.abortadas++; throw new DOMException('Parado', 'AbortError'); }
      await dormir(pausa / 10);
    }
    return /sintetizador/.test(sys) ? 'respuesta final de prueba' : 'hallazgo en este trozo';
  } });
}, pausa);
const hardWork = async (encender) => {
  const on = await p.evaluate(() => document.getElementById('btn-hardwork').classList.contains('on'));
  if (on === encender) return;
  if (await p.locator('#modos-menu').isHidden()) await p.click('#btn-modos');
  await p.click('#btn-hardwork');
};

await arranca();
await siembra(2);
await ponProveedor(60);
await hardWork(true);
await p.fill('#prompt', '¿qué hace este proyecto?');
await p.press('#prompt', 'Enter');
await p.waitForFunction(() => document.getElementById('btn-send').classList.contains('is-stop'), null, { timeout: 5000 }).catch(() => {});
const durante = await p.evaluate(() => ({ stop: document.getElementById('btn-send').classList.contains('is-stop'), busy: window.elffussClaw.conv.isBusy() }));
ok('1 · mientras trabaja, el botón es ■ y la conversación está ocupada', durante.stop && durante.busy, JSON.stringify(durante));
await p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 30000 });
const fin = await p.evaluate(() => {
  const h = window.elffussClaw.conv.getActive().agent.history;
  return { log: document.getElementById('chat-log').innerText, ultimos: h.slice(-2).map(m => m.role + ':' + m.content.slice(0, 60)), id: window.elffussClaw.conv.getActive().id };
});
ok('1 · la respuesta aparece en el chat', fin.log.includes('respuesta final de prueba') && fin.log.includes('Hard Work (RLM)'), fin.log.slice(-200));
ok('1 · pregunta y respuesta quedan en el historial de la conversación', fin.ultimos[0] === 'user:¿qué hace este proyecto?' && fin.ultimos[1]?.startsWith('assistant:respuesta final de prueba'), JSON.stringify(fin.ultimos));

// 2 · sobrevive a recargar
await arranca();
const tras = await p.evaluate(() => ({ id: window.elffussClaw.conv.getActive().id, log: document.getElementById('chat-log').innerText }));
ok('2 · tras recargar, la pregunta y la respuesta siguen en la conversación', tras.id === fin.id && tras.log.includes('¿qué hace este proyecto?') && tras.log.includes('respuesta final de prueba'), tras.log.slice(0, 300));

// 3 · ■ lo para: no sale ninguna sub-llamada más y no se apunta respuesta
await siembra(12);
await ponProveedor(400);
await hardWork(true);
await p.fill('#prompt', 'audita todo el proyecto');
await p.press('#prompt', 'Enter');
await p.waitForFunction(() => window.__hw.llamadas >= 1, null, { timeout: 8000 });
await p.waitForTimeout(150);
await p.evaluate(() => { window.__hw.parado = true; });
await p.click('#btn-send');
await p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(600);
const r3 = await p.evaluate(() => {
  const h = window.elffussClaw.conv.getActive().agent.history;
  return { busy: window.elffussClaw.conv.isBusy(), hw: window.__hw, ultimo: h.at(-1)?.role + ':' + h.at(-1)?.content.slice(0, 40), log: document.getElementById('chat-log').innerText.slice(-120) };
});
ok('3 · ■ para el Hard Work (deja de estar ocupado)', !r3.busy, JSON.stringify(r3));
ok('3 · la sub-llamada en curso recibe la parada y no sale ninguna más', r3.hw.abortadas >= 1 && r3.hw.trasParar === 0, JSON.stringify(r3.hw));
ok('3 · se ve «(Parado.)» y no se apunta respuesta', r3.log.includes('(Parado.)') && r3.ultimo === 'user:audita todo el proyecto', JSON.stringify(r3));

// 4 · al apagarlo vuelve el placeholder de la interfaz
await hardWork(false);
const ph = await p.evaluate(() => document.getElementById('prompt').placeholder);
ok('4 · al apagar Hard Work vuelve el placeholder normal', ph === 'Escribe aquí… (@ adjunta un archivo)', ph);

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ HARD WORK EN LA COLA: SE PARA Y SE GUARDA');
await b.close();
process.exit(fails ? 1 : 0);

// PARAR desde la conversación: la cola, el cerrojo de inferencia y el botón.
//
// Cinco cosas que fallaban, cada una con su escenario:
//   1. Parar un mensaje que ESPERA turno (otra conversación tiene el cerrojo):
//      antes se ejecutaba igual en cuanto le tocaba. Ahora el modelo ni se llama.
//   2. Parar y mandar otro mensaje enseguida: el `shift()` a ciegas se llevaba
//      el mensaje nuevo y el `break` dejaba la cola parada. Ahora se contesta.
//   3. Parar y recargar: la cola vaciada no se guardaba hasta que el turno
//      terminaba, y al recargar el mensaje parado se volvía a ejecutar.
//   4. El botón ■ no se repintaba al cambiar de pestaña.
//   5. Tras pulsar ■ no cambiaba nada hasta que el turno se soltaba: ahora sale
//      «Parando…», deshabilitado y con aria-busy.
// Y la tarjeta de un objetivo parado dice «parado», no «completado».
//
// Modelo de mentira inyectado por import('/js/conversations.js'): lento, cuenta
// las llamadas y, si se le pide, tarda en soltar la generación tras la parada
// (como un modelo de verdad a media pasada).
//
//   BASE=http://localhost:8799 node tests/stopqueue.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1300, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));

const ayudantes = () => p.evaluate(() => {
  window.__dormir = ms => new Promise(r => setTimeout(r, ms));
  window.__hasta = async (f, n = 400) => { for (let i = 0; i < n && !f(); i++) await window.__dormir(25); return f(); };
  window.__lento = ({ pasos = 40, paso = 30, tardaEnParar = 0, respuesta = 'hecho.', plan = null } = {}) => {
    const st = { name: 'lento', llamadas: [], abortadas: 0 };
    st.chat = async (h, s, cb, signal) => {
      if (plan && /^ROL: PLANIFICADOR/.test(s || '')) { st.llamadas.push('[planificador]'); return plan; }
      st.llamadas.push([...h].reverse().find(m => m.role === 'user')?.content || '');
      for (let i = 0; i < pasos; i++) {
        if (signal?.aborted) {
          st.abortadas++;
          if (tardaEnParar) await window.__dormir(tardaEnParar);
          throw new DOMException('Parado', 'AbortError');
        }
        cb('·'); await window.__dormir(paso);
      }
      return respuesta;
    };
    return st;
  };
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
await ayudantes();

// 1. Parar mientras espera el cerrojo → el modelo ni se llama
const r1 = await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  const prov = window.__lento({ pasos: 50 });
  conv.setProvider(prov);
  const A = conv.getActive();
  conv.send(A.id, 'mensaje A (tiene el cerrojo)');
  await window.__hasta(() => prov.llamadas.length >= 1);
  const B = conv.create();                    // B pasa a ser la activa
  conv.send(B.id, 'mensaje B (esperando turno)');
  await window.__dormir(150);
  const esperaba = B.pumping && prov.llamadas.length === 1;
  const paro = conv.stopActive();             // para B, no A
  await window.__hasta(() => !A.pumping && !B.pumping);
  return {
    esperaba, paro, llamadas: prov.llamadas,
    histB: B.agent.history.filter(m => m.role === 'user').map(m => m.content),
    colaB: B.queue.length, respondioA: A.agent.history.at(-1)?.role === 'assistant',
  };
});
ok('1 · B estaba esperando turno detrás de A', r1.esperaba && r1.paro);
ok('1 · parado mientras esperaba: el modelo NUNCA recibe el mensaje B', !r1.llamadas.some(t => t.includes('mensaje B')), JSON.stringify(r1.llamadas));
ok('1 · …ni se apunta en su historial, y su cola queda vacía', r1.histB.length === 0 && r1.colaB === 0, `historial ${JSON.stringify(r1.histB)} · cola ${r1.colaB}`);
ok('1 · A, que no se paró, termina con su respuesta', r1.respondioA);

// 2. Parar y mandar otro enseguida (mientras el turno parado aún se suelta) → se contesta
const r2 = await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  const prov = window.__lento({ pasos: 40, tardaEnParar: 500, respuesta: 'respuesta a la segunda' });
  conv.setProvider(prov);
  const C = conv.create();
  conv.send(C.id, 'primera');
  await window.__hasta(() => prov.llamadas.length >= 1);
  await window.__dormir(100);
  conv.stopActive();
  conv.send(C.id, 'segunda');
  await window.__hasta(() => !C.pumping);
  const h = C.agent.history;
  const i = h.findIndex(m => m.role === 'user' && m.content === 'segunda');
  return { llamadas: prov.llamadas, respuesta: i >= 0 ? h[i + 1]?.content : null, cola: C.queue.length };
});
ok('2 · parar y mandar otro: el modelo recibe el mensaje nuevo', r2.llamadas.includes('segunda'), JSON.stringify(r2.llamadas));
ok('2 · …y se contesta', r2.respuesta === 'respuesta a la segunda', JSON.stringify(r2.respuesta));
ok('2 · la cola queda vacía', r2.cola === 0, `${r2.cola}`);

// 3. Parar y recargar → la cola guardada está vacía y el mensaje no se repite
const r3 = await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  const db = await import('/js/db.js');
  const prov = window.__lento({ pasos: 200, tardaEnParar: 8000 });   // tarda mucho en soltar
  conv.setProvider(prov);
  const D = conv.create();
  conv.send(D.id, 'parar y recargar');
  await window.__hasta(() => prov.llamadas.length >= 1);
  conv.stopActive();
  await window.__dormir(300);
  const guardada = (await db.get('kv', 'conversations')).find(c => c.id === D.id);
  return { id: D.id, sigueTrabajando: D.pumping, colaGuardada: guardada?.queue?.length ?? 'sin guardar' };
});
ok('3 · justo después de parar, IndexedDB ya tiene la cola vacía (el turno aún se está soltando)',
  r3.sigueTrabajando && r3.colaGuardada === 0, `cola guardada ${r3.colaGuardada}`);
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
await ayudantes();
const r3b = await p.evaluate(async (id) => {
  const db = await import('/js/db.js');
  const c = (await db.get('kv', 'conversations')).find(x => x.id === id);
  const usuario = c.history.filter(m => m.role === 'user' && m.content === 'parar y recargar').length;
  const i = c.history.findIndex(m => m.role === 'user' && m.content === 'parar y recargar');
  return { cola: c.queue.length, usuario, trasEl: i >= 0 ? c.history.slice(i + 1).map(m => m.role) : null };
}, r3.id);
ok('3 · tras recargar: la cola sigue vacía', r3b.cola === 0, `${r3b.cola}`);
ok('3 · …y el mensaje parado no se volvió a ejecutar (sin respuesta nueva)', r3b.usuario <= 1 && (r3b.trasEl || []).length === 0,
  `veces ${r3b.usuario} · después ${JSON.stringify(r3b.trasEl)}`);

// 4. ■ se repinta al cambiar de pestaña (con la UI de verdad)
await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  window.__prov4 = window.__lento({ pasos: 400, paso: 25 });
  conv.setProvider(window.__prov4);
  conv.create();
});
await p.fill('#prompt', 'trabajo largo en la pestaña 1');
await p.click('#btn-send');
await p.waitForFunction(() => document.getElementById('btn-send').classList.contains('is-stop'), null, { timeout: 5000 }).catch(() => {});
const boton = () => p.evaluate(() => {
  const b = document.getElementById('btn-send');
  return { stop: b.classList.contains('is-stop'), sending: b.classList.contains('sending'), disabled: b.disabled, title: b.title, aria: b.getAttribute('aria-busy'), texto: b.textContent.trim() };
});
const enTrabajo = await boton();
// Con tantas pestañas abiertas por los escenarios de arriba, el «+» y las
// pestañas quedan bajo el botón ⇔: se les manda el clic directamente.
await p.locator('#conv-tabs .tab-add').dispatchEvent('click');
await p.waitForTimeout(300);
const enOtra = await boton();
await p.locator('#conv-tabs .tab:nth-last-child(3)').dispatchEvent('click');   // la pestaña anterior (la que trabaja)
await p.waitForTimeout(300);
const deVuelta = await boton();
ok('4 · en la pestaña que trabaja el botón es ■', enTrabajo.stop && enTrabajo.title === 'Parar', JSON.stringify(enTrabajo));
ok('4 · al cambiar a una pestaña ociosa el botón vuelve a «Enviar»', !enOtra.stop && !enOtra.sending && !enOtra.disabled && enOtra.title === 'Enviar', JSON.stringify(enOtra));
ok('4 · al volver, otra vez ■', deVuelta.stop && deVuelta.title === 'Parar', JSON.stringify(deVuelta));

// 5. «Parando…» justo después del clic en ■, y vuelta a «Enviar» al terminar
await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  conv.stopActive();
  await window.__hasta(() => !conv.isBusy());
  window.__prov5 = window.__lento({ pasos: 400, paso: 25, tardaEnParar: 1500 });
  conv.setProvider(window.__prov5);
});
await p.fill('#prompt', 'otro trabajo largo');
await p.click('#btn-send');
await p.waitForFunction(() => document.getElementById('btn-send').classList.contains('is-stop'), null, { timeout: 5000 }).catch(() => {});
await p.click('#btn-send');
const parando = await boton();
await p.waitForFunction(() => !document.getElementById('btn-send').disabled && !document.getElementById('btn-send').classList.contains('sending'), null, { timeout: 8000 }).catch(() => {});
const despues = await boton();
ok('5 · justo tras el clic: «Parando…», deshabilitado y con aria-busy', parando.texto === 'Parando…' && parando.disabled && parando.aria === 'true', JSON.stringify(parando));
ok('5 · al soltarse el turno vuelve a «Enviar», habilitado y sin aria-busy', !despues.disabled && despues.title === 'Enviar' && despues.aria === null, JSON.stringify(despues));

// 6. Objetivo parado desde la UI: la tarjeta dice «parado» y la tarea ⏹️
await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  window.__prov6 = window.__lento({ pasos: 400, paso: 25, plan: JSON.stringify({ plan: 'dos pasos', tasks: [
    { title: 'Primero', description: 'mira el árbol' }, { title: 'Segundo', description: 'resume' }] }) });
  conv.setProvider(window.__prov6);
});
// 🎯 vive dentro del menú «Modos»: se abre el menú y se enciende.
const modoObjetivo = async () => { if (await p.locator('#modos-menu').isHidden()) await p.click('#btn-modos'); await p.click('#btn-goal'); };
await modoObjetivo();
await p.fill('#prompt', 'objetivo que se para');
await p.click('#btn-send');
await p.waitForFunction(() => document.querySelector('.plan-card li.task-in-progress'), null, { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(200);
await p.click('#btn-send');
await p.waitForFunction(() => !document.getElementById('btn-send').classList.contains('sending'), null, { timeout: 8000 }).catch(() => {});
const tarjeta = await p.evaluate(() => {
  const c = [...document.querySelectorAll('.plan-card')].at(-1);
  return { estado: c?.querySelector('.plan-status')?.textContent, parada: c?.querySelectorAll('li.task-stopped').length,
    saltada: c?.querySelectorAll('li.task-skipped').length, icono: c?.querySelector('li.task-stopped .task-ico')?.textContent };
});
await modoObjetivo();   // dejar el modo como estaba
ok('6 · la tarjeta del objetivo parado dice «parado»', tarjeta.estado === 'parado', JSON.stringify(tarjeta));
ok('6 · tarea en curso ⏹️ parada y la siguiente saltada', tarjeta.parada === 1 && tarjeta.saltada === 1 && tarjeta.icono === '⏹️', JSON.stringify(tarjeta));

console.log('\n  errores JS:', errs[0] || 'ninguno');
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ PARAR DESDE LA CONVERSACIÓN OK — cola, cerrojo, recarga y botón');
await b.close();
process.exit(fails ? 1 : 0);

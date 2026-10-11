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
//      «Parando…», deshabilitado y con aria-busy, y de ahí pasa a «Enviar» sin
//      volver un momento a «Parar».
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
// Que el IDE haya abierto de verdad (Monaco y las conversaciones): con una
// espera fija, en una máquina cargada se mandaba antes de que existiera la
// conversación y el mensaje no iba a ninguna parte.
const listo = pg => pg.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 30000 });
await listo(p);
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
  // Lo GUARDADO, no solo lo que hay en memoria: B, al saltarse, guarda a la vez
  // que A guarda su respuesta, y las dos escrituras reescriben la lista entera.
  const db = await import('/js/db.js');
  const guardadaA = (await db.get('kv', 'conversations')).find(c => c.id === A.id);
  return {
    esperaba, paro, llamadas: prov.llamadas,
    histB: B.agent.history.filter(m => m.role === 'user').map(m => m.content),
    colaB: B.queue.length, respondioA: A.agent.history.at(-1)?.role === 'assistant',
    guardadaA: { roles: guardadaA?.history?.map(m => m.role), cola: guardadaA?.queue?.length },
  };
});
ok('1 · B estaba esperando turno detrás de A', r1.esperaba && r1.paro);
ok('1 · parado mientras esperaba: el modelo NUNCA recibe el mensaje B', !r1.llamadas.some(t => t.includes('mensaje B')), JSON.stringify(r1.llamadas));
ok('1 · …ni se apunta en su historial, y su cola queda vacía', r1.histB.length === 0 && r1.colaB === 0, `historial ${JSON.stringify(r1.histB)} · cola ${r1.colaB}`);
ok('1 · A, que no se paró, termina con su respuesta', r1.respondioA);
ok('1 · …y IndexedDB guarda esa respuesta con la cola de A vacía (si no, al recargar A se repite)',
  r1.guardadaA.roles?.at(-1) === 'assistant' && r1.guardadaA.cola === 0, JSON.stringify(r1.guardadaA));

// 1b. Lo mismo varias veces seguidas: la carrera entre las dos escrituras no
// puede depender de la suerte. Cada ronda con su propio A y B.
const r1b = await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  const db = await import('/js/db.js');
  const rondas = [];
  for (let i = 0; i < 4; i++) {
    const prov = window.__lento({ pasos: 12, paso: 20 });
    conv.setProvider(prov);
    const A = conv.create();
    conv.send(A.id, `A${i}`);
    await window.__hasta(() => prov.llamadas.length >= 1);
    const B = conv.create();
    conv.send(B.id, `B${i}`);
    await window.__dormir(60);
    conv.stopActive();
    await window.__hasta(() => !A.pumping && !B.pumping);
    const g = (await db.get('kv', 'conversations')).find(c => c.id === A.id);
    rondas.push({ ultimo: g?.history?.at(-1)?.role, cola: g?.queue?.length });
  }
  return rondas;
});
ok('1b · en cada ronda IndexedDB guarda la respuesta de A y su cola vacía',
  r1b.every(r => r.ultimo === 'assistant' && r.cola === 0), JSON.stringify(r1b));

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

// 2b. La tasa de resolución del velocímetro no cuenta una tarea parada (ni como
// resuelta ni como fallida); una normal sí. (El velocímetro solo apunta las
// tareas del motor, el cerebro que mide: este proveedor de mentira hace de motor.)
const r2b = await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  const vm = await import('/js/velocimetro.js');
  const cuantas = () => { try { return (JSON.parse(localStorage.getItem('elffuss.velocimetro.v1') || '{}').tareas || []).length; } catch { return -1; } };
  const antes = cuantas();
  const prov = window.__lento({ pasos: 40 });
  prov.alMedir = () => () => {}; prov.ultimaMedida = () => null; prov.modeloEtiqueta = () => 'motor de prueba';
  vm.montar(prov);
  conv.setProvider(prov);
  const V = conv.create();
  conv.send(V.id, 'esta se para');
  await window.__hasta(() => prov.llamadas.length >= 1);
  conv.stopActive();
  await window.__hasta(() => !V.pumping);
  await window.__dormir(100);
  const trasParar = cuantas();
  conv.send(V.id, 'esta no');
  await window.__hasta(() => !V.pumping);
  await window.__dormir(100);
  const trasNormal = cuantas();
  vm.montar(null);   // el resto de la prueba sigue sin motor
  return { antes, trasParar, trasNormal };
});
ok('2b · el velocímetro no apunta la tarea parada y sí la normal', r2b.antes >= 0 && r2b.antes < 59 && r2b.trasParar === r2b.antes && r2b.trasNormal === r2b.antes + 1, JSON.stringify(r2b));

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
await listo(p);
await p.waitForTimeout(1000);
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
const boton = (pg = p) => pg.evaluate(() => {
  const b = document.getElementById('btn-send');
  return { stop: b.classList.contains('is-stop'), sending: b.classList.contains('sending'), disabled: b.disabled, title: b.title, aria: b.getAttribute('aria-busy'), texto: b.textContent.trim(),
    ariaDisabled: b.getAttribute('aria-disabled'), label: b.getAttribute('aria-label'), foco: document.activeElement?.id || document.activeElement?.tagName,
    anuncio: document.getElementById('send-status')?.textContent ?? null };
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
// «Parando…» solo existe mientras un turno que YA llegó al modelo se suelta. El
// ■ se enciende en cuanto el mensaje entra en la cola, antes de que el turno
// guarde su intento y coja el cerrojo; un clic en ese hueco para un mensaje que
// aún no ha empezado, y eso pasa a «Enviar» al momento (bien hecho, pero no es
// lo que se mide aquí). En una máquina cargada el hueco dura lo bastante para
// caer dentro: se espera a que el modelo tenga el mensaje.
const empezo5 = await p.waitForFunction(() => window.__prov5.llamadas.length >= 1, null, { timeout: 10000 }).then(() => true, () => false);
ok('5 · (premisa) el turno llegó al modelo antes de pulsar ■', empezo5);
// Cada nombre accesible que toma el botón desde aquí hasta «Enviar», en orden.
await p.evaluate(() => {
  const b = document.getElementById('btn-send');
  window.__etiquetas5 = [b.getAttribute('aria-label')];
  window.__obs5 = new MutationObserver(() => { const l = b.getAttribute('aria-label'); if (window.__etiquetas5.at(-1) !== l) window.__etiquetas5.push(l); });
  window.__obs5.observe(b, { attributes: true, attributeFilter: ['aria-label'] });
});
await p.click('#btn-send');
await p.waitForTimeout(150);   // la región viva se escribe en otro tick
const parando = await boton();
// Pulsar «Parando…» otra vez, con texto escrito: no hace nada (ni para ni envía).
// force: Playwright da por deshabilitado un botón con aria-disabled y, sin
// esto, esperaría a que se habilitara para pulsarlo; un usuario sí lo pulsa.
// (El texto se pone y se quita por código para no mover el foco, que es lo
// que se mide después.)
await p.evaluate(() => { document.getElementById('prompt').value = 'no debe salir al pulsar Parando'; });
await p.click('#btn-send', { force: true });
const trasPulsarParando = await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  const r = { prompt: document.getElementById('prompt').value, cola: conv.getActive().queue.length };
  document.getElementById('prompt').value = '';
  return r;
});
await p.waitForFunction(() => !document.getElementById('btn-send').hasAttribute('aria-disabled') && !document.getElementById('btn-send').classList.contains('sending'), null, { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(150);
const despues = await boton();
const etiquetas5 = await p.evaluate(() => { window.__obs5.disconnect(); return window.__etiquetas5; });
ok('5 · justo tras el clic: «Parando…», aria-disabled y aria-busy, sin disabled', parando.texto === 'Parando…' && parando.ariaDisabled === 'true' && !parando.disabled && parando.aria === 'true', JSON.stringify(parando));
ok('5 · …el foco sigue en el botón (antes caía a <body>)', parando.foco === 'btn-send', parando.foco);
ok('5 · …y la región viva dice «Parando…»', parando.anuncio === 'Parando…', JSON.stringify(parando.anuncio));
ok('5 · pulsar «Parando…» no hace nada: el texto sigue escrito y no entra en la cola', trasPulsarParando.prompt === 'no debe salir al pulsar Parando' && trasPulsarParando.cola === 0, JSON.stringify(trasPulsarParando));
ok('5 · al soltarse el turno vuelve a «Enviar», sin aria-disabled ni aria-busy', !despues.disabled && despues.ariaDisabled === null && despues.title === 'Enviar' && despues.aria === null, JSON.stringify(despues));
ok('5 · …con el foco todavía en el botón', despues.foco === 'btn-send', despues.foco);
ok('5 · …y la región viva dice «Parado.»', despues.anuncio === 'Parado.', JSON.stringify(despues.anuncio));
// Antes, al soltarse el turno el botón volvía un momento a ■ «Parar» habilitado
// (mientras se guardaba la conversación) antes de quedar en «Enviar».
ok('5 · de «Parando…» pasa directo a «Enviar», sin volver a «Parar»', JSON.stringify(etiquetas5) === JSON.stringify(['Parar', 'Parando…', 'Enviar']), JSON.stringify(etiquetas5));

// 5b. Lo mismo con el teclado: Espacio sobre el botón para, y el foco se queda.
await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  window.__prov5b = window.__lento({ pasos: 400, paso: 25, tardaEnParar: 800 });
  conv.setProvider(window.__prov5b);
});
await p.fill('#prompt', 'trabajo para parar con el teclado');
await p.press('#prompt', 'Enter');
// Que el modelo ya esté generando: parado antes, el turno no tendría nada que
// soltar y no pasaría por «Parando…».
await p.waitForFunction(() => window.__prov5b.llamadas.length >= 1, null, { timeout: 5000 }).catch(() => {});
await p.focus('#btn-send');
await p.keyboard.press('Space');
await p.waitForTimeout(150);
const teclaParando = await boton();
await p.waitForFunction(() => !document.getElementById('btn-send').classList.contains('sending'), null, { timeout: 8000 }).catch(() => {});
await p.waitForTimeout(150);
const teclaDespues = await boton();
ok('5b · Espacio sobre ■: «Parando…» con el foco en el botón', teclaParando.texto === 'Parando…' && teclaParando.foco === 'btn-send', JSON.stringify(teclaParando));
ok('5b · …y al soltarse, «Enviar» con el foco en el botón', teclaDespues.title === 'Enviar' && teclaDespues.foco === 'btn-send', JSON.stringify(teclaDespues));

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

// 6b. Objetivo parado y recarga ANTES de que se suelte: lo guardado ya dice
// «parado» (tarea en curso parada, la pendiente saltada), y tras recargar la
// tarjeta no se queda en «ejecutando…» sin que nada se ejecute.
await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  window.__prov6b = window.__lento({ pasos: 400, paso: 25, tardaEnParar: 8000, plan: JSON.stringify({ plan: 'dos pasos', tasks: [
    { title: 'Uno', description: 'mira el árbol' }, { title: 'Dos', description: 'resume' }] }) });
  conv.setProvider(window.__prov6b);
  conv.create();
});
await modoObjetivo();
await p.fill('#prompt', 'objetivo que se para y se recarga');
await p.click('#btn-send');
await p.waitForFunction(() => document.querySelector('.plan-card li.task-in-progress'), null, { timeout: 8000 }).catch(() => {});
await modoObjetivo();
const r6b = await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  const db = await import('/js/db.js');
  const c = conv.getActive();
  conv.stopActive();
  await window.__dormir(300);
  const g = (await db.get('kv', 'conversations')).find(x => x.id === c.id);
  return { id: c.id, sigue: c.pumping, plan: g?.plan ? { status: g.plan.status, tasks: g.plan.tasks.map(t => t.status) } : null };
});
ok('6b · justo tras parar (el objetivo aún se suelta), el plan guardado ya está parado',
  r6b.sigue && r6b.plan?.status === 'stopped' && JSON.stringify(r6b.plan.tasks) === '["stopped","skipped"]', JSON.stringify(r6b));
// Con trabajo vivo la página pide confirmar antes de irse (beforeunload): se
// acepta, como haría quien recarga a propósito.
p.once('dialog', d => d.accept().catch(() => {}));
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await listo(p);
await p.waitForTimeout(1000);
await ayudantes();
const tarjeta6b = await p.evaluate(() => {
  const c = [...document.querySelectorAll('.plan-card')].at(-1);
  return { estado: c?.querySelector('.plan-status')?.textContent, enCurso: c?.querySelectorAll('li.task-in-progress').length };
});
ok('6b · tras recargar, la tarjeta dice «parado» y no hay tarea en curso', tarjeta6b.estado === 'parado' && tarjeta6b.enCurso === 0, JSON.stringify(tarjeta6b));

// 7. Parar un mensaje que solo ESPERA turno (otra conversación genera): no hay
// nada que soltar, así que ni «Parando…» durante el turno ajeno: vuelve a
// «Enviar» enseguida, con su «(Parado.)» en el chat y anunciado.
await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  window.__prov7 = window.__lento({ pasos: 160, paso: 25 });
  conv.setProvider(window.__prov7);
  const A = conv.create();
  window.__A7 = A;
  conv.send(A.id, 'A7 genera un buen rato');
  await window.__hasta(() => window.__prov7.llamadas.length >= 1);
  conv.create();                               // B, la activa, en la UI
});
await p.fill('#prompt', 'B7 espera turno');
await p.click('#btn-send');
await p.waitForFunction(() => document.getElementById('btn-send').classList.contains('is-stop'), null, { timeout: 5000 }).catch(() => {});
await p.click('#btn-send');
await p.waitForTimeout(400);
const r7 = await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  const B = conv.getActive();
  const notas = [...document.querySelectorAll('#chat-log .msg.muted')].map(d => d.textContent);
  return { aSigue: window.__A7.pumping, bTrabaja: B.pumping, bParando: !!B.parando, cola: B.queue.length, notas,
    llamadas: window.__prov7.llamadas };
});
const boton7 = await boton();
ok('7 · A sigue generando mientras tanto', r7.aSigue, JSON.stringify(r7));
ok('7 · B ya no trabaja ni está «Parando…», y su cola está vacía', !r7.bTrabaja && !r7.bParando && r7.cola === 0, JSON.stringify(r7));
ok('7 · el botón de B vuelve a «Enviar» sin esperar a A', boton7.title === 'Enviar' && !boton7.sending && boton7.ariaDisabled === null, JSON.stringify(boton7));
ok('7 · el chat de B dice «(Parado.)» y la región viva «Parado.»', r7.notas.includes('(Parado.)') && boton7.anuncio === 'Parado.', JSON.stringify({ notas: r7.notas, anuncio: boton7.anuncio }));
ok('7 · el modelo nunca recibió el mensaje de B', !r7.llamadas.some(t => t.includes('B7')), JSON.stringify(r7.llamadas));
const r7b = await p.evaluate(async () => {
  await window.__hasta(() => !window.__A7.pumping, 800);
  return { respondio: window.__A7.agent.history.at(-1)?.role === 'assistant', llamadas: window.__prov7.llamadas.length };
});
ok('7 · A termina con su respuesta, y nadie más llamó al modelo', r7b.respondio && r7b.llamadas === 1, JSON.stringify(r7b));

// 8. En inglés el botón no mezcla idiomas: Send / Stop / Stopping…
{
  const ctxEn = await b.newContext({ locale: 'en-US' });
  await ctxEn.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
  const pe = await ctxEn.newPage({ viewport: { width: 1300, height: 900 } });
  pe.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await pe.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await listo(pe);
  const inicial = await boton(pe);
  await pe.evaluate(async () => {
    window.__dormir = ms => new Promise(r => setTimeout(r, ms));
    const conv = await import('/js/conversations.js');
    window.__llamadasEn = 0;
    conv.setProvider({ name: 'lento-en', chat: async (h, s, cb, signal) => {
      window.__llamadasEn++;
      for (let i = 0; i < 400; i++) {
        if (signal?.aborted) { await window.__dormir(600); throw new DOMException('Stopped', 'AbortError'); }
        cb('·'); await window.__dormir(25);
      }
      return 'done';
    } });
  });
  await pe.fill('#prompt', 'long job');
  await pe.click('#btn-send');
  await pe.waitForFunction(() => document.getElementById('btn-send').classList.contains('is-stop'), null, { timeout: 5000 }).catch(() => {});
  // Como en el 5: que el turno haya llegado al modelo antes de pulsar ■.
  const empezo8 = await pe.waitForFunction(() => window.__llamadasEn >= 1, null, { timeout: 10000 }).then(() => true, () => false);
  ok('8 · (premisa) el turno llegó al modelo antes de pulsar ■', empezo8);
  const trabajando = await boton(pe);
  await pe.click('#btn-send');
  await pe.waitForTimeout(150);
  const parandoEn = await boton(pe);
  await pe.waitForFunction(() => !document.getElementById('btn-send').classList.contains('sending'), null, { timeout: 8000 }).catch(() => {});
  await pe.waitForTimeout(150);
  const finEn = await boton(pe);
  ok('8 · en inglés: Send → Stop → Stopping… → Send',
    inicial.title === 'Send' && trabajando.label === 'Stop' && parandoEn.label === 'Stopping…' && finEn.label === 'Send',
    JSON.stringify([inicial.title, trabajando.label, parandoEn.label, finEn.label]));
  ok('8 · …y la región viva anuncia en inglés', parandoEn.anuncio === 'Stopping…' && finEn.anuncio === 'Stopped.', JSON.stringify([parandoEn.anuncio, finEn.anuncio]));
  await ctxEn.close();
}

console.log('\n  errores JS:', errs[0] || 'ninguno');
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ PARAR DESDE LA CONVERSACIÓN OK — cola, cerrojo, recarga y botón');
await b.close();
process.exit(fails ? 1 : 0);

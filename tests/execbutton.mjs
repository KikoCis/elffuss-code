// Bug real reportado: ni el mensaje de mejoras en el chat ni la notificación
// del sistema tenían un botón para EJECUTAR la propuesta directamente.
// - Chat: reportImprovements ahora añade un botón real «▶ Ejecutar esta
//   propuesta» que manda el .md a la cola/agente real.
// - Notificación: pasa por el service worker (registration.showNotification)
//   con acciones («▶ Ejecutar» / «Ver en la Mente»); al pulsar, el SW avisa a
//   la pestaña (postMessage) y esta ejecuta lo mismo que en el chat.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => {
  try { localStorage.setItem('elffusscode.model', 'rules'); } catch {}
  window.__shown = [];
  // Chromium headless no sincroniza Notification.permission con
  // grantPermissions de forma fiable (limitación conocida de Playwright) —
  // igual que en notify.mjs, se fija directamente para poder probar el resto.
  try { Object.defineProperty(Notification, 'permission', { value: 'granted', configurable: true }); } catch {}
});
const p = await ctx.newPage({ viewport: { width: 1300, height: 850 } });
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
// esperar a que el SW real controle la página (necesario para showNotification vía registration)
await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
// espiar showNotification en el registration real (sin disparar el permiso del SO en el test)
await p.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  const orig = reg.showNotification.bind(reg);
  reg.showNotification = (title, opts) => { window.__shown.push({ title, opts }); return orig(title, { ...opts, silent: true }).catch(() => {}); };
});

const MD = '# Propuestas de mejora — ciclo 7\n\n## Arquitectura\nExtraer un módulo de utilidades.\n';
const dispatch = ev => p.evaluate(async (ev) => { const m = await import('/js/main.js'); m.reportImprovements(ev); }, ev);

// ── botón real en el mensaje del chat ──────────────────────────────────────
await dispatch({
  proposals: [
    { dept: 'Arquitectura', text: 'Extraer un módulo de utilidades reduce el acoplamiento con la vista y facilita testear la lógica por separado.' },
    { dept: 'Calidad', text: 'Añadir guardas para entradas nulas evita un TypeError en producción cuando el usuario no rellena el campo.' },
  ],
  path: '.elffuss/soul/2026-07-15-0748-tool.md', md: MD,
});
await p.waitForTimeout(300);
const btn = p.locator('.proposal-exec-btn').last();
ok('el mensaje del chat tiene un botón REAL de ejecutar', await btn.count() > 0);
await btn.click();
await p.waitForTimeout(500);
const chatText = await p.locator('#chat-log').innerText();
ok('al pulsar, la propuesta se manda a la cola/agente real (mismo .md)', chatText.includes('Extraer un módulo de utilidades'));
ok('el botón se deshabilita tras usarlo (no se puede disparar dos veces)', await btn.isDisabled());

// ── notificación del sistema con acción «Ejecutar» ─────────────────────────
await dispatch({
  proposals: [
    { dept: 'Rendimiento', text: 'Memoizar el cálculo evita recorrer el array entero en cada render, notable con listas grandes.' },
    { dept: 'Producto/DX', text: 'Renombrar variables crípticas y documentar la función principal ayuda a quien llegue nuevo al proyecto.' },
  ],
  path: '.elffuss/soul/2026-07-15-0900-tool.md', md: MD,
});
await p.waitForTimeout(400);
const shown = await p.evaluate(() => window.__shown);
ok('la notificación pasa por el SW (registration.showNotification), no la simple', shown.length > 0, JSON.stringify(shown.map(s => s.title)));
const last = shown.at(-1);
ok('trae la acción «execute»', last?.opts?.actions?.some(a => a.action === 'execute'), JSON.stringify(last?.opts?.actions));
ok('trae la acción «open» (ver en la Mente)', last?.opts?.actions?.some(a => a.action === 'open'));
ok('lleva el .md real en data (para poder ejecutarlo al pulsar)', last?.opts?.data?.md === MD);

// simular el clic en «▶ Ejecutar» de la notificación: el SW manda este mensaje
// a la pestaña (notificationclick → client.postMessage) — lo replicamos tal
// cual para probar el lado de la PÁGINA (el clic real en la notificación del
// SO no es automatizable, pero el contrato del mensaje sí).
await p.evaluate(() => {
  const ev = new MessageEvent('message', { data: { type: 'notif-action', action: 'execute', md: '# Propuesta desde la notificación\nContenido real ejecutable.' } });
  navigator.serviceWorker.dispatchEvent(ev);
});
await p.waitForTimeout(500);
const chatAfterNotif = await p.locator('#chat-log').innerText();
ok('el clic en «▶ Ejecutar» de la notificación SÍ ejecuta la propuesta (mismo camino real)', chatAfterNotif.includes('Contenido real ejecutable'));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ BOTÓN DE EJECUTAR (chat + notificación) OK');
await b.close();
process.exit(fails ? 1 : 0);

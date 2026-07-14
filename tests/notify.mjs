// Notificaciones del navegador: SOLO saltan cuando el ciclo es sustancioso
// (≥2 propuestas sólidas), NUNCA piden permiso fuera de un gesto del usuario,
// y el panel ⚙ muestra el estado real del permiso.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => {
  try { localStorage.setItem('elffusscode.model', 'rules'); } catch {}
  window.__notifs = []; window.__askedPermission = 0;
  class FakeNotification {
    constructor(title, opts) { window.__notifs.push({ title, body: opts && opts.body }); }
    static permission = 'granted';
    static requestPermission() { window.__askedPermission++; return Promise.resolve('granted'); }
  }
  window.Notification = FakeNotification;
});
const p = await ctx.newPage({ viewport: { width: 1300, height: 850 } });
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

// ── ciclo FLOJO: 1 sola propuesta sólida → NO debe notificar ──
let r = await p.evaluate(async () => {
  const m = await import('/js/main.js');
  window.__notifs.length = 0;
  m.reportImprovements({ proposals: [
    { dept: 'Arquitectura', text: 'No encontré nada relevante que cambiar por ahora.' },
    { dept: 'Calidad', text: 'Sin cambios.' },
    { dept: 'Rendimiento', text: 'Convendría memoizar el cálculo pesado de renderList() para evitar recomputarlo en cada frame, ahorra bastante CPU.' },
    { dept: 'Producto/DX', text: 'ok' },
  ], path: '.elffuss/soul/x.md' });
  return { notifs: window.__notifs.length, noteworthy: m.isNoteworthy };
});
ok('ciclo flojo (1 propuesta sólida) → NO notifica', r.notifs === 0, `${r.notifs} notificaciones`);
const chatAfterWeak = await p.locator('#chat-log').innerText();
ok('pero SÍ se reporta en el chat (visual, siempre)', /Rendimiento/.test(chatAfterWeak));

// ── ciclo BUENO: ≥2 propuestas sólidas → SÍ debe notificar ──
r = await p.evaluate(async () => {
  const m = await import('/js/main.js');
  window.__notifs.length = 0;
  m.reportImprovements({ proposals: [
    { dept: 'Arquitectura', text: 'El módulo utils.js concentra demasiada lógica de negocio; propongo extraerlo en dos ficheros separados por responsabilidad, reduciendo el acoplamiento con la capa de vista.' },
    { dept: 'Calidad', text: 'La función parseInput no valida entradas vacías ni nulas, lo que puede provocar un TypeError en producción; propongo añadir guardas explícitas y dos tests unitarios.' },
    { dept: 'Rendimiento', text: 'ok' },
    { dept: 'Producto/DX', text: 'nada' },
  ], path: '.elffuss/soul/y.md' });
  return { notifs: window.__notifs.length, title: window.__notifs[0]?.title };
});
ok('ciclo BUENO (2+ propuestas sólidas) → SÍ notifica', r.notifs === 1, JSON.stringify(r));
ok('el título de la notificación es correcto', /mejora/.test(r.title || ''), r.title);

// ── nunca pide permiso fuera de un gesto (notify() no debe llamar requestPermission) ──
const asked = await p.evaluate(() => window.__askedPermission);
ok('reportImprovements NUNCA pide permiso (solo lo hace un clic explícito)', asked === 0, `pedido ${asked} veces`);

// ── panel ⚙: el estado de notificaciones se ve, sin botón "Activar" si ya está concedido ──
await p.locator('#activity img').click(); await p.waitForTimeout(1000);
await p.click('#mind-config'); await p.waitForTimeout(300);
const notifTxt = await p.locator('.cfg-notif').innerText();
ok('el panel muestra el permiso CONCEDIDO', /concedidas/.test(notifTxt), notifTxt);
ok('sin botón «Activar» cuando ya está concedido', await p.locator('#cfg-notif-ask').count() === 0);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ NOTIFICACIONES OK — filtro de calidad + sin pedir permiso sin gesto');
await b.close();
process.exit(fails ? 1 : 0);

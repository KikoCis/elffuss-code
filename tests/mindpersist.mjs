// Bug real reportado: el historial de la Mente («≡ historial») vivía SOLO en
// memoria/DOM — al recargar la página (cerrar pestaña, refrescar) se perdía
// todo. Ahora se persiste en IndexedDB y sobrevive a una recarga REAL.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext(); await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1300, height: 850 } });
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

await p.locator('#activity img').click(); await p.waitForTimeout(1000);
await p.evaluate(async () => {
  const m = await import('/js/mind.js');
  m.pushThought('ceo', { type: 'cycle', n: 1, text: 'Ciclo de prueba antes de recargar la página.' });
  m.pushThought('arq', { type: 'open', name: 'Arquitectura' });
  m.pushThought('arq', { type: 'token', text: 'esta línea debe sobrevivir a la recarga de verdad.\n' });
});
await p.waitForTimeout(700); // que el guardado (debounce 400ms) llegue a disco
const before = await p.evaluate(() => document.getElementById('mind-log-body').innerText);
ok('el historial se ve ANTES de recargar', /debe sobrevivir/.test(before), before.slice(0, 60));

// RECARGA REAL de la página (no solo cerrar/abrir la Mente en la misma sesión)
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
await p.locator('#activity img').click(); await p.waitForTimeout(1200);
const after = await p.evaluate(() => document.getElementById('mind-log-body')?.innerText || '');
ok('el historial SOBREVIVE a una recarga real de la página', /debe sobrevivir/.test(after), after.slice(0, 80));
ok('también se conserva el ciclo/evento del CEO', /Ciclo de prueba/.test(after));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ HISTORIAL PERSISTENTE OK — sobrevive a recargar la página');
await b.close();
process.exit(fails ? 1 : 0);

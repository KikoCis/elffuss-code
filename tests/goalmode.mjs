// 🎯 Modo Objetivo: mismo patrón planificador/ejecutor que clonagent — el
// botón Goal convierte el siguiente mensaje en un objetivo, un planificador
// lo descompone en tareas (tarjeta de plan visible), y un ejecutor las va
// cumpliendo una a una con las tools normales, marcando cada estado.
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('   pageerror:', e.message.slice(0, 160)));
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// 1) el botón existe, empieza apagado
ok('el botón 🎯 Goal existe', await p.locator('#btn-goal').count() === 1);
ok('empieza desactivado', !(await p.locator('#btn-goal').evaluate(el => el.classList.contains('on'))));

// 2) activarlo lo enciende (misma mecánica que </> Auto)
await p.click('#btn-goal');
await p.waitForTimeout(100);
ok('un clic lo enciende', await p.locator('#btn-goal').evaluate(el => el.classList.contains('on')));
ok('persiste en localStorage', await p.evaluate(() => localStorage.getItem('elffusscode.goalmode') === '1'));

// 3) mandar un mensaje con Goal activo dispara startGoal (no send normal)
await p.fill('#prompt', 'Crea un resumen de bienvenida del proyecto');
await p.click('#btn-send');

// 4) aparece la tarjeta de plan y llega a completado (planner fijo de rules.js: 2 tareas)
await p.waitForSelector('.plan-card', { timeout: 15000 });
ok('aparece la tarjeta de plan', await p.locator('.plan-card').count() > 0);

await p.waitForFunction(() => {
  const el = document.querySelector('.plan-card .plan-status');
  return el && /completado|con fallos/i.test(el.textContent);
}, null, { timeout: 30000 });

const statusText = await p.locator('.plan-card .plan-status').innerText();
ok('el plan llega a un estado final (completado/con fallos)', /completado|con fallos/i.test(statusText), statusText);

const taskCount = await p.locator('.plan-card .plan-tasks li').count();
ok('el plan tiene las 2 tareas del planificador básico', taskCount === 2, String(taskCount));

const doneCount = await p.locator('.plan-card .plan-tasks li.task-done').count();
ok('al menos una tarea terminó "done" (tool real ejecutada)', doneCount >= 1, String(doneCount));

// la tarea 1 (código.tree por "árbol") y la 2 (code.write real objetivo.txt) deberían dejar rastro de tools reales
ok('se ejecutaron tool-calls reales durante el objetivo', await p.locator('#chat-log .msg.tool').count() > 0);

// 5) el fichero que la tarea 2 debía escribir existe de verdad (code.write real, no solo texto)
const wrote = await p.evaluate(async () => {
  try { const c = await import('/js/tools/code.js'); return (await c.read({ path: 'objetivo.txt' })).length > 0; }
  catch { return false; }
});
ok('la tarea de escritura creó el fichero real (objetivo.txt)', wrote);

// 6) persistencia: recargar y volver a ver la tarjeta con su estado final
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
ok('tras recargar, la tarjeta de plan se reconstruye desde el historial', await p.locator('.plan-card').count() > 0);
const statusAfterReload = await p.locator('.plan-card .plan-status').innerText();
ok('el estado final persiste tras recargar', /completado|con fallos/i.test(statusAfterReload), statusAfterReload);

// 7) apagar Goal vuelve al chat normal
await p.click('#btn-goal');
await p.waitForTimeout(100);
ok('un segundo clic lo apaga', !(await p.locator('#btn-goal').evaluate(el => el.classList.contains('on'))));

await p.screenshot({ path: OUT + '/goalmode.png' });
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ MODO OBJETIVO: planificador + ejecutor OK (mismo patrón que clonagent)');
await b.close();
process.exit(fails ? 1 : 0);

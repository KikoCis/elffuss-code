// Avisos que se entienden y textos en el idioma de la interfaz.
//
//   1. Fallo al cargar el modelo: en palabras de persona («sin conexión…», no
//      «Failed to fetch»), en una región viva, con «Reintentar» que reintenta.
//   2. Skills: sin conexión, «Explorar» lo dice dentro del panel con
//      «Reintentar»; un repo que no vale se dice en línea, sin alert().
//   3. El modo Básico manda a ⚙️ Ajustes → Cerebro, no a un «selector 🧠» que
//      no existe.
//   4. Abierto desde una notificación con la app cerrada (?notif=open), la
//      Mente aparece y la URL queda limpia.
//   5. En inglés: Enviar/Parar, «limpiar» del terminal, Modo Objetivo y
//      Feedback de Ajustes, y la barra de menús, ya no salen en español.
// Nada sale a la red: el modelo y GitHub van interceptados.
//
//   BASE=http://127.0.0.1:8898 node tests/messages-ux.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const FALLA = `window.__cargas = (window.__cargas || 0);
export const name = 'onnx que falla'; export function configure() {}
export async function load() { window.__cargas++; throw new TypeError('Failed to fetch'); }
export async function chat() { return ''; }`;

const b = await chromium.launch();
const errs = [];
const abre = async (locale, query = '') => {
  const ctx = await b.newContext({ locale });
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} window.__alerts = 0; window.alert = () => { window.__alerts++; }; });
  await ctx.route('**/js/providers/onnx.js*', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: FALLA }));
  await ctx.route(/api\.github\.com|raw\.githubusercontent\.com/, r => r.abort());
  await ctx.route(/soundcloud/, r => r.abort());
  const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.goto(BASE + '/?test-opfs' + query, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 20000 });
  return { ctx, p };
};

let { ctx, p } = await abre('es-ES');

// 3 · ayuda del modo Básico
await p.fill('#prompt', 'hola');
await p.press('#prompt', 'Enter');
await p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 8000 });
const ayuda = await p.evaluate(() => document.getElementById('chat-log').innerText);
ok('3 · el modo Básico manda a ⚙️ Ajustes → Cerebro', /Ajustes → Cerebro/.test(ayuda) && !/selector 🧠/.test(ayuda), ayuda.slice(-160));

// 1 · fallo al cargar el modelo
await p.click('#btn-settings');
await p.locator('#settings-panel .model-card', { hasText: 'Qwen3.5-0.8B' }).first().click();
await p.waitForFunction(() => /No pude cargar/.test(document.getElementById('model-progress-text').textContent), null, { timeout: 8000 }).catch(() => {});
const pildora = await p.evaluate(() => ({ txt: document.getElementById('model-progress-text').textContent, rol: document.getElementById('model-progress').getAttribute('role'), reintentar: !!document.querySelector('#model-progress .mp-acciones button') }));
ok('1 · el fallo se dice en palabras de persona, no «Failed to fetch»', /no se pudo descargar/.test(pildora.txt) && !/Failed to fetch/.test(pildora.txt), JSON.stringify(pildora));
ok('1 · la píldora es una región viva con «Reintentar»', pildora.rol === 'status' && pildora.reintentar, JSON.stringify(pildora));
await p.locator('#model-progress .mp-acciones button', { hasText: 'Reintentar' }).click();
await p.waitForTimeout(600);
ok('1 · «Reintentar» vuelve a intentar la carga', await p.evaluate(() => window.__cargas) === 2, String(await p.evaluate(() => window.__cargas)));

// 2 · skills sin conexión y repo que no vale
await p.evaluate(() => document.getElementById('settings-panel').hidden || document.getElementById('btn-settings').click());
await p.evaluate(() => window.elffussClaw.skills && document.getElementById('act-skills').click());
await p.waitForTimeout(500);
await p.locator('#settings-panel .sk-row button', { hasText: 'Explorar' }).first().click();
await p.waitForSelector('#settings-panel .sk-browse .sk-msg', { timeout: 8000 }).catch(() => {});
const skill = await p.evaluate(() => ({ msg: document.querySelector('#settings-panel .sk-browse .sk-msg')?.textContent || '', reintentar: !!document.querySelector('#settings-panel .sk-browse button') }));
ok('2 · sin conexión, «Explorar» lo dice dentro del panel con «Reintentar»', /sin conexión/.test(skill.msg) && skill.reintentar && !/FAILED TO FETCH/.test(skill.msg), JSON.stringify(skill));
await p.locator('#settings-panel input[aria-label="Añadir repo"]').fill('esto no es un repo');
await p.locator('#settings-panel button', { hasText: 'Añadir repo' }).click();
await p.waitForTimeout(300);
const repo = await p.evaluate(() => ({ alerts: window.__alerts, msg: [...document.querySelectorAll('#settings-panel .sk-msg')].map(n => n.textContent).join(' | ') }));
ok('2 · un repo que no vale se dice en línea, sin alert()', repo.alerts === 0 && /⚠️/.test(repo.msg), JSON.stringify(repo));
await ctx.close();

// 4 · desde una notificación
({ ctx, p } = await abre('es-ES', '&notif=open'));
await p.waitForSelector('#mind-overlay', { timeout: 45000 }).catch(() => {});
const notif = await p.evaluate(() => ({ mente: !!document.getElementById('mind-overlay') && getComputedStyle(document.getElementById('mind-overlay')).display !== 'none', url: location.search }));
ok('4 · ?notif=open abre la Mente y limpia la URL', notif.mente && !/notif/.test(notif.url), JSON.stringify(notif));
await ctx.close();

// 5 · en inglés
({ ctx, p } = await abre('en-US'));
await p.click('#btn-settings');
await p.waitForTimeout(400);
const en = await p.evaluate(() => ({
  enviar: document.getElementById('btn-send').title,
  limpiar: document.getElementById('term-clear').textContent,
  menus: [...document.querySelectorAll('#menubar button')].map(b => b.textContent).join(','),
  goal: document.querySelector('#perm-goalmode').closest('label').textContent.trim(),
  tel: document.querySelector('#tel-enabled').closest('label').textContent.trim(),
  enviarFeedback: document.getElementById('tel-send').textContent,
}));
ok('5 · en inglés, nada de lo de antes sale en español', en.enviar === 'Send' && en.limpiar === 'clear' && en.menus === 'File,Edit,View,Git' && /^Treat the next message/.test(en.goal) && /^Automatically send/.test(en.tel) && en.enviarFeedback === 'Send', JSON.stringify(en));
await ctx.close();

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ AVISOS QUE SE ENTIENDEN, EN SU IDIOMA');
await b.close();
process.exit(fails ? 1 : 0);

// Ocultar el explorador (icono de ficheros de la barra de actividad) no puede
// llevarse el editor por delante.
//
// Antes, con el árbol oculto (display:none), el editor y el chat se corrían una
// columna de la rejilla: el editor caía en la de 0 px y desaparecía, el chat
// ocupaba su sitio y la columna del chat se quedaba vacía. Con «chat a toda la
// ventana» a la vez, desaparecía también el chat.
//
//   BASE=http://127.0.0.1:8898 node tests/sidebar-toggle.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES', viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); localStorage.removeItem('elffusscode.chatfull'); } catch {} });
await ctx.route(/soundcloud|huggingface|hf\.co|api\.github|raw\.githubusercontent/, r => r.abort());
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 30000 });
const caja = sel => p.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; }, sel);

const antes = { ed: await caja('#editor-wrap'), chat: await caja('#chat') };
await p.click('#act-files');
await p.waitForTimeout(200);
const oculto = { ed: await caja('#editor-wrap'), chat: await caja('#chat'), arbol: await p.isVisible('#sidebar') };
ok('ocultar el árbol lo oculta', !oculto.arbol);
ok('…y el editor sigue ahí, ocupando el hueco del árbol', oculto.ed.x === 46 && oculto.ed.w > antes.ed.w, JSON.stringify(oculto));
ok('…y el chat se queda en su columna, pegado a la derecha', oculto.chat.x + oculto.chat.w === 1280 && oculto.chat.w === antes.chat.w, JSON.stringify(oculto.chat));
ok('el icono de ficheros dice que el árbol está oculto', await p.evaluate(() => !document.getElementById('act-files').classList.contains('on')));

await p.click('#btn-ancho');
await p.waitForTimeout(200);
const ancho = await caja('#chat');
ok('con el árbol oculto, «chat a toda la ventana» sigue enseñando el chat', ancho.w > 1000, JSON.stringify(ancho));
await p.click('#btn-ancho');
await p.click('#act-files');
await p.waitForTimeout(200);
const vuelta = { ed: await caja('#editor-wrap'), chat: await caja('#chat') };
ok('volver a enseñar el árbol lo deja como estaba', JSON.stringify(vuelta) === JSON.stringify(antes), JSON.stringify(vuelta));
ok('sin errores de página', !errs.length, errs.join(' | '));
await b.close();
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ explorador: ocultar y enseñar sin romper la rejilla');
process.exit(fails ? 1 : 0);

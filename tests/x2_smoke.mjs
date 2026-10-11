// Nivel 2 (código de extensiones en un recinto aparte): prueba de aceptación
// de la parte B1.
//
//   node tests/x2_smoke.mjs            (arranca su propio servidor: tests/lib/x2-server.mjs)
//   node tests/x2_smoke.mjs --update   (reescribe la foto tests/x2-surface.json)
//
// A. Camino por defecto: sin extensiones, con solo nivel 1 y con una
//    extensión de código instalada pero apagada, NO se pide nada del nivel 2.
// B. Encender: el tamaño se enseña ANTES de bajar nada; cancelar no baja nada.
// C. Con extensiones sintéticas: arranque en el otro sitio, integridad (cada
//    fichero una vez), comandos (API de la paleta, F1, atajo F9, atajos
//    reservados), formateo, hover sin imágenes ni enlaces, símbolos (Ir a
//    símbolo), diagnósticos, activeTextEditor definido, el agente sigue
//    escribiendo, Cmd+P/Cmd+S/Ctrl+` de Code siguen siendo de Code, canario
//    básico a 0 visitas, foto de la superficie de la API, y del recinto solo se
//    piden sus dos documentos.
// D. Bundle manipulado: se niega, sin iframe.
// E. ?noext2, ?noext y el interruptor del manifiesto: 0 peticiones del nivel 2.
// F. Apagar la última extensión de código desmonta el recinto y lo que puso.
// G. Controles positivos: sin ninguna CSP el recinto no arranca (autoprueba);
//    sin la del host de extensiones, el mismo canario SÍ llega a la baliza.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './lib/x2-server.mjs';
import { startBeacon } from './lib/beacon.mjs';
import { seed, recordFor, SORT, FMT, HOVER, SYM, DIAG, UI, DENY, NOOP, CANARY } from './lib/x2-fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UPDATE = process.argv.includes('--update');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
let fails = 0, lastStep = 'start';
const ok = (name, c, extra = '') => { lastStep = name.split(' ')[0]; console.log((c ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, { timeout = 20000, every = 150 } = {}) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* reintenta */ } await sleep(every); }
  return v;
}
const L2 = u => /\/vendor\/x2\/|\/js\/ext2\//.test(u);

const srv = await startServer();
const beacon = await startBeacon();
const browser = await chromium.launch({ args: [`--host-resolver-rules=${beacon.resolverRules}`] });
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '../web/js/ext2/vendor-manifest.json'), 'utf8'));

async function freshPage(server = srv) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* — */ } });
  const page = await ctx.newPage();
  const requests = [];
  const errors = [];
  ctx.on('request', r => requests.push(r.url()));
  page.on('pageerror', e => { if (e.message !== 'Canceled') errors.push(String(e.message) + ' @ ' + String(e.stack || '').slice(0, 300) + ' (after ' + lastStep + ')'); });
  await page.goto(server.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const o = await navigator.storage.getDirectory();
    const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
    await w('app.js', 'function zeta() {}\nfunction alpha() {}\n// TODO    fix\nconst  a  =  1;\n');
    await w('fruits.txt', 'pear\napple\nfig\n');
  });
  return { ctx, page, requests, errors };
}
const openIde = async (page, server = srv, query = '?test-opfs') => {
  await page.goto(server.codeOrigin + '/' + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });
};
const open = (page, p) => page.evaluate(async p => { await (await import('/js/ide.js')).openFile(p); }, p);
const value = page => page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue());
const bridgeState = page => page.evaluate(async () => (await import('/js/ext2/bridge.js')).state());
const waitRunning = page => until(async () => { const s = await bridgeState(page); return s.state === 'running' || s.state === 'error' ? s : null; }, { timeout: 60000 });
const sandboxRequests = (server, since = 0) => server.requests.slice(since).filter(r => r.host.startsWith('localhost:')).map(r => r.url.split('?')[0]);

// ── A. camino por defecto ──
{
  const { ctx, page, requests } = await freshPage();
  const since = srv.requests.length;
  requests.length = 0;
  await openIde(page);
  await open(page, 'app.js');
  await sleep(800);
  ok('A1 sin extensiones: 0 peticiones del nivel 2 y 0 al recinto', !requests.some(L2) && sandboxRequests(srv, since).length === 0, requests.filter(L2).join(' '));

  // A2: solo nivel 1 (una extensión activa sin código)
  const lvl1 = recordFor(NOOP, { runs: false });
  delete lvl1.rec.code;
  await page.evaluate(async rec => { const store = await import('/js/ext/store.js'); await store.put(rec, new Map()); }, lvl1.rec);
  requests.length = 0;
  await openIde(page);
  await open(page, 'app.js');
  await sleep(800);
  ok('A2 solo nivel 1: carga js/ext/host.js y nada del nivel 2', requests.some(u => u.includes('/js/ext/host.js')) && !requests.some(L2), requests.filter(L2).join(' '));

  // A3: una extensión de código instalada con su código apagado
  await seed(page, [SORT], { runs: false });
  requests.length = 0;
  const since3 = srv.requests.length;
  await openIde(page);
  await open(page, 'app.js');
  await sleep(800);
  ok('A3 extensión de código apagada: 0 peticiones del nivel 2', !requests.some(L2) && sandboxRequests(srv, since3).length === 0, requests.filter(L2).join(' '));

  // ── B. encender enseña el tamaño ANTES de bajar nada ──
  requests.length = 0;
  const cancel = await page.evaluate(async () => {
    const host = await (await import('/js/ide.js')).loadExt();
    let info = null;
    const r = await host.setRuns('elffuss-test.sort', true, { confirm: i => { info = i; return false; } });
    return { r, info };
  });
  ok('B1 el diálogo recibe el tamaño del bundle (los .gz del manifiesto)', cancel.info && cancel.info.runtimeBytes === manifest.totalGz && cancel.info.runtimeBytes > 1e6, JSON.stringify(cancel.info));
  ok('B2 cancelar: no se enciende y no se baja el bundle', cancel.r === false && !requests.some(u => u.includes('/vendor/x2/')), requests.filter(L2).join(' '));
  const kvRuns = await page.evaluate(async () => (await (await import('/js/db.js')).get('kv', 'extensions')).find(e => e.id === 'elffuss-test.sort')?.runs);
  ok('B3 cancelar deja runs:false en kv', kvRuns === false);
  const since4 = srv.requests.length;
  requests.length = 0;
  const yes = await page.evaluate(async () => { const host = await (await import('/js/ide.js')).loadExt(); return host.setRuns('elffuss-test.sort', true, { confirm: () => true }); });
  const s1 = await waitRunning(page);
  ok('B4 aceptar: el recinto arranca sin recargar', yes === true && s1?.state === 'running', JSON.stringify(s1?.error));
  const vendorReqs = requests.filter(u => u.includes('/vendor/x2/'));
  ok('B5 cada fichero del bundle se pide una vez, del buildId del manifiesto', vendorReqs.length === 3 && manifest.files.every(f => vendorReqs.filter(u => u.endsWith(`/vendor/x2/${manifest.buildId}/${f.name}.gz`)).length === 1), vendorReqs.join(' '));
  ok('B6 del recinto solo sus dos documentos', JSON.stringify([...new Set(sandboxRequests(srv, since4))].sort()) === JSON.stringify(['/x2/v1/exthost-iframe.html', '/x2/v1/sandbox.html']), sandboxRequests(srv, since4).join(' '));
  await ctx.close();
}

// ── C. extensiones sintéticas ──
{
  const { ctx, page, requests, errors } = await freshPage();
  await seed(page, [SORT, FMT, HOVER, SYM, DIAG, UI, DENY, NOOP, CANARY]);
  const since = srv.requests.length;
  requests.length = 0;
  await openIde(page);
  await open(page, 'app.js');
  const s = await waitRunning(page);
  ok('C1 arranca solo con extensiones de código encendidas', s?.state === 'running', JSON.stringify(s?.error));
  const st = await until(async () => { const x = await bridgeState(page); return x.extensions.filter(e => e.state === 'active').length >= 4 ? x : null; }, { timeout: 30000 });
  ok('C2 las extensiones arrancan en el recinto sin errores', st && !st.extensions.some(e => e.state === 'error'), JSON.stringify(st?.extensions.map(e => [e.id, e.state, e.text])));
  // lo que una extensión pide al usuario falla cerrado y no la deja colgada
  const ui = await until(async () => { const x = await page.evaluate(async () => (await import('/js/ext2/bridge.js')).runCommand('x2ui.report')); return x ? JSON.parse(x) : null; }, { timeout: 30000 });
  ok('C2b avisos, diálogo modal, selector y texto: sin respuesta y sin colgarse; portapapeles vacío', !!ui && ui.info === undefined && ui.modal === undefined && ui.pick === undefined && ui.input === undefined && ui.clipboardRead === '', JSON.stringify(ui));
  ok('C3 iframe del recinto en el otro sitio, invisible y sin foco', await page.evaluate(o => { const f = document.getElementById('x2-sandbox'); return !!f && f.src.startsWith(o) && f.getAttribute('sandbox') === 'allow-scripts allow-same-origin' && f.inert && f.getAttribute('allow') === '' && getComputedStyle(f).opacity === '0'; }, srv.sandboxOrigin));
  ok('C4 el recinto no es del sitio de Code', new URL(srv.sandboxOrigin).hostname !== new URL(srv.codeOrigin).hostname);

  // diagnósticos
  const marks = await until(() => page.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; const m = window.monaco.editor.getModelMarkers({ resource: ed.getModel().uri }).filter(x => x.owner.startsWith('x2:')); return m.length ? m.map(x => ({ owner: x.owner, message: x.message, code: x.code, line: x.startLineNumber })) : null; }));
  ok('C5 diagnósticos de la extensión: texto plano, sin destino del código', marks && marks[0].owner === 'x2:x2diag' && marks[0].message === 'x2: TODO found x' && marks[0].code === 'X2001' && marks[0].line === 3, JSON.stringify(marks));

  // formateo (Format Document) y un solo paso de deshacer
  await page.evaluate(async () => { const ed = window.monaco.editor.getEditors()[0]; ed.focus(); await ed.getAction('editor.action.formatDocument').run(); });
  // el formateador de la extensión junta también los espacios del comentario;
  // el de JavaScript de Monaco no toca los comentarios
  const formatted = await until(async () => { const v = await value(page); return v.includes('// TODO fix') && v.includes('const a = 1;') ? v : null; });
  ok('C6 Format Document usa el formateador de la extensión', !!formatted, JSON.stringify(await value(page)));
  await page.evaluate(() => window.monaco.editor.getEditors()[0].trigger('t', 'undo'));
  ok('C7 deshacer el formateo es un solo paso', (await value(page)).includes('// TODO    fix\nconst  a  =  1;'));
  await page.evaluate(() => window.monaco.editor.getEditors()[0].trigger('t', 'redo'));

  // hover hostil
  await page.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.setPosition({ lineNumber: 1, column: 12 }); ed.focus(); ed.trigger('t', 'editor.action.showHover', {}); });
  const hover = await until(() => page.evaluate(() => { const h = [...document.querySelectorAll('.monaco-hover:not(.hidden)')].find(x => x.textContent.includes('x2 hover')); return h ? { text: h.textContent, imgs: h.querySelectorAll('img').length, links: h.querySelectorAll('a[href]').length } : null; }));
  ok('C8 hover: el markdown hostil sale como texto, sin <img> ni enlaces', hover && hover.imgs === 0 && hover.links === 0 && hover.text.includes('![img](http://beacon.test/hover.png)'), JSON.stringify(hover));
  await page.keyboard.press('Escape');

  // símbolos: Ir a símbolo (Cmd+Shift+O y «@» de la paleta usan quickOutline)
  await page.evaluate(async () => { const ed = window.monaco.editor.getEditors()[0]; ed.focus(); await ed.getAction('editor.action.quickOutline').run(); });
  const outline = await until(() => page.evaluate(() => { const r = [...document.querySelectorAll('.quick-input-list .monaco-list-row')].map(x => x.textContent); return r.some(t => t.includes('x2:zeta')) ? r : null; }));
  ok('C9 Ir a símbolo incluye los símbolos de la extensión', !!outline, JSON.stringify(outline));
  await page.keyboard.press('Escape');

  // comandos: API de la paleta, F1, atajo y reservados
  await open(page, 'fruits.txt');
  await page.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 4 }); });
  const entries = await page.evaluate(async () => (await import('/js/ext2/bridge.js')).commands().map(e => ({ id: e.id, label: e.label, hint: e.hint })));
  ok('C10 entradas para la paleta de Code', entries.some(e => e.label === 'X2: Sort Lines (fixture)' && e.hint === 'X2 sort') && entries.some(e => e.label === 'X2: Hello (fixture)'), JSON.stringify(entries));
  const live = await page.evaluate(() => (window.elffussClaw?.commands || []).filter(c => c.x2).map(c => ({ label: c.label, hint: c.hint })));
  ok('C10b están en la lista viva de la paleta (window.elffussClaw.commands)', live.some(e => e.label === 'X2: Sort Lines (fixture)' && e.hint === 'X2 sort'), JSON.stringify(live));
  const ran = await page.evaluate(async () => { await new Promise(r => setTimeout(r, 200)); const e = (await import('/js/ext2/bridge.js')).commands().find(x => x.id === 'x2sort.sortLines'); return e.run(); });
  ok('C11 el comando corre con activeTextEditor definido', ran === 'sorted:3', JSON.stringify(ran));
  ok('C12 el texto queda ordenado y la pestaña sin guardar', await until(async () => (await value(page)) === 'apple\nfig\npear\n') && await page.evaluate(() => document.querySelector('#tabs-bar .tab.active b')?.className === 'dirty'));
  await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
  await page.keyboard.press(`${MOD}+s`);
  const saved = await until(() => page.evaluate(async () => { const o = await navigator.storage.getDirectory(); const t = await (await (await o.getFileHandle('fruits.txt')).getFile()).text(); return t === 'apple\nfig\npear\n' ? t : null; }));
  ok('C13 Cmd+S guarda por el camino de siempre (code.write)', !!saved);
  const f1 = await page.evaluate(() => window.monaco.editor.getEditors()[0].getSupportedActions().filter(a => /:x2:/.test(a.id)).map(a => a.label));
  ok('C14 los comandos salen en F1', f1.includes('X2: Sort Lines (fixture)') && f1.includes('X2: Hello (fixture)'), JSON.stringify(f1));
  await page.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.getModel().setValue('zz\nyy\nxx\n'); ed.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 3 }); ed.focus(); });
  await sleep(200);
  await page.keyboard.press('F9');
  ok('C15 el atajo F9 de la extensión funciona con el foco en el editor', !!(await until(async () => (await value(page)) === 'xx\nyy\nzz\n')));
  // desde la paleta de Code («>»): la fila lleva el nombre de la extensión y al
  // elegirla se cierra la paleta y el comando actúa sobre el editor
  await page.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.getModel().setValue('b\na\n'); ed.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 2 }); });
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, shiftKey: true, bubbles: true })));
  await page.fill('#pal-input', '>sort lines (fixture)');
  const row = await until(() => page.evaluate(() => { const r = [...document.querySelectorAll('#pal-list .pal-item')]; return r.length === 1 ? [r[0].querySelector('.pi-name').textContent, r[0].querySelector('.pi-hint').textContent] : null; }));
  ok('C15b la paleta de Code lista el comando con el nombre de la extensión', !!row && row[0] === 'X2: Sort Lines (fixture)' && row[1] === 'X2 sort', JSON.stringify(row));
  await page.keyboard.press('Enter');
  ok('C15c elegirlo en la paleta la cierra y ordena el editor', !!(await until(async () => (await value(page)) === 'a\nb\n')) && await page.evaluate(() => document.getElementById('palette').hidden), JSON.stringify(await value(page)));
  const skipped = await page.evaluate(async () => (await import('/js/ext2/bridge.js')).state().extensions.find(e => e.id === 'elffuss-test.sort').log.map(l => l.text).join(' | '));
  ok('C16 el atajo reservado Cmd/Ctrl+P de la extensión se salta y se informa', /reserved/.test(skipped), skipped);
  await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
  await page.keyboard.press(`${MOD}+p`);
  ok('C17 Cmd+P con el foco en el editor abre la paleta de Code', !!(await until(() => page.evaluate(() => !document.getElementById('palette').hidden))));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
  await page.keyboard.press('Control+`');
  ok('C18 Ctrl+` sigue abriendo el terminal de Code', !!(await until(() => page.evaluate(() => !document.getElementById('terminal-panel').hidden), { timeout: 5000 })));
  await page.evaluate(() => { document.getElementById('terminal-panel').hidden = true; });

  // el agente escribe: el editor se actualiza y el recinto sigue al día
  await open(page, 'app.js');
  await page.evaluate(async () => { const { TOOLS } = await import('/js/tools/index.js'); await TOOLS['code.write'].run({ path: 'app.js', content: 'function beta() {}\n// b    c\nlet  b  =  2;\n' }); });
  ok('C19 code.write del agente sigue reflejándose en el editor', !!(await until(async () => (await value(page)) === 'function beta() {}\n// b    c\nlet  b  =  2;\n')));
  await page.evaluate(async () => { const ed = window.monaco.editor.getEditors()[0]; ed.focus(); await ed.getAction('editor.action.formatDocument').run(); });
  ok('C20 tras escribir el agente, la extensión trabaja sobre el texto nuevo', !!(await until(async () => (await value(page)) === 'function beta() {}\n// b c\nlet b = 2;\n')), JSON.stringify(await value(page)));
  const readBack = await page.evaluate(async () => (await import('/js/tools/code.js')).read({ path: 'app.js' }));
  ok('C21 code.read lee el fichero, no el editor', readBack === 'function beta() {}\n// b    c\nlet  b  =  2;\n');

  // antes del canario: sus intentos fallidos a propósito sí dejan errores
  const realErrors = errors.slice();
  ok('C22 sin errores de página en todo lo anterior', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  // canario básico: desde el worker de extensiones, ningún canal sale
  beacon.hits.length = 0;
  const report = JSON.parse(await page.evaluate(async port => (await import('/js/ext2/bridge.js')).runCommand('x2canary.report', port), beacon.port) || '[]');
  await sleep(1500);
  const allowed = report.filter(r => r.outcome === 'ALLOWED' && !/^own: /.test(r.detail) && !['caches', 'asExternalUri', 'openExternal', 'clipboard-api'].includes(r.channel));
  ok('C23 canario: cada canal de red del worker bloqueado', report.length >= 15 && allowed.length === 0, JSON.stringify(allowed));
  ok('C24 canario: no ve el almacenamiento de Code (IndexedDB, OPFS)', report.filter(r => ['indexedDB', 'opfs'].includes(r.channel)).every(r => !/SAW CODE/.test(r.detail)), JSON.stringify(report.filter(r => ['indexedDB', 'opfs'].includes(r.channel))));
  ok('C25 canario: openExternal no abre nada; el portapapeles se lee vacío', report.find(r => r.channel === 'openExternal')?.detail === 'refused' && /read 0 chars/.test(report.find(r => r.channel === 'clipboard-api')?.detail || ''), JSON.stringify(report.filter(r => /open|clip/.test(r.channel))));
  ok('C26 baliza: 0 visitas', beacon.hits.length === 0, JSON.stringify(beacon.hits));

  // cortafuegos de RPC: lo que no está en la lista se rechaza, la extensión
  // recibe el error y la página lo cuenta
  const deny = JSON.parse(await page.evaluate(async () => (await import('/js/ext2/bridge.js')).runCommand('x2deny.report')) || '{}');
  ok('C26b guardar desde una extensión: rechazado por el cortafuegos', /does not let extensions call MainThreadWorkspace\.\$saveAll/.test(deny.saveAll || ''), JSON.stringify(deny));
  const dn = await until(async () => { const d = (await bridgeState(page)).denials; return d.top.some(([k]) => k === 'MainThreadWebviewPanels.$createWebviewPanel') ? d : null; });
  ok('C26c la página cuenta los rechazos (webview incluida)', !!dn && dn.n >= 2 && dn.top.some(([k]) => k === 'MainThreadWorkspace.$saveAll'), JSON.stringify(dn));

  // foto de la superficie de la API
  const surface = await page.evaluate(async () => (await import('/js/ext2/bridge.js')).surface());
  const snapFile = path.join(HERE, 'x2-surface.json');
  // fuera los comandos de las pruebas y los internos con nombre aleatorio (__vsc<uuid>)
  const snap = surface ? { actors: surface.actors, overridden: surface.overridden, commands: surface.commands.filter(c => !/^(x2|elffuss)/.test(c) && !/^__vsc[0-9a-f-]{36}$/.test(c)) } : null;
  if (UPDATE && snap) fs.writeFileSync(snapFile, JSON.stringify(snap, null, 1) + '\n');
  const prev = fs.existsSync(snapFile) ? JSON.parse(fs.readFileSync(snapFile, 'utf8')) : null;
  ok('C27 la superficie de la API coincide con tests/x2-surface.json', !!snap && !!prev && JSON.stringify(prev) === JSON.stringify(snap),
    !prev ? 'no snapshot (run with --update)' : snap ? `actors ${Object.keys(snap.actors).length} vs ${Object.keys(prev.actors).length}, commands ${snap.commands.length} vs ${prev.commands.length}` : 'no surface');
  ok('C28 del recinto solo se pidieron sus dos documentos', [...new Set(sandboxRequests(srv, since))].every(u => u === '/x2/v1/sandbox.html' || u === '/x2/v1/exthost-iframe.html'), sandboxRequests(srv, since).join(' '));

  // ── F. apagar la última extensión de código lo desmonta todo ──
  await page.evaluate(async () => {
    const host = await (await import('/js/ide.js')).loadExt();
    for (const e of host.list()) if (e.runs) await host.setRuns(e.id, false);
  });
  const gone = await until(() => page.evaluate(() => !document.getElementById('x2-sandbox')));
  ok('F1 sin extensiones de código, el iframe desaparece', !!gone);
  const leftovers = await page.evaluate(() => {
    const ed = window.monaco.editor.getEditors()[0];
    return { actions: ed.getSupportedActions().filter(a => /:x2:/.test(a.id)).length, markers: window.monaco.editor.getModelMarkers({}).filter(m => m.owner.startsWith('x2:')).length, palette: (window.elffussClaw?.commands || []).filter(c => c.x2).length };
  });
  ok('F2 sin acciones, diagnósticos ni entradas de paleta de extensiones', leftovers.actions === 0 && leftovers.markers === 0 && leftovers.palette === 0, JSON.stringify(leftovers));
  await page.evaluate(async () => { const ed = window.monaco.editor.getEditors()[0]; ed.getModel().setValue('// c    d\nlet  c  =  3;\n'); await ed.getAction('editor.action.formatDocument').run(); });
  await sleep(1500);
  ok('F3 vuelve el formateador de serie (el de la extensión ya no actúa)', (await value(page)) === '// c    d\nlet c = 3;\n', JSON.stringify(await value(page)));
  await ctx.close();
}

// ── D. bundle manipulado ──
{
  const bad = await startServer({ tamper: true });
  const { ctx, page } = await freshPage(bad);
  await seed(page, [NOOP]);
  const since = bad.requests.length;
  await openIde(page, bad);
  const s = await waitRunning(page);
  ok('D1 un .gz manipulado: el nivel 2 se niega (integridad)', s?.state === 'error' && s.error?.code === 'integrity', JSON.stringify(s));
  ok('D2 sin iframe y sin una sola petición al recinto', !(await page.evaluate(() => !!document.getElementById('x2-sandbox'))) && sandboxRequests(bad, since).length === 0);
  await ctx.close();
  await bad.close();
}

// ── E. interruptores ──
for (const q of ['?test-opfs&noext2', '?test-opfs&noext']) {
  const { ctx, page, requests } = await freshPage();
  await seed(page, [NOOP]);
  requests.length = 0;
  await openIde(page, srv, q);
  await open(page, 'app.js');
  await sleep(1500);
  ok(`E ${q.split('&')[1]}: 0 peticiones del nivel 2`, !requests.some(L2), requests.filter(L2).join(' '));
  await ctx.close();
}
{
  const { ctx, page, requests } = await freshPage();
  await ctx.route('**/js/ext2/vendor-manifest.json', async route => {
    const r = await route.fetch();
    const j = await r.json();
    await route.fulfill({ response: r, body: JSON.stringify({ ...j, enabled: false }) });
  });
  await seed(page, [NOOP]);
  requests.length = 0;
  await openIde(page);
  const s = await waitRunning(page);
  ok('E interruptor del manifiesto: parado y sin bajar el bundle', s?.state === 'error' && s.error?.code === 'off' && !requests.some(u => u.includes('/vendor/x2/')), JSON.stringify(s?.error));
  await ctx.close();
}

// ── G. controles positivos: la prueba sabe ver una fuga ──
{
  // sin ninguna CSP, el propio recinto se niega a arrancar (autoprueba)
  const naked = await startServer({ insecure: 'all' });
  const { ctx, page } = await freshPage(naked);
  await seed(page, [NOOP]);
  await openIde(page, naked);
  const s = await waitRunning(page);
  ok('G1 sin CSP en el recinto, su autoprueba no le deja arrancar', s?.state === 'error' && s.error?.code === 'csp', JSON.stringify(s?.error));
  await ctx.close();
  await naked.close();
}
{
  // sin la CSP del host de extensiones, el mismo canario SÍ llega a la baliza
  const open2 = await startServer({ insecure: 'exthost' });
  const { ctx, page } = await freshPage(open2);
  await seed(page, [CANARY]);
  await openIde(page, open2);
  await open(page, 'app.js');
  const s = await waitRunning(page);
  beacon.hits.length = 0;
  let report = [];
  if (s?.state === 'running') {
    await until(async () => (await bridgeState(page)).extensions.some(e => e.state === 'active'), { timeout: 20000 });
    report = JSON.parse(await page.evaluate(async port => (await import('/js/ext2/bridge.js')).runCommand('x2canary.report', port), beacon.port) || '[]');
    await sleep(1500);
  }
  ok('G2 sin la CSP del host de extensiones, el canario llega a la baliza', beacon.hits.length > 0 && report.some(r => r.outcome === 'ALLOWED' && r.channel === 'fetch'), `hits ${beacon.hits.length}, state ${s?.state}`);
  await ctx.close();
  await open2.close();
}

await browser.close();
await beacon.close();
await srv.close();
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

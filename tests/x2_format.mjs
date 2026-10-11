// Formatting with a real web extension: Prettier in Code.
//
//   node tests/x2_format.mjs        (own server; without the pinned .vsix in
//                                     tests/.cache and no network: NOT RUN)
//
// esbenp.prettier-vscode 12.4.0 (pinned, SHA-256 checked) is installed with its
// code through Code's own install path for a .vsix file.
//
//   F1  before it, Format Document uses Monaco's built-in formatter (the
//       reference for F6 and F7)
//   F2  Format Document with Prettier: `const  x = {a:1,b:[1,2,3]}` becomes
//       `const x = { a: 1, b: [1, 2, 3] };`
//   F3  one undo step brings the text back; the tab shows unsaved changes;
//       Cmd+S writes the formatted file to the project
//   F4  Shift+Alt+F formats too
//   F5  {"prettier.semi": false} in its settings changes the output
//   F6  "built-in" as the formatter for javascript: Monaco formats again;
//       back to Prettier
//   F7  its code turned off: the sandbox stops and the built-in formatter is
//       back; turned on again: Prettier formats
//   F8  a race with an agent write: the extension's edit computed on the old
//       text is discarded, the status bar says so, the agent's text stays, and
//       the next format works on the new text
//   F9  the beacon gets nothing, the sandbox site only its two documents, no
//       page errors
import { chromium } from 'playwright';
import { startServer } from './lib/x2-server.mjs';
import { startBeacon } from './lib/beacon.mjs';
import { fetchVsix, PINNED } from './lib/x2-vsix.mjs';

let fails = 0;
const ok = (name, c, extra = '') => { console.log((c ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, { timeout = 20000, every = 150 } = {}) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* reintenta */ } await sleep(every); }
  return v;
}
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

let prettier;
try { prettier = (await fetchVsix({ ...PINNED.find(p => p.name === 'prettier-vscode'), offline: process.env.X2_OFFLINE === '1' })).bytes; }
catch (e) { console.log(`⏭️  NOT RUN x2_format — esbenp.prettier-vscode@12.4.0: ${e.message}`); process.exit(0); }

const UGLY = 'const  x = {a:1,b:[1,2,3]}\n';
const PRETTY = 'const x = { a: 1, b: [1, 2, 3] };\n';
const NOSEMI = 'const x = { a: 1, b: [1, 2, 3] }\n';
// un fichero largo: a Prettier le cuesta más que al agente escribir encima
const BIG = Array.from({ length: 1500 }, (_, i) => `const  v${i} = {k:${i},list:[${i},${i + 1}]}`).join('\n') + '\n';

const srv = await startServer();
const beacon = await startBeacon();
const browser = await chromium.launch({ args: [`--host-resolver-rules=${beacon.resolverRules}`] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* — */ } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { if (e.message !== 'Canceled') errors.push(e.message); });
await page.goto(srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(async ({ UGLY, BIG }) => {
  const o = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('ugly.js', UGLY);
  await w('big.js', BIG);
}, { UGLY, BIG });
await page.goto(srv.codeOrigin + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });

const open = p => page.evaluate(async p => { await (await import('/js/ide.js')).openFile(p); }, p);
const value = () => page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue());
const setValue = v => page.evaluate(v => window.monaco.editor.getEditors()[0].getModel().setValue(v), v);
const readOpfs = name => page.evaluate(async n => { const o = await navigator.storage.getDirectory(); return (await (await o.getFileHandle(n)).getFile()).text(); }, name);
const dirty = () => page.evaluate(() => document.querySelector('#tabs-bar .tab.active b')?.classList.contains('dirty') || false);
const focusEditor = async () => { await page.evaluate(() => window.monaco.editor.getEditors()[0].focus()); await sleep(100); };
const formatDoc = () => page.evaluate(async () => { const ed = window.monaco.editor.getEditors()[0]; ed.focus(); await ed.getAction('editor.action.formatDocument').run(); });
const host = fn => page.evaluate(fn);
const bridgeState = () => page.evaluate(async () => (await import('/js/ext2/bridge.js')).state());
// formatea hasta obtener `want` (la primera vez Prettier carga sus analizadores)
async function formatsTo(want, tries = 20) {
  for (let i = 0; i < tries; i++) {
    await formatDoc();
    if (await until(async () => (await value()) === want, { timeout: 1500 })) return true;
  }
  return false;
}

// ── F1: la referencia, sin extensiones ──
await open('ugly.js');
// (el formateador de serie necesita su worker listo: se reintenta)
let builtin = null;
for (let i = 0; i < 20 && !builtin; i++) {
  await formatDoc();
  builtin = await until(async () => { const v = await value(); return v !== UGLY ? v : null; }, { timeout: 1500 });
}
ok('F1 with no extension, Format Document uses Monaco’s built-in formatter', builtin === NOSEMI, JSON.stringify(builtin));
await setValue(UGLY);

// ── instalar Prettier con su código ──
const id = await page.evaluate(async b64 => {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const h = await (await import('/js/ide.js')).loadExt();
  return (await h.install(new File([u8], 'prettier.vsix'), { withCode: true })).id;
}, Buffer.from(prettier).toString('base64'));
const active = await until(async () => { const s = await bridgeState(); return s.state === 'running' && s.extensions.find(e => e.id === id)?.state === 'active' ? s : null; }, { timeout: 90000 });
ok('Prettier installed with its code, running in the sandbox', !!active, JSON.stringify((await bridgeState()).extensions.map(e => [e.id, e.state, e.text])));

// ── F2–F3 ──
await page.keyboard.press(`${MOD}+KeyS`);
await until(async () => !(await dirty()));
ok('F2 Format Document with Prettier', await formatsTo(PRETTY), JSON.stringify(await value()));
ok('F3 the tab shows unsaved changes', !!(await until(() => dirty())));
await focusEditor();
await page.keyboard.press(`${MOD}+KeyZ`);
ok('F3 one undo step brings the text back', !!(await until(async () => (await value()) === UGLY)), JSON.stringify(await value()));
await page.keyboard.press(`${MOD}+Shift+KeyZ`);
await until(async () => (await value()) === PRETTY);
await page.keyboard.press(`${MOD}+KeyS`);
ok('F3 Cmd+S writes the formatted file to the project', !!(await until(async () => (await readOpfs('ugly.js')) === PRETTY && !(await dirty()))), JSON.stringify(await readOpfs('ugly.js')));

// ── F4: Shift+Alt+F ──
await setValue(UGLY);
let viaKeys = false;
for (let i = 0; i < 10 && !viaKeys; i++) {
  await focusEditor();
  await page.keyboard.press('Shift+Alt+KeyF');
  viaKeys = !!(await until(async () => (await value()) === PRETTY, { timeout: 1500 }));
}
ok('F4 Shift+Alt+F formats with Prettier', viaKeys, JSON.stringify(await value()));

// ── F5: sus ajustes ──
await host(async () => { const h = await (await import('/js/ide.js')).loadExt(); await h.setSettings('esbenp.prettier-vscode', { 'prettier.semi': false }); });
await setValue(UGLY);
ok('F5 {"prettier.semi": false} changes the output', await formatsTo(NOSEMI), JSON.stringify(await value()));
await host(async () => { const h = await (await import('/js/ide.js')).loadExt(); await h.setSettings('esbenp.prettier-vscode', {}); });
await setValue(UGLY);
ok('F5 and without it, the semicolons come back', await formatsTo(PRETTY), JSON.stringify(await value()));

// ── F6: el formateador de serie para javascript, y vuelta ──
await host(async () => { const h = await (await import('/js/ide.js')).loadExt(); await h.setFormatter('esbenp.prettier-vscode', 'javascript', 'builtin'); });
await setValue(UGLY);
await sleep(500);
await formatDoc();
ok('F6 "built-in" for javascript: Monaco formats, as with no extension', !!(await until(async () => (await value()) === builtin, { timeout: 8000 })), JSON.stringify(await value()));
await host(async () => { const h = await (await import('/js/ide.js')).loadExt(); await h.setFormatter('esbenp.prettier-vscode', 'javascript', 'extension'); });
await setValue(UGLY);
ok('F6 back to Prettier', await formatsTo(PRETTY), JSON.stringify(await value()));

// ── F7: su código apagado y encendido ──
await host(async () => { const h = await (await import('/js/ide.js')).loadExt(); await h.setRuns('esbenp.prettier-vscode', false); });
const off = await until(() => page.evaluate(() => !document.getElementById('x2-sandbox')), { timeout: 15000 });
await setValue(UGLY);
await sleep(300);
await formatDoc();
ok('F7 its code off: the sandbox is gone and the built-in formatter is back', !!off && !!(await until(async () => (await value()) === builtin, { timeout: 8000 })), JSON.stringify(await value()));
await host(async () => { const h = await (await import('/js/ide.js')).loadExt(); await h.setRuns('esbenp.prettier-vscode', true, { confirm: async () => true }); });
await until(async () => { const s = await bridgeState(); return s.state === 'running' && s.extensions.find(e => e.id === id)?.state === 'active'; }, { timeout: 90000 });
await setValue(UGLY);
ok('F7 on again: Prettier formats', await formatsTo(PRETTY), JSON.stringify(await value()));

// ── F8: carrera con una escritura del agente ──
// Para que la carrera sea la que importa (el cambio de la extensión llega a la
// página DESPUÉS de que el fichero cambiara), la página se queda ocupada justo
// tras pedir el formateo: el recinto (otro sitio, otro proceso) formatea y
// manda su cambio mientras tanto, y el agente escribe antes de que la página
// lo lea. Sin esa pausa, el propio VS Code del recinto suele tirar el cambio
// viejo, que también es seguro pero no prueba la comprobación de la página.
await open('big.js');
await sleep(500);
const agentText = BIG.replace('const  v0 =', 'const  fromAgent =');
await page.evaluate(async t => {
  document.getElementById('statusbar').textContent = '';
  const bridge = await import('/js/ext2/bridge.js');
  window.__race = bridge.runCommand('prettier.forceFormatDocument');   // Prettier, sobre el texto de ahora
  const end = Date.now() + 3000;
  while (Date.now() < end) { /* la página, ocupada; el recinto, no */ }
  window.monaco.editor.getEditors()[0].getModel().setValue(t);          // lo que hace una escritura del agente al fichero abierto
}, agentText);
await page.evaluate(async t => { await (await import('/js/tools/code.js')).write({ path: 'big.js', content: t }); }, agentText);
await page.evaluate(() => window.__race);
const said = await until(() => page.evaluate(() => { const t = document.getElementById('statusbar').textContent; return /discarded because the file changed meanwhile/.test(t) ? t : null; }), { timeout: 15000 });
await sleep(800);
ok('F8 the edit Prettier computed on the old text is discarded, and the status bar says so', !!said && (await value()) === agentText, JSON.stringify({ said, v: (await value()).slice(0, 60) }));
ok('F8 the agent’s text is in the project', (await readOpfs('big.js')) === agentText);
await open('ugly.js');
await setValue('const  y = {b:2}\n');
ok('F8 the next format works', await formatsTo('const y = { b: 2 };\n'), JSON.stringify(await value()));

// ── F9: privacidad ──
const sbx = [...new Set(srv.requests.filter(r => r.host.startsWith('localhost:')).map(r => r.url.split('?')[0]))];
ok('F9 the sandbox site was asked only for its two documents', sbx.length > 0 && sbx.every(u => u === '/x2/v1/sandbox.html' || u === '/x2/v1/exthost-iframe.html'), sbx.join(' '));
ok('F9 beacon: 0 hits', beacon.hits.length === 0, JSON.stringify(beacon.hits.slice(0, 3)));
ok('F9 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await beacon.close();
await srv.close();
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

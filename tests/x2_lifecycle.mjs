// Life of real web extensions in Code, against the live Open VSX.
//
//   node tests/x2_lifecycle.mjs
//       needs the network; offline (or X2_OFFLINE=1) it is NOT RUN, and
//       tests/x2_manager.mjs runs the same panel flows on the cached packages
//
// Everything goes through the Extensions panel and Code's own requests to
// open-vsx.org (metadata, the published SHA-256, the .vsix). Only the search
// listing is pinned, so the versions under test stay fixed: Tyriar.sort-lines
// 1.9.1 and 1.12.0, esbenp.prettier-vscode 12.3.0 and 12.4.0.
//
//   L0  sort-lines 1.9.1 declares a browser entry its package does not
//       contain: running its code is refused, and nothing is left installed
//   L1  sort-lines 1.12.0, search and detail: what will work, before installing
//   L2  "Install and run its code…": Cancel downloads nothing
//   L3  accept: Code's page downloads it, checks the published SHA-256
//       (pinned too) and starts its code
//   L4  its command runs from the panel and sorts the open file
//   L5  code off and on again without a reload
//   L6  Prettier 12.3.0 the same way; Format Document uses it
//   L7  update to 12.4.0 from the result row: still with its code, still on,
//       with the pinned SHA-256, the old version's files gone, and it formats
//   L8  disabling the extension stops its code (the built-in formatter is
//       back); enabling it brings Prettier back
//   L9  after a reload both are back, running, with what they did
//   L10 uninstall both: no files left in IndexedDB, no sandbox, nothing in kv
//   L11 only Code's page talked to Open VSX; the sandbox site was asked only
//       for its two documents; no page errors
import { chromium } from 'playwright';
import { startServer } from './lib/x2-server.mjs';
import { PINNED, fetchVsix } from './lib/x2-vsix.mjs';

let fails = 0;
const ok = (name, c, extra = '') => { console.log((c ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, { timeout = 30000, every = 200 } = {}) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* reintenta */ } await sleep(every); }
  return v;
}
const API = 'https://open-vsx.org';

// ── ¿hay Open VSX? ──
const live = {};
try {
  if (process.env.X2_OFFLINE === '1') throw new Error('X2_OFFLINE=1');
  for (const [ns, name, v] of [['Tyriar', 'sort-lines', '1.9.1'], ['Tyriar', 'sort-lines', '1.12.0'], ['esbenp', 'prettier-vscode', '12.3.0'], ['esbenp', 'prettier-vscode', '12.4.0']]) {
    const r = await fetch(`${API}/api/${ns}/${name}/${v}`, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'elffuss-code-tests' } });
    if (!r.ok) throw new Error(`${ns}.${name}@${v}: HTTP ${r.status}`);
    const j = await r.json();
    if (!j.files?.download || !j.files?.sha256) throw new Error(`${ns}.${name}@${v}: no download or no published SHA-256`);
    live[`${ns}.${name}@${v}`.toLowerCase()] = j;
  }
} catch (e) {
  console.log(`⏭️  NOT RUN x2_lifecycle — Open VSX not reachable (${e.message}); tests/x2_manager.mjs runs these flows on the cached packages`);
  process.exit(0);
}
const pinnedSha = Object.fromEntries(PINNED.map(p => [`${p.namespace}.${p.name}@${p.version}`.toLowerCase(), p.sha256]));

const srv = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* — */ } });
// solo la lista de la búsqueda va fijada; lo demás sale a Open VSX de verdad
let sortVersion = '1.9.1', prettierVersion = '12.3.0';
const listing = () => [
  { namespace: 'Tyriar', name: 'sort-lines', version: sortVersion, displayName: 'Sort lines', description: 'Sorts lines of text', downloadCount: 1000, verified: true, files: {} },
  { namespace: 'esbenp', name: 'prettier-vscode', version: prettierVersion, displayName: 'Prettier - Code formatter', description: 'Code formatter using prettier', downloadCount: 1000, verified: true, files: {} },
];
await ctx.route(`${API}/api/-/search**`, route => {
  const q = (new URL(route.request().url()).searchParams.get('query') || '').toLowerCase();
  const hits = listing().filter(x => !q || `${x.namespace} ${x.name} ${x.displayName}`.toLowerCase().includes(q));
  return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify({ totalSize: hits.length, offset: 0, extensions: hits }) });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => { if (e.message !== 'Canceled') errors.push(e.message); });
page.on('dialog', d => d.accept());                      // confirmar desinstalar
const outside = [];                                       // peticiones fuera de Code y del CDN de Monaco
ctx.on('request', r => {
  let u;
  try { u = new URL(r.url()); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === 'cdn.jsdelivr.net') return;
  let frame = '';
  let parent = '';
  try { frame = r.frame()?.url() || ''; parent = r.frame()?.parentFrame()?.url() || ''; } catch { frame = '(worker)'; }
  outside.push({ url: u.origin + u.pathname, frame, parent, method: r.method() });
});

await page.goto(srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('fruits.txt', 'pear\napple\nfig\n');
  await w('ugly.js', 'const  x = {a:1,b:[1,2,3]}\n');
});
const openIde = async () => {
  await page.goto(srv.codeOrigin + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });
};
await openIde();
const open = p => page.evaluate(async p => { await (await import('/js/ide.js')).openFile(p); }, p);
const value = () => page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue());
const setValue = v => page.evaluate(v => window.monaco.editor.getEditors()[0].getModel().setValue(v), v);
const selectAll = () => page.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; const m = ed.getModel(); ed.setSelection(m.getFullModelRange()); });
const formatDoc = () => page.evaluate(async () => { const ed = window.monaco.editor.getEditors()[0]; ed.focus(); await ed.getAction('editor.action.formatDocument').run(); });
const panel = async () => { await page.click('#act-ext'); await until(() => page.evaluate(() => !document.getElementById('settings-panel').hidden && !!document.getElementById('ext-panel'))); };
const row = id => page.locator(`#ext-results .ext-row[data-id="${id}"]`);
const installed = id => page.locator(`#ext-installed .ext-row[data-id="${id}"]`);
const search = async q => { await page.fill('#ext-q', q); await page.press('#ext-q', 'Enter'); };
const codeState = id => page.evaluate(id => document.querySelector(`#ext-installed .ext-row[data-id="${id}"] .ext-x2-state`)?.textContent || null, id);
const record = id => page.evaluate(async id => { const h = await (await import('/js/ide.js')).loadExt(); const r = h.list().find(e => e.id === id); return r ? { version: r.version, verified: r.verified, sha256: r.sha256, code: !!r.code, runs: !!r.runs, enabled: r.enabled } : null; }, id);
const idbKeys = prefix => page.evaluate(prefix => new Promise((res, rej) => {
  const r = indexedDB.open('elffuss-code-ext', 1);
  r.onsuccess = () => { const q = r.result.transaction('files').objectStore('files').getAllKeys(); q.onsuccess = () => { res(q.result.filter(k => String(k).startsWith(prefix)).length); r.result.close(); }; q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}), prefix);
const READY = s => s === 'running' || s === 'ready (starts when first used)';
// (un HEAD solo mira lo que pesa, para el consentimiento: no es una descarga)
const downloads = () => outside.filter(o => /\.vsix$/.test(o.url) && o.method !== 'HEAD').map(o => o.url.split('/').pop());
const sizeLookups = () => outside.filter(o => /\.vsix$/.test(o.url) && o.method === 'HEAD').map(o => o.url.split('/').pop());
const SORT = 'tyriar.sort-lines', PRETTIER = 'esbenp.prettier-vscode';
async function sortFromPanel(text, want) {
  await open('fruits.txt');
  await setValue(text);
  await selectAll();
  await panel();
  await installed(SORT).locator('[data-k="cmd:sortLines.sortLines"]').click();
  return until(async () => (await value()) === want);
}
async function formatsTo(want, tries = 20) {
  for (let i = 0; i < tries; i++) {
    await formatDoc();
    if (await until(async () => (await value()) === want, { timeout: 1500 })) return true;
  }
  return false;
}

// ── L0: una versión cuyo paquete no trae su entrada para el navegador ──
await panel();
await search('sort-lines');
await until(async () => (await row('Tyriar.sort-lines').count()) === 1);
await row('Tyriar.sort-lines').locator('.ext-name').click();
await until(async () => (await row('Tyriar.sort-lines').locator('.ext-install-code').count()) === 1);
await row('Tyriar.sort-lines').locator('.ext-install-code').click();
await until(() => page.evaluate(() => !!document.querySelector('#x2-consent')));
await page.click('#x2-consent button:has-text("Install and run code")');
const refused = await until(async () => { const t = await page.textContent('#ext-msg'); return /browser entry is not in the package/i.test(t) ? t : null; }, { timeout: 120000 });
ok('L0 sort-lines 1.9.1 declares a browser entry its package lacks: its code is refused, nothing is installed', !!refused && !(await record(SORT)) && (await idbKeys(SORT + '@')) === 0, String(refused || await page.textContent('#ext-msg')));

// ── L1 ──
sortVersion = '1.12.0';
await openIde();
await panel();
await search('sort-lines');
await until(async () => (await row('Tyriar.sort-lines').count()) === 1);
await row('Tyriar.sort-lines').locator('.ext-name').click();
const det = await until(async () => { const t = await row('Tyriar.sort-lines').locator('.ext-detail').innerText(); return /Runs in Code’s sandbox/.test(t) ? t : null; });
ok('L1 the detail says what will work, before installing', !!det && /No internet; sees only the files you open/.test(det), det);

// ── L2 ──
const before = downloads().length;
await row('Tyriar.sort-lines').locator('.ext-install-code').click();
const consentText = await until(() => page.evaluate(() => document.querySelector('#x2-consent [role="dialog"]')?.textContent || null));
await page.keyboard.press('Escape');
await sleep(800);
ok('L2 Cancel in the consent dialog: nothing downloaded, nothing installed', downloads().length === before && !(await record(SORT)), JSON.stringify(downloads()));
// (aquí la petición HEAD pasa por la intercepción de Playwright, que fija la
// búsqueda, y Open VSX le contesta 403: el diálogo dice entonces que la baja al
// aceptar. Sin intercepción, como en un navegador de verdad, se ve abajo, L2b)
ok('L2 …the dialog opened at once and asked Open VSX for its size (a HEAD request), before anything was downloaded', sizeLookups().includes('Tyriar.sort-lines-1.12.0.vsix')
  && /This extension: (checking its size|\d+\.\d MB|downloaded from Open VSX when you accept)/.test(consentText || ''), JSON.stringify({ heads: sizeLookups(), text: String(consentText).slice(-160) }));
{
  const ctx2 = await browser.newContext();
  await ctx2.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* — */ } });
  const p2 = await ctx2.newPage();
  await p2.goto(srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
  const size = await p2.evaluate(async () => {
    const ovsx = await import('/js/ext/openvsx.js');
    return (await import('/js/ext2/manage.js')).downloadSize(await ovsx.metadata('Tyriar', 'sort-lines', '1.12.0'));
  }).catch(e => String(e.message || e));
  const pinned = PINNED.find(x => x.name === 'sort-lines');
  const want = (await fetchVsix({ ...pinned, offline: true }).catch(() => null))?.bytes?.length;
  ok('L2b in a browser without interception, the size the consent shows comes from Open VSX itself (HEAD) and is the pinned package’s', !!want && size === want, JSON.stringify({ size, want }));
  await ctx2.close();
}

// ── L3 ──
await row('Tyriar.sort-lines').locator('.ext-install-code').click();
await until(() => page.evaluate(() => !!document.querySelector('#x2-consent')));
await page.click('#x2-consent button:has-text("Install and run code")');
const st1 = await until(async () => { const s = await codeState(SORT); return READY(s) ? s : null; }, { timeout: 120000 });
const r1 = await record(SORT);
ok('L3 accepted: Code downloaded 1.12.0 from Open VSX, checked the published SHA-256 (the pinned one) and runs its code', !!st1 && r1?.version === '1.12.0' && r1.verified && r1.code && r1.runs
  && r1.sha256 === pinnedSha['tyriar.sort-lines@1.12.0'] && downloads().includes('Tyriar.sort-lines-1.12.0.vsix') && outside.some(o => o.url.endsWith('Tyriar.sort-lines-1.12.0.sha256')), JSON.stringify({ st1, r1, d: downloads() }));

// ── L4 ──
ok('L4 its command runs from the panel and sorts the open file', !!(await sortFromPanel('pear\napple\nfig', 'apple\nfig\npear')), JSON.stringify(await value()));

// ── L5: apagar y encender su código ──
await panel();
await installed(SORT).locator('[data-k="x2run"]').click();
ok('L5 code off: the extension stays installed, the sandbox goes away', !!(await until(async () => (await codeState(SORT)) === 'off'))
  && !!(await until(() => page.evaluate(() => !document.getElementById('x2-sandbox')))));
await installed(SORT).locator('[data-k="x2run"]').click();
ok('L5 code on again, no reload and no second consent (the runtime is cached)', !!(await until(async () => READY(await codeState(SORT)), { timeout: 60000 }))
  && !(await page.evaluate(() => !!document.querySelector('#x2-consent'))));
ok('L5 …and the command works', !!(await sortFromPanel('d\nc', 'c\nd')), JSON.stringify(await value()));

// ── L6: Prettier 12.3.0 ──
await panel();
await search('prettier');
await until(async () => (await row('esbenp.prettier-vscode').count()) === 1);
await row('esbenp.prettier-vscode').locator('.ext-name').click();
await until(async () => (await row('esbenp.prettier-vscode').locator('.ext-install-code').count()) === 1);
await row('esbenp.prettier-vscode').locator('.ext-install-code').click();
await until(() => page.evaluate(() => !!document.querySelector('#x2-consent')));
await page.click('#x2-consent button:has-text("Install and run code")');
await until(async () => (await codeState(PRETTIER)) === 'running', { timeout: 120000 });
const r3 = await record(PRETTIER);
ok('L6 Prettier 12.3.0 installed with its code, the published SHA-256 checked', r3?.version === '12.3.0' && r3.verified && r3.code && r3.runs, JSON.stringify(r3));
await open('ugly.js');
await setValue('const  x = {a:1,b:[1,2,3]}\n');
ok('L6 Format Document uses Prettier', await formatsTo('const x = { a: 1, b: [1, 2, 3] };\n'), JSON.stringify(await value()));

// ── L7: actualizar a 12.4.0 ──
prettierVersion = '12.4.0';
await panel();
await search('prettier');
const upd = row('esbenp.prettier-vscode').locator('.ext-install');
await until(async () => /Update to 12\.4\.0/.test(await upd.textContent()));
await upd.click();
const r4 = await until(async () => { const r = await record(PRETTIER); return r?.version === '12.4.0' ? r : null; }, { timeout: 120000 });
ok('L7 updated to 12.4.0 with its code, still on, with the pinned SHA-256', !!r4 && r4.verified && r4.code && r4.runs && r4.sha256 === pinnedSha['esbenp.prettier-vscode@12.4.0'], JSON.stringify(r4));
ok('L7 the old version’s files are gone', (await idbKeys(PRETTIER + '@12.3.0/')) === 0);
await until(async () => (await codeState(PRETTIER)) === 'running', { timeout: 60000 });
await open('ugly.js');
await setValue('const  z = {c:3}\n');
ok('L7 …and the new version formats', await formatsTo('const z = { c: 3 };\n'), JSON.stringify(await value()));

// ── L8: desactivar la extensión entera, y volver ──
await panel();
await installed(PRETTIER).locator('.ext-toggle').click();
await until(async () => (await record(PRETTIER))?.enabled === false);
await open('ugly.js');
await setValue('const  x = {a:1}\n');
await sleep(800);
await formatDoc();
ok('L8 disabled: its code stops and the built-in formatter is back', !!(await until(async () => (await value()) === 'const x = { a: 1 }\n', { timeout: 10000 })), JSON.stringify(await value()));
await panel();
await installed(PRETTIER).locator('.ext-toggle').click();
await until(async () => (await record(PRETTIER))?.enabled === true && (await codeState(PRETTIER)) === 'running', { timeout: 60000 });
await open('ugly.js');
await setValue('const  x = {a:1}\n');
ok('L8 enabled again: Prettier formats', await formatsTo('const x = { a: 1 };\n'), JSON.stringify(await value()));

// ── L9: recargar ──
await openIde();
await open('ugly.js');
await setValue('const  y = {b:2}\n');
ok('L9 after a reload Prettier runs and formats', await formatsTo('const y = { b: 2 };\n', 40), JSON.stringify(await value()));
await panel();
await until(async () => READY(await codeState(SORT)), { timeout: 60000 });
ok('L9 …and sort-lines is back too', !!(await sortFromPanel('z\ny', 'y\nz')), JSON.stringify(await value()));

// ── L10: desinstalar ──
await panel();
await installed(SORT).locator('.ext-uninstall').click();
ok('L10 sort-lines uninstalled: no row, no files', !!(await until(async () => (await installed(SORT).count()) === 0)) && (await idbKeys(SORT + '@')) === 0);
ok('L10 the sandbox stays while Prettier runs', await page.evaluate(() => !!document.getElementById('x2-sandbox')));
await installed(PRETTIER).locator('.ext-uninstall').click();
await until(async () => (await installed(PRETTIER).count()) === 0);
const mirror = await page.evaluate(async () => (await import('/js/db.js')).get('kv', 'extensions'));
ok('L10 Prettier uninstalled: no files, no sandbox, nothing in kv', (await idbKeys(PRETTIER + '@')) === 0 && !!(await until(() => page.evaluate(() => !document.getElementById('x2-sandbox'))))
  && Array.isArray(mirror) && !mirror.length, JSON.stringify(mirror));

// ── L11: privacidad ──
const vsx = outside.filter(o => o.url.startsWith(API) || /openvsx|eclipsecontent/.test(o.url));
const notPage = vsx.filter(o => !o.frame.startsWith(srv.codeOrigin));
ok('L11 only Code’s page talked to Open VSX (no request from the sandbox)', vsx.length > 0 && notPage.length === 0, JSON.stringify(notPage.slice(0, 3)));
// Code's own model store: the hidden iframe of the shared broker
// (js/runtime/model-broker.js) that Code's page opens, not level 2
const broker = o => o.url === 'https://models.elffuss.com/' && o.frame === '' && o.parent.startsWith(srv.codeOrigin) && o.method === 'GET';
const strangers = outside.filter(o => !vsx.includes(o) && !broker(o));
ok('L11 and nobody talked to anything else', strangers.length === 0, JSON.stringify(strangers.slice(0, 3)));
const sbx = [...new Set(srv.requests.filter(r => r.host.startsWith('localhost:')).map(r => r.url.split('?')[0]))];
ok('L11 the sandbox site was asked only for its two documents', sbx.length > 0 && sbx.every(u => u === '/x2/v1/sandbox.html' || u === '/x2/v1/exthost-iframe.html'), sbx.join(' '));
ok('L11 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await srv.close();
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

// Commands of a real web extension in Code, and Code's own shortcuts beside it.
//
//   node tests/x2_commands.mjs        (own server; without the pinned .vsix
//                                       in tests/.cache and no network: NOT RUN)
//
// Tyriar.sort-lines 1.12.0 (pinned, SHA-256 checked) is installed with its code
// through Code's own install path for a .vsix file, next to "hostile", a
// synthetic extension built here whose command titles are HTML and whose
// keybindings ask for Code's and the browser's chords and for sort-lines' F9.
//
//   K1  both install with their code and the sandbox runs them
//   K2  Code's palette (Cmd+Shift+P, ">"): sort-lines' commands with its
//       name; choosing one sorts the selection
//   K3  F1 (Monaco's command list): the same commands; running one works
//   K4  F9 with the editor focused sorts the selection: one undo step, the
//       tab shows unsaved changes, Cmd+S writes the file to the project
//   K5  the editor's context menu carries the command sort-lines puts there
//   K6  hostile's chords for Cmd+P, Cmd+Shift+P, Ctrl+`, Cmd+S, F1,
//       Cmd+Shift+O and Cmd+W are not bound, and its F9 loses to sort-lines;
//       the Extensions panel lists each with the reason
//   K7  with both running, Cmd+P, Cmd+Shift+P, Ctrl+`, "@" in the palette,
//       Cmd+Shift+O and Cmd+S do exactly what they do with no extension
//       (the same steps in a profile without extensions)
//   K8  hostile titles stay text in the palette, F1, the context menu and the
//       panel: no element is created and no handler runs
//   K9  the beacon gets nothing, the sandbox site only its two documents, no
//       page errors
import { chromium } from 'playwright';
import { startServer } from './lib/x2-server.mjs';
import { startBeacon } from './lib/beacon.mjs';
import { fetchVsix, PINNED } from './lib/x2-vsix.mjs';
import { zip } from './ext_fixtures.mjs';

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

let sortLines;
try { sortLines = (await fetchVsix({ ...PINNED.find(p => p.name === 'sort-lines'), offline: process.env.X2_OFFLINE === '1' })).bytes; }
catch (e) { console.log(`⏭️  NOT RUN x2_commands — Tyriar.sort-lines@1.12.0: ${e.message}`); process.exit(0); }

// «hostile»: títulos con HTML y atajos que no le tocan
const EVIL_TITLE = '<img src=x onerror="window.__pwned=1">Hostile <b>title</b>';
const hostile = zip(Object.entries({
  'extension/package.json': JSON.stringify({
    name: 'hostile', publisher: 'elffuss-test', version: '1.0.0', displayName: 'Hostile <i>name</i>', license: 'MIT',
    engines: { vscode: '^1.80.0' }, browser: './extension.js', activationEvents: [],
    contributes: {
      commands: [
        { command: 'hostile.run', title: EVIL_TITLE, category: '<svg onload="window.__pwned=2">X2' },
        { command: 'hostile.alt', title: 'Hostile alt' },
        { command: 'hostile.count', title: 'Hostile count' },
      ],
      menus: { 'editor/context': [{ command: 'hostile.run', group: 'z_hostile' }] },
      keybindings: [
        ['cmd+p', 'ctrl+p'], ['cmd+shift+p', 'ctrl+shift+p'], ['ctrl+`', 'ctrl+`'], ['cmd+s', 'ctrl+s'], ['f1', 'f1'],
        ['cmd+shift+o', 'ctrl+shift+o'], ['cmd+w', 'ctrl+w'], ['f9', 'f9'],
      ].map(([mac, key]) => ({ command: 'hostile.run', key, mac }))
        .concat([{ command: 'hostile.alt', key: 'alt+f9', when: 'editorTextFocus' }]),
    },
  }),
  'extension/extension.js': `const vscode = require('vscode');
exports.activate = c => {
  c.subscriptions.push(vscode.commands.registerCommand('hostile.run', () => { globalThis.__hostileRan = (globalThis.__hostileRan || 0) + 1; return 'hostile ran'; }));
  c.subscriptions.push(vscode.commands.registerCommand('hostile.count', () => String(globalThis.__hostileRan || 0)));
  c.subscriptions.push(vscode.commands.registerCommand('hostile.alt', async () => {
    const ed = vscode.window.activeTextEditor;
    if (ed) await ed.edit(b => b.insert(new vscode.Position(0, 0), 'ALT '));
    return 'alt';
  }));
};
`,
}));

const srv = await startServer();
const beacon = await startBeacon();
const browser = await chromium.launch({ args: [`--host-resolver-rules=${beacon.resolverRules}`] });
const errors = [];

async function profile() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); localStorage.setItem('elffusscode.ext.onlyWorks', '0'); } catch { /* — */ } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (e.message !== 'Canceled') errors.push(e.message); });
  page.on('dialog', d => d.dismiss());
  await page.goto(srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const o = await navigator.storage.getDirectory();
    const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
    await w('fruits.txt', 'pear\napple\nfig\n');
    await w('app.js', 'function zeta() {}\nfunction alpha() {}\nclass Beta { gamma() {} }\n');
  });
  return { ctx, page };
}
const openIde = async page => {
  await page.goto(srv.codeOrigin + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });
};
const open = (page, p) => page.evaluate(async p => { await (await import('/js/ide.js')).openFile(p); }, p);
const value = page => page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue());
const setValue = (page, v) => page.evaluate(v => window.monaco.editor.getEditors()[0].getModel().setValue(v), v);
const select = (page, a, b, c, d) => page.evaluate(([a, b, c, d]) => { const ed = window.monaco.editor.getEditors()[0]; ed.setSelection({ startLineNumber: a, startColumn: b, endLineNumber: c, endColumn: d }); ed.focus(); }, [a, b, c, d]);
const readOpfs = (page, name) => page.evaluate(async n => { const o = await navigator.storage.getDirectory(); return (await (await o.getFileHandle(n)).getFile()).text(); }, name);
const dirty = page => page.evaluate(() => document.querySelector('#tabs-bar .tab.active .tab-x')?.classList.contains('dirty') || false);
const bridgeState = page => page.evaluate(async () => (await import('/js/ext2/bridge.js')).state());
const focusEditor = async page => { await page.evaluate(() => window.monaco.editor.getEditors()[0].focus()); await sleep(100); };
async function installFile(page, name, bytes) {
  return page.evaluate(async ({ name, b64 }) => {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const h = await (await import('/js/ide.js')).loadExt();
    return (await h.install(new File([u8], name), { withCode: true })).id;
  }, { name, b64: Buffer.from(bytes).toString('base64') });
}
const closeOverlays = async page => {
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const p = document.getElementById('palette'); if (p) p.hidden = true; });
  await sleep(150);
};

// K7: lo que hacen los atajos de Code, igual con extensiones que sin ellas
async function shortcuts(page) {
  const out = {};
  await open(page, 'app.js');
  await focusEditor(page);
  await page.keyboard.press(`${MOD}+KeyP`);
  out.cmdP = await until(() => page.evaluate(() => { const p = document.getElementById('palette'); return p && !p.hidden ? { open: true, value: document.getElementById('pal-input').value } : null; }), { timeout: 5000 });
  await closeOverlays(page);
  await focusEditor(page);
  await page.keyboard.press(`${MOD}+Shift+KeyP`);
  out.cmdShiftP = await until(() => page.evaluate(() => { const p = document.getElementById('palette'); return p && !p.hidden ? { open: true, value: document.getElementById('pal-input').value } : null; }), { timeout: 5000 });
  await closeOverlays(page);
  await focusEditor(page);
  const termBefore = await page.evaluate(() => document.getElementById('terminal-panel').hidden);
  await page.keyboard.press('Control+Backquote');
  const termAfter = await until(() => page.evaluate(b => (document.getElementById('terminal-panel').hidden !== b ? String(document.getElementById('terminal-panel').hidden) : null), termBefore), { timeout: 5000 });
  out.ctrlBackquote = { before: termBefore, after: termAfter };
  await page.evaluate(() => { const t = document.getElementById('terminal-panel'); if (!t.hidden) document.getElementById('act-term')?.click(); });
  await sleep(200);
  // «@» en la paleta → Ir a símbolo (quickOutline de Monaco)
  await focusEditor(page);
  await page.keyboard.press(`${MOD}+KeyP`);
  await page.waitForSelector('#palette:not([hidden])');
  await page.fill('#pal-input', '@');
  await sleep(200);
  out.atRows = await page.evaluate(() => [...document.querySelectorAll('#palette .pal-item .pi-hint')].map(x => x.textContent));
  await page.keyboard.press('Enter');
  out.atOutline = await until(() => page.evaluate(() => {
    const w = document.querySelector('.quick-input-widget');
    if (!w || w.style.display === 'none') return null;
    const names = [...w.querySelectorAll('.monaco-list-row .label-name')].map(x => x.textContent.trim()).filter(Boolean);
    return names.length ? names.sort() : null;
  }), { timeout: 8000 });
  await page.keyboard.press('Escape');
  await sleep(200);
  await focusEditor(page);
  await page.keyboard.press(`${MOD}+Shift+KeyO`);
  out.cmdShiftO = await until(() => page.evaluate(() => {
    const w = document.querySelector('.quick-input-widget');
    if (!w || w.style.display === 'none') return null;
    const names = [...w.querySelectorAll('.monaco-list-row .label-name')].map(x => x.textContent.trim()).filter(Boolean);
    return names.length ? names.sort() : null;
  }), { timeout: 8000 });
  await page.keyboard.press('Escape');
  await sleep(200);
  // Cmd+S guarda
  await open(page, 'fruits.txt');
  await setValue(page, 'saved-by-shortcut\n');
  await focusEditor(page);
  await page.keyboard.press(`${MOD}+KeyS`);
  out.cmdS = await until(async () => ((await readOpfs(page, 'fruits.txt')) === 'saved-by-shortcut\n' && !(await dirty(page)) ? 'saved' : null), { timeout: 5000 });
  await setValue(page, 'pear\napple\nfig\n');
  await page.keyboard.press(`${MOD}+KeyS`);
  await until(async () => (await readOpfs(page, 'fruits.txt')) === 'pear\napple\nfig\n', { timeout: 5000 });
  return out;
}

// ── sin extensiones: la referencia ──
const plain = await profile();
await openIde(plain.page);
const ref = await shortcuts(plain.page);
await plain.ctx.close();

// ── K1: sort-lines y hostile, con su código ──
const { ctx, page } = await profile();
await openIde(page);
const idSort = await installFile(page, 'sort-lines.vsix', sortLines);
const idHostile = await installFile(page, 'hostile.vsix', hostile);
const st = await until(async () => { const s = await bridgeState(page); return s.state === 'running' && s.commands.length >= 17 ? s : null; }, { timeout: 90000 });
ok('K1 sort-lines and hostile install with their code; the sandbox runs them', !!st && idSort === 'tyriar.sort-lines' && idHostile === 'elffuss-test.hostile',
  JSON.stringify({ state: st?.state, commands: st?.commands?.length, ids: [idSort, idHostile] }));

// ── K2: la paleta de Code ──
await open(page, 'fruits.txt');
await select(page, 1, 1, 3, 4);
await page.keyboard.press(`${MOD}+Shift+KeyP`);
await page.waitForSelector('#palette:not([hidden])');
await page.fill('#pal-input', '>sort lines (descending, case');
const palRows = await until(() => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#palette .pal-item')].map(r => ({ name: r.querySelector('.pi-name').textContent, hint: r.querySelector('.pi-hint').textContent }));
  return rows.length ? rows : null;
}));
ok('K2 Code’s palette lists sort-lines’ command, with the extension’s name', !!palRows && palRows.some(r => r.name === 'Sort lines (descending, case sensitive)' && r.hint === 'Sort lines'), JSON.stringify(palRows));
await page.keyboard.press('Enter');
ok('K2 choosing it sorts the selection (descending)', !!(await until(async () => (await value(page)) === 'pear\nfig\napple\n')), JSON.stringify(await value(page)));

// ── K3: F1 ──
await setValue(page, 'pear\napple\nfig\n');
await select(page, 1, 1, 3, 4);
await page.keyboard.press('F1');
await page.waitForSelector('.quick-input-widget .quick-input-box input', { state: 'visible' });
await page.keyboard.type('Sort lines (ascending, case sensitive)');
const f1Rows = await until(() => page.evaluate(() => {
  const names = [...document.querySelectorAll('.quick-input-widget .monaco-list-row .label-name')].map(x => x.textContent.trim());
  return names.length ? names : null;
}));
ok('K3 F1 lists it too', !!f1Rows && f1Rows.includes('Sort lines (ascending, case sensitive)'), JSON.stringify(f1Rows?.slice(0, 4)));
await page.keyboard.press('Enter');
ok('K3 running it from F1 sorts the selection', !!(await until(async () => (await value(page)) === 'apple\nfig\npear\n')), JSON.stringify(await value(page)));

// ── K4: F9, un paso de deshacer, cambios sin guardar, Cmd+S ──
await setValue(page, 'pear\napple\nfig\n');
await page.keyboard.press(`${MOD}+KeyS`);
await until(async () => !(await dirty(page)));
await select(page, 1, 1, 3, 4);
await page.keyboard.press('F9');
ok('K4 F9 with the editor focused sorts the selection', !!(await until(async () => (await value(page)) === 'apple\nfig\npear\n')), JSON.stringify(await value(page)));
ok('K4 the tab shows unsaved changes', !!(await until(() => dirty(page))));
await focusEditor(page);
await page.keyboard.press(`${MOD}+KeyZ`);
ok('K4 one undo step brings the file back', !!(await until(async () => (await value(page)) === 'pear\napple\nfig\n')), JSON.stringify(await value(page)));
await page.keyboard.press(`${MOD}+Shift+KeyZ`);
await until(async () => (await value(page)) === 'apple\nfig\npear\n');
await page.keyboard.press(`${MOD}+KeyS`);
ok('K4 Cmd+S writes the sorted file to the project, and the tab is clean', !!(await until(async () => (await readOpfs(page, 'fruits.txt')) === 'apple\nfig\npear\n' && !(await dirty(page)))), JSON.stringify(await readOpfs(page, 'fruits.txt')));

// ── K5: menú contextual del editor ──
await focusEditor(page);
const box = await page.locator('#editor .view-lines').boundingBox();
await page.mouse.click(box.x + 40, box.y + 8, { button: 'right' });
// (el menú contextual de Monaco vive en un shadow root: los localizadores de
// Playwright lo atraviesan, querySelector no)
const menu = await until(async () => {
  const items = (await page.locator('.monaco-menu .action-label').allTextContents()).map(t => t.trim()).filter(Boolean);
  return items.length ? { items, imgs: await page.locator('.monaco-menu img, .monaco-menu svg[onload]').count() } : null;
}, { timeout: 8000 });
ok('K5 the editor’s context menu carries sort-lines’ command', !!menu && menu.items.includes('Sort lines (ascending, case sensitive)'), JSON.stringify(menu?.items?.slice(-6)));
ok('K8 …and hostile’s title there is text', !!menu && menu.items.some(t => t.includes('<img src=x')) && menu.imgs === 0, JSON.stringify(menu?.items?.filter(t => /Hostile/.test(t))));
await page.keyboard.press('Escape');

// ── K6: atajos reservados y el conflicto, en el panel ──
const skipped = (await bridgeState(page)).extensions.find(e => e.id === idHostile)?.skipped || [];
const why = k => skipped.find(s => s.key === k)?.why || '';
// la tecla que cuenta en esta plataforma (mac en macOS, key en las demás)
const reserved = ['cmd+p', 'cmd+shift+p', 'ctrl+`', 'cmd+s', 'f1', 'cmd+shift+o', 'cmd+w'].map(k => (process.platform === 'darwin' ? k : k.replace('cmd', 'ctrl')));
ok('K6 hostile’s chords for Code’s and the browser’s shortcuts are not bound', reserved.every(k => /reserved/.test(why(k))), JSON.stringify(skipped));
ok('K6 its F9 loses to sort-lines, which was there first', /conflicts with tyriar\.sort-lines/.test(why('f9')), JSON.stringify(skipped.filter(s => s.key === 'f9')));
await open(page, 'fruits.txt');
await setValue(page, 'b\na\n');
await select(page, 1, 1, 2, 2);
await page.keyboard.press('F9');
ok('K6 so F9 still runs sort-lines', !!(await until(async () => (await value(page)) === 'a\nb\n')), JSON.stringify(await value(page)));
await focusEditor(page);
await page.keyboard.press('Alt+F9');
ok('K6 a chord nobody else has works (hostile’s Alt+F9)', !!(await until(async () => (await value(page)).startsWith('ALT '))), JSON.stringify(await value(page)));
await page.evaluate(() => { if (!(document.getElementById('ext-panel')?.isConnected && !document.getElementById('settings-panel').hidden)) document.getElementById('act-ext').click(); });
const keysRow = page.locator(`#ext-installed .ext-row[data-id="${idHostile}"] .ext-x2-keys`);
await until(async () => (await keysRow.count()) === 1);
await keysRow.locator('summary').click();
const listed = await keysRow.locator('li').allTextContents();
ok('K6 the Extensions panel lists each one with the reason', listed.length === 8 && listed.filter(t => /reserved/.test(t)).length === 7 && listed.some(t => /f9 .*Sort lines|f9 .*tyriar/.test(t)), JSON.stringify(listed));
const panelHostile = await page.evaluate(id => {
  const row = document.querySelector(`#ext-installed .ext-row[data-id="${id}"]`);
  return { text: row?.textContent || '', els: row ? row.querySelectorAll('.ext-x2-cmds img, .ext-x2-cmds svg, .ext-x2-cmds b, .ext-name i').length : -1 };
}, idHostile);
ok('K8 the panel shows hostile’s name and command titles as text', panelHostile.text.includes('Hostile <i>name</i>') && panelHostile.text.includes('<img src=x') && panelHostile.els === 0, JSON.stringify(panelHostile).slice(0, 300));
await page.click('#settings-close').catch(() => {});

// ── K8: títulos hostiles en la paleta y en F1 ──
await open(page, 'fruits.txt');
await focusEditor(page);
await page.keyboard.press(`${MOD}+Shift+KeyP`);
await page.waitForSelector('#palette:not([hidden])');
await page.fill('#pal-input', '>hostile');
const palHostile = await until(() => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#palette .pal-item')];
  return rows.length ? { names: rows.map(r => r.querySelector('.pi-name').textContent), hints: rows.map(r => r.querySelector('.pi-hint').textContent), els: document.querySelectorAll('#palette img, #palette svg, #palette .pal-item b').length } : null;
}));
ok('K8 Code’s palette shows the hostile title and name as text', !!palHostile && palHostile.names.some(n => n.includes(EVIL_TITLE)) && palHostile.hints.includes('Hostile <i>name</i>') && palHostile.els === 0, JSON.stringify(palHostile));
await closeOverlays(page);
await focusEditor(page);
await page.keyboard.press('F1');
await page.waitForSelector('.quick-input-widget .quick-input-box input', { state: 'visible' });
await page.keyboard.type('Hostile');
const f1Hostile = await until(() => page.evaluate(() => {
  const w = document.querySelector('.quick-input-widget');
  const names = [...w.querySelectorAll('.monaco-list-row .label-name')].map(x => x.textContent.trim());
  return names.length ? { names, els: w.querySelectorAll('img, svg[onload]').length } : null;
}));
ok('K8 F1 shows the hostile title as text', !!f1Hostile && f1Hostile.names.some(n => n.includes('<img src=x')) && f1Hostile.els === 0, JSON.stringify(f1Hostile));
await page.keyboard.press('Escape');
ok('K8 no handler from a title ran', !(await page.evaluate(() => window.__pwned)));

// ── K7: los atajos de Code, con las dos en marcha ──
const withExt = await shortcuts(page);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok('K7 Cmd+P opens Code’s file palette, as without extensions', same(withExt.cmdP, ref.cmdP) && withExt.cmdP?.value === '', JSON.stringify([withExt.cmdP, ref.cmdP]));
ok('K7 Cmd+Shift+P opens it on commands (">"), as without extensions', same(withExt.cmdShiftP, ref.cmdShiftP) && withExt.cmdShiftP?.value === '>', JSON.stringify([withExt.cmdShiftP, ref.cmdShiftP]));
ok('K7 Ctrl+` toggles the terminal, as without extensions', same(withExt.ctrlBackquote, ref.ctrlBackquote) && ref.ctrlBackquote.after === 'false', JSON.stringify([withExt.ctrlBackquote, ref.ctrlBackquote]));
ok('K7 "@" in the palette goes to the file’s symbols, as without extensions', same(withExt.atRows, ref.atRows) && same(withExt.atOutline, ref.atOutline) && (ref.atOutline || []).includes('alpha'), JSON.stringify([withExt.atOutline, ref.atOutline]));
ok('K7 Cmd+Shift+O opens the same outline', same(withExt.cmdShiftO, ref.cmdShiftO) && (ref.cmdShiftO || []).includes('zeta'), JSON.stringify([withExt.cmdShiftO, ref.cmdShiftO]));
ok('K7 Cmd+S saves, as without extensions', withExt.cmdS === 'saved' && ref.cmdS === 'saved', JSON.stringify([withExt.cmdS, ref.cmdS]));
const ranCount = await page.evaluate(async () => (await import('/js/ext2/bridge.js')).runCommand('hostile.count'));
ok('K7 none of those chords ran hostile’s command (its counter is 0)', ranCount === '0', String(ranCount));

// ── K9: privacidad ──
const sbx = [...new Set(srv.requests.filter(r => r.host.startsWith('localhost:')).map(r => r.url.split('?')[0]))];
ok('K9 the sandbox site was asked only for its two documents', sbx.length > 0 && sbx.every(u => u === '/x2/v1/sandbox.html' || u === '/x2/v1/exthost-iframe.html'), sbx.join(' '));
ok('K9 beacon: 0 hits', beacon.hits.length === 0, JSON.stringify(beacon.hits.slice(0, 3)));
ok('K9 no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await ctx.close();
await browser.close();
await beacon.close();
await srv.close();
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

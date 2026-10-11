// What the user sees of level 2: the panel's "what will work" lines, the
// "Works in Code" filter, sizes, a phone, the new overlays' roles and keys, and
// that Code looks the same with code extensions running.
//
//   node tests/x2_ux.mjs        (own server; Open VSX mocked with context.route)
//
//   X1  every kind of extension says, before installing, what will work:
//       declarative parts, browser code that runs in the sandbox (with what it
//       brings), "Needs Node", workbench parts that won't appear, why its code
//       can't run (engine, proposed APIs, never activated, failed in the
//       census), and "Tested in Code" or "Not tested in Code yet"; the run
//       button is there, or inert with its reason
//   X2  the "Works in Code" chip: a toggle (aria-pressed), hides what cannot
//       work, says how many it checked, and says Open VSX sees those lookups
//   X3  sizes: the consent dialog shows the runtime's size from the vendor
//       manifest and the extension's own size
//   X4  at 390×844: the panel, the consent dialog and an extension's dialogs
//       fit with no horizontal scroll, and a command runs from the panel
//   X5  roles and keys: the consent and modal dialogs trap Tab, start on
//       Cancel, close on Escape and give the focus back; the quick pick is a
//       combobox with a listbox, arrows move aria-activedescendant, Enter picks
//   X6  the computed styles of 25 of Code's own elements are identical with
//       and without code extensions running (no global CSS clash)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './lib/x2-server.mjs';
import { mockOpenVsx } from './lib/openvsx-mock.mjs';
import { seed, UI, NOOP, SORT } from './lib/x2-fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (name, c, extra = '') => { console.log((c ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, { timeout = 20000, every = 150 } = {}) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* reintenta */ } await sleep(every); }
  return v;
}

// ── manifiestos de prueba: uno por cada caso de «qué funcionará» ──
const base = (name, extra = {}, { namespace = 'elffuss-ux', version = '1.0.0' } = {}) => ({
  namespace, name, version, keywords: ['elffuss-ux'], published: null,
  manifest: { name, publisher: namespace, version, displayName: 'UX ' + name, license: 'MIT', engines: { vscode: '^1.80.0' }, ...extra },
});
const theme = { themes: [{ label: 'T', uiTheme: 'vs-dark', path: './t.json' }] };
const fixtures = [
  base('decl', { contributes: theme }),
  base('webok', { browser: './web.js', contributes: { commands: [{ command: 'w.a', title: 'A' }, { command: 'w.b', title: 'B' }], keybindings: [{ command: 'w.a', key: 'alt+k' }], configuration: { properties: { 'w.one': { type: 'string' }, 'w.two': { type: 'boolean' }, 'w.three': { type: 'number' } } } } }),
  base('nodetheme', { main: './out.js', contributes: theme }),
  base('webviews', { browser: './web.js', contributes: { views: { explorer: [{ id: 'v', name: 'V' }] }, viewsContainers: { activitybar: [{ id: 'c', title: 'C', icon: 'i.svg' }] }, commands: [{ command: 'v.a', title: 'A' }] } }),
  base('webengine', { browser: './web.js', engines: { vscode: '^1.200.0' } }),
  base('webproposals', { browser: './web.js', enabledApiProposals: ['fileSearchProvider'] }),
  base('webnever', { browser: './web.js', activationEvents: ['workspaceContains:**/never.txt'] }),
  // del censo (web/js/ext2/tested.json): una que arranca y una que falla
  base('prettier-vscode', { browser: './dist/web-extension.cjs', displayName: 'Prettier - Code formatter' }, { namespace: 'esbenp', version: '12.4.0' }),
  base('gitlens', { browser: './dist/browser/gitlens.js', displayName: 'GitLens' }, { namespace: 'eamodio', version: '2026.10.90519' }),
];
for (const f of fixtures) f.keywords = ['elffuss-ux'];

const srv = await startServer();
const browser = await chromium.launch();
const errors = [];
async function profile({ width = 1280, height = 860, mock = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* — */ } });
  if (mock) await mockOpenVsx(ctx, fixtures);
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (e.message !== 'Canceled') errors.push(e.message); });
  await page.goto(srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const o = await navigator.storage.getDirectory();
    const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
    await w('fruits.txt', 'pear\napple\nfig\n');
    await w('app.js', 'function zeta() {}\n');
  });
  return { ctx, page };
}
const openIde = async page => {
  await page.goto(srv.codeOrigin + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });
};
const panel = async page => { await page.click('#act-ext'); await until(() => page.evaluate(() => !document.getElementById('settings-panel').hidden && !!document.getElementById('ext-panel'))); };
const search = async (page, q) => { await page.fill('#ext-q', q); await page.press('#ext-q', 'Enter'); };
const row = (page, id) => page.locator(`#ext-results .ext-row[data-id="${id}"]`);

// ── X1: qué funcionará ──
const { ctx, page } = await profile();
await openIde(page);
await panel(page);
await search(page, 'elffuss-ux');
await until(async () => (await page.locator('#ext-results .ext-row').count()) === fixtures.length);
async function detail(id) {
  await row(page, id).locator('.ext-name').click();
  const text = await until(async () => { const t = await row(page, id).locator('.ext-detail').innerText(); return /Licence|License/.test(t) ? t : null; });
  const run = await row(page, id).evaluate(r => { const b = r.querySelector('.ext-install-code'); return b ? { inert: b.getAttribute('aria-disabled') === 'true', title: b.title } : null; });
  return { text: text || '', run };
}
const d = {};
for (const f of fixtures) d[f.name] = await detail(`${f.namespace}.${f.name}`);
ok('X1 declarative only: "Works now (no code)", once, and no run button', /Works now \(no code\): 1 theme/.test(d.decl.text) && !/Applies:/.test(d.decl.text) && !d.decl.run, JSON.stringify(d.decl));
ok('X1 browser code: runs in the sandbox, with what it brings, and "Not tested in Code yet"', /Runs in Code’s sandbox: 2 commands, 1 keybinding, 3 settings\. No internet; sees only the files you open\./.test(d.webok.text)
  && /Not tested in Code yet/.test(d.webok.text) && d.webok.run && !d.webok.run.inert, JSON.stringify(d.webok));
ok('X1 …and nothing contradicts it ("Nothing … can be applied", "needs its code")', !/Nothing in this extension|needs its code/.test(d.webok.text + d.webviews.text + d['prettier-vscode'].text), JSON.stringify(d.webok.text));
ok('X1 Node only: "Needs Node: not available in the browser", and its theme still applies', /Needs Node: not available in the browser\. Only its themes, grammars and snippets apply\./.test(d.nodetheme.text)
  && /Works now \(no code\): 1 theme/.test(d.nodetheme.text) && !d.nodetheme.run, JSON.stringify(d.nodetheme));
ok('X1 workbench parts: "Won’t appear here: views"', /Won’t appear here: views/.test(d.webviews.text) && d.webviews.run && !d.webviews.run.inert, JSON.stringify(d.webviews));
for (const [k, why] of [['webengine', /needs a newer VS Code than 1\.138\.0/], ['webproposals', /uses proposed VS Code APIs/], ['webnever', /nothing in Code starts it/]]) {
  ok(`X1 ${k}: why its code can’t run, and the run button inert with that reason`, why.test(d[k].text) && d[k].run?.inert && why.test(d[k].run.title), JSON.stringify(d[k]));
}
ok('X1 from the census: "Tested in Code: starts, … formatter"', /Tested in Code: starts.*formatter/.test(d['prettier-vscode'].text) && !d['prettier-vscode'].run.inert, JSON.stringify(d['prettier-vscode']));
ok('X1 failed in the census: "doesn’t start here", run button inert', /Tested in Code: doesn’t start here/.test(d.gitlens.text) && d.gitlens.run?.inert && /failed when tested in Code/.test(d.gitlens.run.title), JSON.stringify(d.gitlens).slice(0, 300));

// ── X2: el filtro ──
const chip = page.locator('#ext-works');
ok('X2 the chip is a toggle, off by default', (await chip.getAttribute('aria-pressed')) === 'false' && (await chip.evaluate(b => b.tagName)) === 'BUTTON');
await chip.click();
const filtered = await until(async () => {
  const ids = await page.locator('#ext-results .ext-row').evaluateAll(rs => rs.map(r => r.dataset.id));
  const head = await page.textContent('#ext-results .sk-h').catch(() => '');
  return /checked 9 of 9/.test(head) ? { ids, head } : null;
});
const shouldHide = ['elffuss-ux.webengine', 'elffuss-ux.webproposals', 'elffuss-ux.webnever', 'eamodio.gitlens'];
ok('X2 with the filter on, what cannot work is hidden and it says how many it checked', !!filtered && shouldHide.every(id => !filtered.ids.includes(id))
  && ['elffuss-ux.decl', 'elffuss-ux.webok', 'elffuss-ux.nodetheme', 'esbenp.prettier-vscode'].every(id => filtered.ids.includes(id)), JSON.stringify(filtered));
const rowLines = await page.evaluate(() => [...document.querySelectorAll('#ext-results .ext-row[data-id="elffuss-ux.decl"] .ext-x2-lines div')].map(x => x.textContent));
ok('X2 each row says what will work (here, "Works now (no code): 1 theme")', rowLines.includes('Works now (no code): 1 theme'), JSON.stringify(rowLines));
ok('X2 pressed, and it says Open VSX sees those lookups', (await chip.getAttribute('aria-pressed')) === 'true' && await page.isVisible('#ext-works-note')
  && /Open VSX also sees the manifest lookups/.test(await page.textContent('#ext-works-note')));
await chip.click();
ok('X2 off again: all results back', !!(await until(async () => (await page.locator('#ext-results .ext-row').count()) === fixtures.length)) && !(await page.isVisible('#ext-works-note')));

// ── X3: tamaños ──
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '../web/js/ext2/vendor-manifest.json'), 'utf8'));
const runtimeMb = (manifest.files.reduce((n, f) => n + f.gz, 0) / 1e6).toFixed(1);
await row(page, 'esbenp.prettier-vscode').locator('.ext-install-code').click();
const consent = await until(() => page.evaluate(() => document.querySelector('#x2-consent [role="dialog"]')?.textContent || null));
const censusMb = (JSON.parse(fs.readFileSync(path.join(HERE, '../web/js/ext2/tested.json'), 'utf8')).results['esbenp.prettier-vscode@12.4.0'].bytes / 1e6).toFixed(1);
ok('X3 the consent shows the runtime’s size from the vendor manifest and the extension’s own', !!consent && consent.includes(`Code’s extension runtime: ${runtimeMb} MB`) && consent.includes(`This extension: ${censusMb} MB`), String(consent).slice(0, 400));

// ── X5 (consentimiento): roles, Tab atrapado, foco en Cancelar, Escape devuelve el foco ──
const dlg = await page.evaluate(() => {
  const d = document.querySelector('#x2-consent [role="dialog"]');
  return { modal: d.getAttribute('aria-modal'), labelled: !!document.getElementById(d.getAttribute('aria-labelledby') || '-'), focus: document.activeElement?.textContent };
});
const inside = [];
for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); inside.push(await page.evaluate(() => !!document.activeElement?.closest('#x2-consent'))); }
await page.keyboard.press('Escape');
const back = await until(() => page.evaluate(() => !document.querySelector('#x2-consent') && document.activeElement?.classList.contains('ext-install-code')));
ok('X5 consent: a labelled modal dialog, focus on Cancel, Tab stays inside, Escape closes and the focus goes back', dlg.modal === 'true' && dlg.labelled && dlg.focus === 'Cancel' && inside.every(Boolean) && !!back, JSON.stringify({ dlg, inside, back }));
await ctx.close();

// ── X5 (diálogos de una extensión) y X4 (teléfono) ──
{
  const { ctx, page } = await profile({ width: 390, height: 844, mock: false });
  await seed(page, [UI, SORT]);
  await openIde(page);
  const up = await until(() => page.evaluate(async () => { const s = (await import('/js/ext2/bridge.js')).state(); return s.state === 'running' && s.extensions.find(e => e.id === 'elffuss-test.ui')?.state === 'active'; }), { timeout: 90000 });
  ok('X4 premise: at 390 px the sandbox runs the two fixtures', !!up);
  await page.evaluate(() => { window.__ask = import('/js/ext2/bridge.js').then(b => b.runCommand('x2ui.ask')); });
  const toast = await until(() => page.evaluate(() => {
    const t = [...document.querySelectorAll('#x2-toasts .x2-toast')].find(x => x.textContent.includes('x2 asks'));
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { role: t.getAttribute('role'), left: r.left, right: r.right, w: innerWidth, sw: document.documentElement.scrollWidth };
  }));
  ok('X4 at 390 px a toast fits, with no horizontal scroll; X5 it is a status', !!toast && toast.role === 'status' && toast.left >= 0 && toast.right <= toast.w && toast.sw <= toast.w, JSON.stringify(toast));
  await page.click('#x2-toasts .x2-toast:has-text("x2 asks") .x2-toast-buttons button:has-text("Yes")');
  await until(() => page.evaluate(() => !!document.querySelector('#x2-dialog [role="dialog"]')));
  const modal = await page.evaluate(() => { const d = document.querySelector('#x2-dialog [role="dialog"]'); const r = d.getBoundingClientRect(); return { modal: d.getAttribute('aria-modal'), focus: document.activeElement?.textContent, left: r.left, right: r.right, w: innerWidth, sw: document.documentElement.scrollWidth }; });
  const trapped = [];
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Shift+Tab'); trapped.push(await page.evaluate(() => !!document.activeElement?.closest('#x2-dialog'))); }
  ok('X5 an extension’s modal: aria-modal, focus on Cancel, Shift+Tab stays inside; X4 it fits', modal.modal === 'true' && modal.focus === 'Cancel' && trapped.every(Boolean) && modal.left >= 0 && modal.right <= modal.w && modal.sw <= modal.w, JSON.stringify({ modal, trapped }));
  await page.keyboard.press('Escape');
  const pick = await until(() => page.evaluate(() => {
    const p = document.getElementById('x2-pick');
    if (!p || p.classList.contains('x2-inputbox')) return null;
    const inp = p.querySelector('input'), list = p.querySelector('[role="listbox"]');
    return { combobox: inp.getAttribute('role'), expanded: inp.getAttribute('aria-expanded'), controls: inp.getAttribute('aria-controls') === list?.id, options: list ? list.querySelectorAll('[role="option"]').length : 0, active: inp.getAttribute('aria-activedescendant') };
  }));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const moved = await page.evaluate(() => { const inp = document.querySelector('#x2-pick input'); const a = document.getElementById(inp.getAttribute('aria-activedescendant')); return { label: a?.querySelector('.x2-pick-label')?.textContent, selected: a?.getAttribute('aria-selected') }; });
  await page.keyboard.press('Enter');
  ok('X5 quick pick: a combobox that controls a listbox; the arrows move aria-activedescendant; Enter picks', !!pick && pick.combobox === 'combobox' && pick.expanded === 'true' && pick.controls && pick.options === 3
    && moved.label === 'c' && moved.selected === 'true', JSON.stringify({ pick, moved }));
  await until(() => page.evaluate(() => document.querySelectorAll('#x2-pick .x2-pick-item').length === 3));
  await page.keyboard.press('Escape');
  await until(() => page.evaluate(() => !!document.querySelector('#x2-input input')));
  await page.keyboard.press('Escape');
  const res = JSON.parse(await page.evaluate(() => window.__ask) || '{}');
  ok('X5 the extension got what was chosen: Yes, nothing (Escape), c, nothing, nothing', res.info === 'Yes' && res.modal === undefined && res.pick === 'c' && res.many === undefined && res.input === undefined, JSON.stringify(res));
  // un comando desde el panel, en el teléfono
  await page.evaluate(async () => { await (await import('/js/ide.js')).openFile('fruits.txt'); const ed = window.monaco.editor.getEditors()[0]; ed.setSelection(ed.getModel().getFullModelRange()); });
  // en un teléfono no hay barra de actividad: el panel se abre con «/extensions»
  await page.click('#btn-slash');
  await page.locator('#menu .menu-item', { hasText: '/extensions' }).click();
  await until(() => page.evaluate(() => !!document.getElementById('ext-panel')?.isConnected && !document.getElementById('settings-panel').hidden));
  const runBtn = page.locator('#ext-installed .ext-row[data-id="elffuss-test.sort"] [data-k="cmd:x2sort.sortLines"]');
  await until(async () => (await runBtn.count()) === 1);
  const layout = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth }));
  await runBtn.click();
  ok('X4 at 390 px the panel fits and a command runs from it', layout.sw <= layout.w && !!(await until(() => page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue() === 'apple\nfig\npear\n'))), JSON.stringify(layout));
  await ctx.close();
}

// ── X6: el aspecto de Code, igual con y sin extensiones de código ──
const SELECTORS = ['body', '#ide', '#activity', '#tree', '#tabs-bar', '#tabs-bar .tab', '#tabs-bar .tab.active', '#editor', '#statusbar', '#chat-log',
  '#prompt', '#btn-send', '#conv-tabs .tab', '#palette', '#pal-input', '#palette .pal-item', '#settings-panel', '#ext-panel', '#ext-q', '#ext-results .ext-row',
  '#ext-results .ext-install', '.ext-chip', '.monaco-editor', '.monaco-editor .view-lines', '#act-ext'];
const PROPS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-bottom', 'border-top-width', 'border-top-style', 'border-top-color', 'border-radius', 'display', 'position', 'z-index', 'box-shadow', 'opacity', 'cursor', 'letter-spacing', 'text-transform'];
async function looks(withCode) {
  const { ctx, page } = await profile();
  if (withCode) await seed(page, [NOOP]);
  await openIde(page);
  await page.evaluate(async () => { await (await import('/js/ide.js')).openFile('app.js'); });
  if (withCode) await until(() => page.evaluate(async () => (await import('/js/ext2/bridge.js')).state().state === 'running'), { timeout: 90000 });
  await panel(page);
  await search(page, 'elffuss-ux');
  await until(async () => (await page.locator('#ext-results .ext-row').count()) === fixtures.length);
  const css = await page.evaluate(() => [...document.styleSheets].map(s => s.href || 'inline').filter(h => /ext2\.css/.test(h)).length);
  const panelStyles = await page.evaluate(({ SELECTORS, PROPS }) => Object.fromEntries(SELECTORS.filter(s => !s.includes('pal')).map(s => {
    const e = document.querySelector(s);
    return [s, e ? Object.fromEntries(PROPS.map(p => [p, getComputedStyle(e).getPropertyValue(p)])) : null];
  })), { SELECTORS, PROPS });
  await page.click('#settings-close').catch(() => page.keyboard.press('Escape'));
  await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+KeyP`);
  await page.waitForSelector('#palette:not([hidden])');
  await page.fill('#pal-input', 'a');
  await sleep(300);
  const palStyles = await page.evaluate(({ SELECTORS, PROPS }) => Object.fromEntries(SELECTORS.filter(s => s.includes('pal')).map(s => {
    const e = document.querySelector(s);
    return [s, e ? Object.fromEntries(PROPS.map(p => [p, getComputedStyle(e).getPropertyValue(p)])) : null];
  })), { SELECTORS, PROPS });
  await ctx.close();
  return { styles: { ...panelStyles, ...palStyles }, css };
}
const plain = await looks(false);
const withCode = await looks(true);
const missing = SELECTORS.filter(s => !plain.styles[s]);
const differ = SELECTORS.filter(s => JSON.stringify(plain.styles[s]) !== JSON.stringify(withCode.styles[s]))
  .map(s => s + ': ' + PROPS.filter(p => plain.styles[s]?.[p] !== withCode.styles[s]?.[p]).map(p => `${p} ${plain.styles[s]?.[p]} → ${withCode.styles[s]?.[p]}`).join(', '));
ok('X6 premise: all 25 elements exist, and ext2.css is loaded only with code running', !missing.length && plain.css === 0 && withCode.css > 0, JSON.stringify({ missing, css: [plain.css, withCode.css] }));
ok(`X6 the computed styles of Code’s 25 elements are identical with and without code extensions (${PROPS.length} properties each)`, !differ.length, differ.slice(0, 4).join(' | '));

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
await srv.close();
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

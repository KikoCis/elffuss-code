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
//   X1b "Install" on a result that only brings code, with its details closed:
//       its manifest is read first (no .vsix), the row shows "Install and run
//       its code…" with the focus on it, and the message points at it
//   X2b the filter turned on before any details are opened: rows still say
//       what will work and offer the code button
//   X3  also: "Install without its code" in the consent of a mixed extension,
//       and the dialogs' primary button at 4.5:1 or more
//   X7  where level 2 cannot start (Code served on a host config.js gives no
//       sandbox): the lines say so, the run button is inert with the reason,
//       and the filter hides what only brings code
//   X8  keyboard: F6 and Code's palette reach a notification and come back,
//       focus never falls to the page, a notification without buttons waits
//       while hovered or focused, the quick pick and input box keep Tab inside
//       and close on Escape from their buttons, Space checks with a filter
//   X9  "Block requests for this session": the next request is dropped and
//       the status bar says so, the user's own editor links still ask, the
//       panel shows the block with Unblock
//   X10 "Turn off all extension code" keeps the focus and announces it; the
//       run button names its action, without aria-pressed
//   X4b at 360×640 a long address: title and site in view, the address
//       scrolls in its own box, the site repeated by the buttons; a
//       notification does not cover the chat prompt
//   X11 a tab opened before the sandbox ran is seen by extensions (onLanguage)
//   X12 in Spanish, level 2's texts are Spanish (the keybindings not bound)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './lib/x2-server.mjs';
import { mockOpenVsx } from './lib/openvsx-mock.mjs';
import { seed, UI, NOOP, SORT, FMT } from './lib/x2-fixtures.mjs';

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
  // solo Node y un lenguaje que Monaco ya trae (como Pyrefly): nada se aplica
  base('pyreflike', { main: './out.js', contributes: { languages: [{ id: 'python', aliases: ['Python'], extensions: ['.py'] }] } }),
  // tema Y código para el navegador: el consentimiento ofrece instalarla sin su código
  base('mixedcode', { browser: './web.js', contributes: { ...theme, commands: [{ command: 'm.a', title: 'A' }] } }),
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
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); localStorage.setItem('elffusscode.ext.onlyWorks', '0'); } catch { /* — */ } });
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
const panel = async page => { await page.evaluate(() => { if (!(document.getElementById('ext-panel')?.isConnected && !document.getElementById('settings-panel').hidden)) document.getElementById('act-ext').click(); }); await until(() => page.evaluate(() => !document.getElementById('settings-panel').hidden && !!document.getElementById('ext-panel'))); };
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
  const install = await row(page, id).evaluate(r => { const b = r.querySelector('.ext-install'); return b ? { inert: b.getAttribute('aria-disabled') === 'true', title: b.title } : null; });
  return { text: text || '', run, install };
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
ok('X1 proposed APIs: it runs, with a warning, and the run button works', /Runs in Code’s sandbox/.test(d.webproposals.text) && /Uses proposed VS Code APIs, which Code doesn’t turn on: some of its features may fail\./.test(d.webproposals.text)
  && !/can’t run here/.test(d.webproposals.text) && d.webproposals.run && !d.webproposals.run.inert, JSON.stringify(d.webproposals));
ok('X1 Node with only a language Monaco already has (like Pyrefly): "Needs Node", no "Works now", one line saying nothing applies, Install inert',
  /Needs Node: not available in the browser\./.test(d.pyreflike.text) && !/Works now|Only its themes/.test(d.pyreflike.text) && !d.pyreflike.run
  && d.pyreflike.install?.inert && /Nothing in this extension can be applied here/.test(d.pyreflike.install.title), JSON.stringify(d.pyreflike));
for (const [k, why] of [['webengine', /needs a newer VS Code than 1\.138\.0/], ['webnever', /nothing in Code starts it/]]) {
  ok(`X1 ${k}: why its code can’t run, and the run button inert with that reason`, why.test(d[k].text) && d[k].run?.inert && why.test(d[k].run.title), JSON.stringify(d[k]));
}
ok('X1 from the census: "Tested in Code: starts, … formatter"', /Tested in Code: starts.*formatter/.test(d['prettier-vscode'].text) && !d['prettier-vscode'].run.inert, JSON.stringify(d['prettier-vscode']));
ok('X1 failed in the census: "doesn’t start here", run button inert', /Tested in Code: doesn’t start here/.test(d.gitlens.text) && d.gitlens.run?.inert && /failed when tested in Code/.test(d.gitlens.run.title), JSON.stringify(d.gitlens).slice(0, 300));

// ── X2: el filtro ──
const chip = page.locator('#ext-works');
ok('X2 the chip is a toggle, off by default', (await chip.getAttribute('aria-pressed')) === 'false' && (await chip.evaluate(b => b.tagName)) === 'BUTTON');
await chip.click();
const filtered = await until(async () => {
  const ids = await page.locator('#ext-results .ext-row').evaluateAll(rs => rs.filter(r => !r.hidden).map(r => r.dataset.id));
  const head = await page.textContent('#ext-results .sk-h').catch(() => '');
  return new RegExp(`checked ${fixtures.length} of ${fixtures.length}`).test(head) ? { ids, head } : null;
});
const shouldHide = ['elffuss-ux.webengine', 'elffuss-ux.webnever', 'eamodio.gitlens', 'elffuss-ux.pyreflike'];
ok('X2 with the filter on, what cannot work is hidden and it says how many it checked', !!filtered && shouldHide.every(id => !filtered.ids.includes(id))
  && ['elffuss-ux.decl', 'elffuss-ux.webok', 'elffuss-ux.nodetheme', 'esbenp.prettier-vscode', 'elffuss-ux.webproposals', 'elffuss-ux.mixedcode'].every(id => filtered.ids.includes(id)), JSON.stringify(filtered));
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
// una con tema y código: el consentimiento ofrece instalarla sin su código (no «solo temas y snippets»)
await row(page, 'elffuss-ux.mixedcode').locator('.ext-install-code').click();
const mixedButtons = await until(() => page.evaluate(() => { const d = document.querySelector('#x2-consent [role="dialog"]'); return d ? [...d.querySelectorAll('button')].map(b => b.textContent) : null; }));
ok('X3 consent of an extension with a theme and code: "Install without its code", "Install and run code"', JSON.stringify(mixedButtons) === JSON.stringify(['Cancel', 'Install without its code', 'Install and run code']), JSON.stringify(mixedButtons));
await page.keyboard.press('Escape');
// el botón primario de los diálogos: texto oscuro sobre el degradado (WCAG 1.4.3, 4,5:1)
await row(page, 'elffuss-ux.mixedcode').locator('.ext-install-code').click();
const contrast = await until(() => page.evaluate(() => {
  const b = document.querySelector('#x2-consent .x2-btn.x2-primary');
  if (!b) return null;
  const cs = getComputedStyle(b);
  const rgb = s => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
  const lum = ([r, g, bl]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); };
  const ends = (cs.backgroundImage.match(/rgba?\([^)]*\)/g) || []).map(rgb);
  const fg = lum(rgb(cs.color));
  const ratio = c => { const l = lum(c); return (Math.max(l, fg) + 0.05) / (Math.min(l, fg) + 0.05); };
  return { color: cs.color, ends: ends.length, ratios: ends.map(c => +ratio(c).toFixed(2)) };
}));
ok('X3 the dialogs’ primary button: at least 4.5:1 against both ends of the gradient', !!contrast && contrast.ends >= 2 && contrast.ratios.every(r => r >= 4.5), JSON.stringify(contrast));
await page.keyboard.press('Escape');
await ctx.close();

// ── X2b: el filtro encendido ANTES de abrir ningún detalle: las filas dicen igual qué funcionará ──
{
  const { ctx, page } = await profile();
  await openIde(page);
  await panel(page);
  await page.click('#ext-works');
  await search(page, 'elffuss-ux');
  const rows2 = await until(async () => {
    const head = await page.textContent('#ext-results .sk-h').catch(() => '');
    if (!new RegExp(`checked ${fixtures.length} of ${fixtures.length}`).test(head)) return null;
    await sleep(300);
    return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#ext-results .ext-row')].map(r => [r.dataset.id, {
      lines: [...r.querySelectorAll('.ext-x2-lines div')].map(x => x.textContent), code: !!r.querySelector('.ext-install-code'), opened: !r.querySelector('.ext-detail').hidden,
    }])));
  });
  ok('X2b filter first: each row says what will work and offers "Install and run its code…" without opening its details', !!rows2 && !rows2['elffuss-ux.webok']?.opened
    && rows2['elffuss-ux.webok']?.lines.some(l => /^Runs in Code’s sandbox/.test(l)) && rows2['elffuss-ux.webok'].code && rows2['esbenp.prettier-vscode']?.code
    && rows2['elffuss-ux.decl']?.lines.includes('Works now (no code): 1 theme') && !rows2['elffuss-ux.decl'].code, JSON.stringify(rows2));
  await ctx.close();
}

// ── X1b: «Instalar» en una que solo trae código, sin abrir su detalle ──
{
  const { ctx, page } = await profile();
  const log = [];
  ctx.on('request', r => { if (/open-vsx\.org/.test(r.url())) log.push(r.method() + ' ' + new URL(r.url()).pathname); });
  const l2 = [];
  page.on('request', r => { if (/\/js\/ext2\//.test(r.url())) l2.push(new URL(r.url()).pathname); });
  await openIde(page);
  await panel(page);
  await search(page, 'elffuss-ux');
  await until(async () => (await page.locator('#ext-results .ext-row').count()) === fixtures.length);
  // un tema: su manifiesto dice que algo se aplica y se instala sin cargar nada del nivel 2
  await row(page, 'elffuss-ux.decl').locator('.ext-install').click();
  const declMsg = await until(() => page.evaluate(() => document.getElementById('ext-msg')?.textContent || null));
  ok('X1b Install on a theme reads its manifest and goes on to install it, without loading anything of level 2', l2.length === 0 && log.some(l => /elffuss-ux\/decl\/1\.0\.0\/file\/package\.json$/.test(l)) && !!declMsg,
    JSON.stringify({ l2, declMsg }));
  await row(page, 'elffuss-ux.webok').locator('.ext-install').click();
  const after = await until(() => page.evaluate(() => {
    const r = [...document.querySelectorAll('#ext-results .ext-row')].find(x => x.dataset.id === 'elffuss-ux.webok');
    const code = r?.querySelector('.ext-install-code');
    return code ? { focused: document.activeElement === code, msg: document.getElementById('ext-msg')?.textContent, role: document.getElementById('ext-msg')?.getAttribute('role'), buttons: [...r.querySelectorAll('.ext-actions button')].map(b => b.textContent) } : null;
  }));
  ok('X1b Install on a code-only result: the row now offers "Install and run its code…", with the focus on it, and the message points at it',
    !!after && after.focused && /It only brings code: use “Install and run its code…”/.test(after.msg) && after.buttons.includes('Install and run its code…'), JSON.stringify(after));
  ok('X1b …and nothing was downloaded to find that out (only its manifest)', !log.some(l => /\.vsix$/.test(l)) && log.some(l => /package\.json$/.test(l)), JSON.stringify(log));
  await ctx.close();
}

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

// ── X7: donde el nivel 2 no puede arrancar: Code en un host sin recinto en
// config.js (aquí «code.localhost», que el navegador trata como contexto
// seguro y resuelve a sí mismo; code.elffuss.com sí tiene el suyo,
// x2.utopiaia.com) ──
{
  const alias = 'code.localhost';
  const srv2 = await startServer({ codeAliases: [alias] });
  const origin2 = `http://${alias}:${srv2.port}`;
  const b2 = browser;
  const ctx2 = await b2.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx2.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); localStorage.setItem('elffusscode.ext.onlyWorks', '0'); } catch { /* — */ } });
  await mockOpenVsx(ctx2, fixtures);
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => { if (e.message !== 'Canceled') errors.push('X7: ' + e.message); });
  await p2.goto(origin2 + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });
  const rt = await p2.evaluate(async () => (await import('/js/ext2/vendor.js')).runtimeInfo());
  const premise = await p2.evaluate(async () => { const c = await import('/js/ext2/config.js'); return c.sandboxOrigin(location) === null && c.sandboxOrigin({ hostname: 'code.elffuss.com', origin: 'https://code.elffuss.com', port: '' }) === 'https://x2.utopiaia.com'; });
  ok('X7 premise: Code on a host config.js gives no sandbox (code.elffuss.com has x2.utopiaia.com): level 2 is not available on this site', rt.available === false && rt.reason === 'site' && premise, JSON.stringify(rt));
  await panel(p2);
  await search(p2, 'elffuss-ux');
  await until(async () => (await p2.locator('#ext-results .ext-row').count()) === fixtures.length);
  const r7 = id => p2.locator(`#ext-results .ext-row[data-id="${id}"]`);
  await r7('elffuss-ux.webok').locator('.ext-name').click();
  const t7 = await until(async () => { const t = await r7('elffuss-ux.webok').locator('.ext-detail').innerText(); return /Licence|License/.test(t) ? t : null; });
  const run7 = await r7('elffuss-ux.webok').evaluate(r => { const b = r.querySelector('.ext-install-code'); return b ? { inert: b.getAttribute('aria-disabled') === 'true', title: b.title } : null; });
  ok('X7 there, a code-only extension says its code can’t run on this site (not "Runs in Code’s sandbox"), and its run button is inert with that reason',
    /Its code can’t run here\. Not available on this site yet: the sandbox needs its own domain\./.test(t7 || '') && !/Runs in Code’s sandbox/.test(t7 || '')
    && run7?.inert && /Not available on this site yet/.test(run7.title), JSON.stringify({ t7, run7 }));
  await p2.click('#ext-works');
  const f7 = await until(async () => {
    const head = await p2.textContent('#ext-results .sk-h').catch(() => '');
    return new RegExp(`checked ${fixtures.length} of ${fixtures.length}`).test(head) ? p2.locator('#ext-results .ext-row').evaluateAll(rs => rs.filter(r => !r.hidden).map(r => r.dataset.id)) : null;
  });
  ok('X7 …and the Works in Code filter hides what only brings code, keeping what applies without it', !!f7 && !f7.includes('elffuss-ux.webok') && !f7.includes('esbenp.prettier-vscode')
    && f7.includes('elffuss-ux.decl') && f7.includes('elffuss-ux.mixedcode'), JSON.stringify(f7));
  await ctx2.close();
  await srv2.close();
}

// ── X8: los avisos y el selector, con el teclado ──
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const bridgeRun = (page, cmd, arg, slot) => page.evaluate(([cmd, arg, slot]) => { window[slot] = import('/js/ext2/bridge.js').then(b => b.runCommand(cmd, arg === null ? undefined : [arg])); }, [cmd, arg ?? null, slot]);
const runningWith = (page, id) => until(() => page.evaluate(async id => { const s = (await import('/js/ext2/bridge.js')).state(); return s.state === 'running' && s.extensions.find(e => e.id === id)?.state === 'active'; }, id), { timeout: 90000 });
{
  const { ctx, page } = await profile({ mock: false });
  await seed(page, [UI, SORT]);
  await openIde(page);
  ok('X8 premise: the sandbox runs the UI fixture', !!(await runningWith(page, 'elffuss-test.ui')));
  await page.evaluate(async () => { await (await import('/js/ide.js')).openFile('fruits.txt'); window.monaco.editor.getEditors()[0].focus(); });
  const inEditor = () => page.evaluate(() => !!document.activeElement?.closest('#editor'));
  const toastWith = text => until(() => page.evaluate(text => [...document.querySelectorAll('#x2-toasts .x2-toast')].some(x => x.textContent.includes(text)), text));
  // F6: del editor al aviso y de vuelta
  await bridgeRun(page, 'x2ui.question', null, '__q');
  await toastWith('x2 question');
  const hint = await page.evaluate(() => [...document.querySelectorAll('#x2-toasts .x2-toast')].find(x => x.textContent.includes('x2 question'))?.querySelector('.x2-sr')?.textContent || '');
  ok('X8 a notification that waits for an answer tells screen readers how to reach it (F6)', /Press F6 to reach its buttons/.test(hint), hint);
  const start = await inEditor();
  await page.keyboard.press('F6');
  const f1 = await page.evaluate(() => (document.activeElement?.closest('#x2-toasts') ? document.activeElement.textContent : null));
  await page.keyboard.press('F6');
  const back1 = await inEditor();
  await page.keyboard.press('F6');
  await page.keyboard.press('Tab');
  const f2 = await page.evaluate(() => document.activeElement?.textContent);
  await page.keyboard.press('Enter');
  const ans1 = await page.evaluate(() => window.__q);
  const back2 = await until(inEditor);
  ok('X8 F6 from the editor reaches the notification’s buttons, F6 again goes back; answering returns the focus to the editor', start && f1 === 'Keep' && back1 && f2 === 'Drop' && ans1 === 'Drop' && !!back2,
    JSON.stringify({ start, f1, back1, f2, ans1, back2 }));
  // la paleta de Code: «Extensiones: ir al aviso», solo mientras hay uno
  await bridgeRun(page, 'x2ui.question', null, '__q2');
  await toastWith('x2 question');
  await page.keyboard.press(`${MOD}+Shift+KeyP`);
  await page.waitForSelector('#palette:not([hidden])');
  await page.fill('#pal-input', '>go to the notification');
  const palRow = await until(() => page.evaluate(() => { const r = document.querySelector('#palette .pal-item'); return r ? r.querySelector('.pi-name').textContent + ' | ' + r.querySelector('.pi-hint').textContent : null; }));
  await page.keyboard.press('Enter');
  const f3 = await until(() => page.evaluate(() => (document.activeElement?.closest('#x2-toasts') ? document.activeElement.textContent : null)));
  await page.keyboard.press('Escape');
  const ans2 = await page.evaluate(() => window.__q2);
  const notBody = await until(() => page.evaluate(() => document.activeElement && document.activeElement !== document.body));
  ok('X8 Code’s palette offers "Extensions: Go to the notification" (F6) while one is shown; Escape closes the notification and the focus does not fall to the page',
    palRow === 'Extensions: Go to the notification | F6' && f3 === 'Keep' && ans2 === 'undefined' && !!notBody, JSON.stringify({ palRow, f3, ans2, notBody }));
  await page.keyboard.press(`${MOD}+Shift+KeyP`);
  await page.waitForSelector('#palette:not([hidden])');
  await page.fill('#pal-input', '>go to the notification');
  await sleep(300);
  const gone = await page.evaluate(() => [...document.querySelectorAll('#palette .pal-item .pi-name')].some(x => x.textContent === 'Extensions: Go to the notification'));
  await page.keyboard.press('Escape');
  ok('X8 …and the entry goes away with the last notification', !gone);
  // un aviso sin botones: no se va mientras el ratón o el foco están en él
  await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
  await bridgeRun(page, 'x2ui.note', null, '__n');
  await toastWith('x2 note');
  const note = page.locator('#x2-toasts .x2-toast', { hasText: 'x2 note' });
  await note.hover();
  await sleep(10500);
  const whileHovered = await note.count();
  await page.keyboard.press('F6');
  await page.mouse.move(5, 5);
  await sleep(10500);
  const whileFocused = await note.count();
  const onClose = await page.evaluate(() => document.activeElement?.classList.contains('x2-toast-close'));
  await page.keyboard.press('Enter');
  const noteRes = await page.evaluate(() => window.__n);
  const back3 = await until(inEditor);
  ok('X8 a notification without buttons stays while hovered or focused (its 9 s pause), and closing it gives the focus back to the editor',
    whileHovered === 1 && whileFocused === 1 && onClose && noteRes === 'closed' && !!back3, JSON.stringify({ whileHovered, whileFocused, onClose, noteRes, back3 }));
  // el selector y el cuadro de texto: Tab no sale, Escape desde sus botones, Espacio con filtro
  await bridgeRun(page, 'x2ui.ask', null, '__ask');
  await page.click('#x2-toasts .x2-toast:has-text("x2 asks") .x2-toast-buttons button:has-text("Yes")');
  await until(() => page.evaluate(() => !!document.querySelector('#x2-dialog [role="dialog"]')));
  await page.keyboard.press('Escape');
  await until(() => page.evaluate(() => { const p = document.getElementById('x2-pick'); return p && !p.classList.contains('x2-inputbox') && !p.querySelector('[aria-multiselectable]'); }));
  const where = () => page.evaluate(() => { const a = document.activeElement; return a?.closest('#x2-pick, #x2-input') ? (a.tagName === 'INPUT' ? 'input' : a.textContent) : 'OUT ' + (a?.id || a?.tagName); });
  const tabs1 = [];
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); tabs1.push(await where()); }
  await page.keyboard.press('Escape');
  await until(() => page.evaluate(() => !!document.querySelector('#x2-pick [aria-multiselectable]')));
  await page.keyboard.type('t');
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  const multi = await page.evaluate(() => { const p = document.getElementById('x2-pick'); return { value: p.querySelector('input').value, checked: [...p.querySelectorAll('.x2-pick-item')].map(r => r.querySelector('.x2-pick-label').textContent + ':' + r.getAttribute('aria-checked')), ph: p.querySelector('input').placeholder }; });
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => !!document.querySelector('#x2-input input')));
  const tabs2 = [];
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); tabs2.push(await where()); }
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  const res = JSON.parse(await page.evaluate(() => window.__ask) || '{}');
  ok('X8 quick pick: Tab stays inside it, and Escape from its Cancel button closes it', JSON.stringify(tabs1) === JSON.stringify(['Cancel', 'input', 'Cancel']) && res.pick === undefined, JSON.stringify({ tabs1, pick: res.pick }));
  ok('X8 several to pick: Space checks the highlighted one even with a filter typed (and says so)', multi.value === 't' && JSON.stringify(multi.checked) === JSON.stringify(['two:false', 'three:true'])
    && JSON.stringify(res.many) === '["three"]' && /Space checks the highlighted one/.test(multi.ph), JSON.stringify({ multi, many: res.many }));
  ok('X8 input box: Tab stays inside it, and Escape from a button closes it', JSON.stringify(tabs2) === JSON.stringify(['Cancel', 'OK', 'input']) && res.input === undefined, JSON.stringify({ tabs2, input: res.input }));
  await ctx.close();
}

// ── X9: «Bloquear peticiones» y desbloquear; X10: apagar todo y el botón de cada una ──
{
  const { ctx, page } = await profile({ mock: false });
  await seed(page, [UI]);
  await openIde(page);
  ok('X9 premise: the sandbox runs the UI fixture', !!(await runningWith(page, 'elffuss-test.ui')));
  const dialog = () => until(() => page.evaluate(() => { const d = document.querySelector('#x2-open [role="dialog"]'); return d ? { code: d.querySelector('.x2-code').textContent, buttons: [...d.querySelectorAll('button')].map(b => b.textContent) } : null; }));
  await bridgeRun(page, 'x2ui.open', 'https://blocked.example/a', '__o1');
  await dialog();
  await page.click('#x2-open button:has-text("Block requests for this session")');
  const r1 = await page.evaluate(() => window.__o1);
  await bridgeRun(page, 'x2ui.open', 'https://blocked.example/b', '__o2');
  const r2 = await page.evaluate(() => window.__o2);
  const sb = await page.textContent('#statusbar');
  const noDialog = await page.evaluate(() => !document.querySelector('#x2-open'));
  ok('X9 after "Block requests for this session" an extension’s next address is not opened, and the status bar says why', r1 === 'false' && r2 === 'false' && noDialog && /blocked for this session/.test(sb || ''), JSON.stringify({ r1, r2, noDialog, sb }));
  await page.evaluate(async () => { await (await import('/js/ide.js')).openFile('fruits.txt'); const ed = window.monaco.editor.getEditors()[0]; ed.getModel().setValue('see https://docs.example/page now\n'); ed.setPosition({ lineNumber: 1, column: 8 }); ed.focus(); });
  // (los enlaces los calcula el worker del editor: se reintenta hasta que el enlace existe)
  let link = null;
  for (let i = 0; i < 10 && !link; i++) {
    await sleep(500);
    await page.evaluate(() => window.monaco.editor.getEditors()[0].getAction('editor.action.openLink').run());
    link = await until(() => page.evaluate(() => { const d = document.querySelector('#x2-open [role="dialog"]'); return d ? { code: d.querySelector('.x2-code').textContent, buttons: [...d.querySelectorAll('button')].map(b => b.textContent) } : null; }), { timeout: 1500 });
  }
  ok('X9 …but the user’s own link in the editor still asks, with no Block button (that one is for extensions)', !!link && link.code === 'https://docs.example/page' && !link.buttons.includes('Block requests for this session'), JSON.stringify(link));
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().setValue('pear\napple\nfig\n'));
  await panel(page);
  const line = await until(() => page.evaluate(() => { const p = document.querySelector('#ext-installed .ext-x2-runtime'); return p && !p.hidden && /blocked/.test(p.textContent) && p.querySelector('.ext-x2-unblock') ? p.textContent : null; }));
  await page.focus('#ext-installed .ext-x2-unblock');
  await page.keyboard.press('Enter');
  const unblocked = await until(() => page.evaluate(() => { const m = document.getElementById('ext-msg')?.textContent || ''; return /ask to open an address again/.test(m) ? { focus: document.activeElement?.id, line: document.querySelector('#ext-installed .ext-x2-runtime')?.textContent } : null; }));
  await page.click('#settings-close');
  await bridgeRun(page, 'x2ui.open', 'https://blocked.example/c', '__o3');
  const again = await dialog();
  await page.keyboard.press('Escape');
  ok('X9 the Extensions panel says requests are blocked, with Unblock; after it the focus is on the Installed heading, it is announced, and the next request asks again',
    !!line && /1 not opened/.test(line) && unblocked?.focus === 'ext-installed-h' && !/blocked/.test(unblocked.line || '') && again?.code === 'https://blocked.example/c', JSON.stringify({ line, unblocked, again }));
  // X10
  await panel(page);
  const btnOf = () => page.locator('#ext-installed .ext-row[data-id="elffuss-test.ui"] [data-k="x2run"]').evaluate(b => ({ label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), text: b.textContent }));
  const t1 = await btnOf();
  await page.focus('#ext-installed .ext-x2-alloff');
  await page.keyboard.press('Enter');
  const off = await until(() => page.evaluate(() => { const m = document.getElementById('ext-msg')?.textContent || ''; return /Extension code turned off/.test(m) && !document.querySelector('#ext-installed .ext-x2-alloff') ? { focus: document.activeElement?.id, role: document.getElementById('ext-msg').getAttribute('role') } : null; }));
  const t2 = await btnOf();
  ok('X10 "Turn off all extension code": the focus goes to the Installed heading and the result is announced', off?.focus === 'ext-installed-h' && off.role === 'status', JSON.stringify(off));
  ok('X10 the run button names its action and has no aria-pressed: "Turn off the code of X2 ui" running, "Run the code of X2 ui" off', t1.pressed === null && t1.label === 'Turn off the code of X2 ui' && t1.text === 'Turn off code'
    && t2.pressed === null && t2.label === 'Run the code of X2 ui' && t2.text === 'Run code', JSON.stringify({ t1, t2 }));
  await ctx.close();
}

// ── X4b: en un teléfono (360×640), una dirección larga ──
{
  const { ctx, page } = await profile({ width: 360, height: 640, mock: false });
  await seed(page, [UI]);
  await openIde(page);
  ok('X4b premise: at 360 px the sandbox runs the UI fixture', !!(await runningWith(page, 'elffuss-test.ui')));
  const LONG = 'https://github.com/search?q=' + Array.from({ length: 300 }, (_, i) => 'word' + i).join('+') + '&type=code';
  await bridgeRun(page, 'x2ui.open', LONG, '__long');
  const g = await until(() => page.evaluate(() => {
    const d = document.querySelector('#x2-open [role="dialog"]');
    if (!d) return null;
    const inView = e => { if (!e) return false; const r = e.getBoundingClientRect(), b = d.getBoundingClientRect(); return r.top >= b.top - 1 && r.bottom <= b.bottom + 1 && r.top >= 0 && r.bottom <= innerHeight; };
    const box = d.querySelector('.x2-code'), sites = d.querySelectorAll('.x2-site');
    return { scrollTop: d.scrollTop, title: inView(d.querySelector('.x2-modal-title')), site: inView(sites[0]), siteAgain: inView(sites[1]), again: sites[1]?.textContent || '',
      focus: document.activeElement?.textContent, focusInView: inView(document.activeElement), boxScrolls: box.scrollHeight > box.clientHeight, code: box.textContent, sw: document.documentElement.scrollWidth, w: innerWidth };
  }));
  ok('X4b at 360×640 a long address: the dialog opens at its top with the title and the site in view, the address scrolls in its own box, the site is repeated by the buttons, and Cancel has the focus in view',
    !!g && g.scrollTop === 0 && g.title && g.site && g.siteAgain && /Site: github\.com/.test(g.again) && g.boxScrolls && g.focus === 'Cancel' && g.focusInView && g.sw <= g.w, JSON.stringify({ ...g, code: g?.code.length }));
  ok('X4b the address is the one the extension asked for, with its query readable (= & +, not %3D %26 %2B)', g?.code === LONG, String(g?.code).slice(0, 120));
  await page.keyboard.press('Escape');
  // y el aviso de una extensión no tapa el prompt del chat en un teléfono
  await bridgeRun(page, 'x2ui.question', null, '__q');
  const cover = await until(() => page.evaluate(() => {
    const t = [...document.querySelectorAll('#x2-toasts .x2-toast')].find(x => x.textContent.includes('x2 question'));
    const pr = document.getElementById('prompt');
    if (!t || !pr) return null;
    const a = t.getBoundingClientRect(), b = pr.getBoundingClientRect();
    const visible = b.width > 0 && b.height > 0;
    return { overlaps: visible && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top, visible };
  }));
  ok('X4b at 360 px a notification does not cover the chat prompt', !!cover && !cover.overlaps, JSON.stringify(cover));
  await page.keyboard.press('F6');
  await page.keyboard.press('Escape');
  await ctx.close();
}

// ── X11: las pestañas que ya estaban abiertas al arrancar el recinto también las ve ──
{
  const { ctx, page } = await profile({ mock: false });
  await seed(page, [FMT]);
  await openIde(page);
  const before = await page.evaluate(async () => {
    const ide = await import('/js/ide.js');
    await ide.openFile('app.js');
    await ide.openFile('fruits.txt');
    const b = performance.getEntriesByType('resource').some(e => e.name.includes('/js/ext2/bridge.js')) ? (await import('/js/ext2/bridge.js')).state().state : 'not loaded';
    return b;
  });
  const fmt = await until(() => page.evaluate(async () => { const s = (await import('/js/ext2/bridge.js')).state(); return s.state === 'running' ? s.extensions.find(e => e.id === 'elffuss-test.fmt')?.state || null : null; }).then(x => (x === 'active' ? x : null)), { timeout: 90000 });
  const active = await page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getLanguageId());
  ok('X11 a JavaScript tab opened before the sandbox ran starts the extension that waits for JavaScript, without visiting it again', before !== 'running' && fmt === 'active' && active === 'plaintext', JSON.stringify({ before, fmt, active }));
  await ctx.close();
}

// ── X12: en español, lo que dice el nivel 2 está en español ──
{
  const ctx = await browser.newContext({ locale: 'es-ES', viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); localStorage.setItem('elffusscode.ext.onlyWorks', '0'); } catch { /* — */ } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (e.message !== 'Canceled') errors.push(e.message); });
  await page.goto(srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
  await seed(page, [SORT]);
  await openIde(page);
  ok('X12 premise: the sandbox runs sort', !!(await until(() => page.evaluate(async () => (await import('/js/ext2/bridge.js')).state().state === 'running'), { timeout: 90000 })));
  await page.evaluate(() => { if (!(document.getElementById('ext-panel')?.isConnected && !document.getElementById('settings-panel').hidden)) document.getElementById('act-ext').click(); });
  const keys = await until(() => page.evaluate(() => { const d = document.querySelector('#ext-installed .ext-row[data-id="elffuss-test.sort"] .ext-x2-keys'); return d ? d.textContent : null; }));
  ok('X12 the keybindings that were not bound say why in Spanish', !!keys && /reservado por Elffuss Code o el navegador/.test(keys) && !/reserved by/.test(keys), String(keys));
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

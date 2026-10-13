// Extensions: what the user SEES after installing one, and what is offered
// before. Level 1 only applies themes, grammars, snippets and language
// settings; an install that changes nothing visible felt pointless.
//
//   BASE=http://localhost:8999 node tests/ext_feedback.mjs
//
// Fixtures are built in ext_fixtures.mjs and Open VSX is mocked with routes,
// so it runs offline. The LIVE part at the end installs real extensions from
// Open VSX; without network it is NOT RUN and does not count as a failure.
import { chromium } from 'playwright';
import { pureThemeVsix, PURE_DARK, partialLangVsix, TOMLISH, jsSnippetsVsix, codeOnlyVsix } from './ext_fixtures.mjs';

const BASE = process.env.BASE || 'http://localhost:8999';
const OUT = process.env.SCRATCH || '/tmp/elffuss-test';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const notRun = (n, e) => console.log('⏭️  NOT RUN ' + n + (e ? '  — ' + e : ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rgb = hex => { const h = hex.replace('#', ''); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; };
async function hasta(fn, { tiempo = 12000, cada = 150 } = {}) {
  const fin = Date.now() + tiempo;
  let v;
  while (Date.now() < fin) { try { v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(cada); }
  return v;
}
// internal words a user should never read in the panel
const JERGA = /contributes|customEditors|extension host|host de extensiones|main\/browser|activationEvents/i;

const b = await chromium.launch();

async function nuevaPagina(locale, viewport = { width: 1280, height: 860 }) {
  const ctx = await b.newContext({ locale, viewport });
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
  const p = await ctx.newPage();
  p.errores = [];
  p.on('pageerror', e => { if (e.message !== 'Canceled') p.errores.push(e.message); });
  await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await p.evaluate(async () => {
    const o = await navigator.storage.getDirectory();
    for await (const k of o.keys()) await o.removeEntry(k, { recursive: true }).catch(() => {});
    const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
    await w('app.js', '// app\nconst a = 1;\n');
    await w('data.tomlish', 'name = "x"\n# note\n');
  });
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await hasta(() => p.evaluate(() => !!window.monaco?.editor?.getEditors?.().length), { tiempo: 30000 });
  return { ctx, p };
}
const pulsa = (p, sel) => p.click(sel, { timeout: 3000 }).catch(() => {});
const abre = (p, path) => p.evaluate(async path => { await (await import('/js/ide.js')).openFile(path); }, path);
const fondo = p => p.evaluate(() => getComputedStyle(document.querySelector('#editor .monaco-editor-background') || document.querySelector('#editor .monaco-editor')).backgroundColor);
const abrePanel = async p => { if (!(await p.locator('#ext-panel').isVisible().catch(() => false))) { await p.click('#act-ext'); await p.waitForSelector('#ext-panel', { timeout: 10000 }); } };
const instalaFichero = async (p, nombre, bytes) => {
  await abrePanel(p);
  await p.evaluate(() => { const m = document.getElementById('ext-msg'); if (m) { m.hidden = true; m.textContent = ''; } document.getElementById('ext-done')?.remove(); });
  await p.setInputFiles('#ext-file', { name: nombre, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  const msg = await hasta(() => p.evaluate(() => { const m = document.getElementById('ext-msg'); return m && !m.hidden && m.textContent; }), { tiempo: 15000 });
  // Un .vsix que además trae código para el navegador abre el consentimiento
  // del nivel 2 («¿ejecutar también su código?»). Aquí solo se quería lo
  // declarativo: se rechaza, como haría quien lo instala por su resaltado.
  if (await hasta(() => p.evaluate(() => !!document.querySelector('#x2-consent')), { tiempo: 1500 })) {
    await p.keyboard.press('Escape');
    await hasta(() => p.evaluate(() => !document.querySelector('#x2-consent')), { tiempo: 5000 });
  }
  return msg;
};
const tarjeta = p => p.evaluate(() => document.getElementById('ext-done')?.innerText.replace(/\s+/g, ' ') || '');
const fila = (p, id) => p.locator(`#ext-installed .ext-row[data-id="${id}"]`);

// ── 1. Theme-only extension: applied on install, with Undo and the picker ──
{
  const { p } = await nuevaPagina('en-US');
  await abre(p, 'app.js');
  await instalaFichero(p, 'pure.vsix', pureThemeVsix());
  ok('theme: the first theme is applied on install (editor background)', await hasta(async () => (await fondo(p)) === rgb(PURE_DARK)), await fondo(p));
  const t = await tarjeta(p);
  ok('theme: the notice names the theme and says it is applied', /Pure Night/.test(t) && /applied/i.test(t), t);
  ok('theme: Undo and Choose theme… buttons', await p.locator('#ext-done button[data-act="undo-theme"]').count() === 1 && await p.locator('#ext-done button[data-act="pick-theme"]').count() === 1);
  await pulsa(p, '#ext-done button[data-act="undo-theme"]');
  ok('theme: Undo restores the previous theme', await hasta(async () => (await fondo(p)) === 'rgb(30, 30, 30)'), await fondo(p));
  ok('theme: after Undo, an Apply now button', await hasta(() => p.locator('#ext-done button[data-act="apply-theme"]').count()));
  await pulsa(p, '#ext-done button[data-act="apply-theme"]');
  ok('theme: Apply now applies it', await hasta(async () => (await fondo(p)) === rgb(PURE_DARK)), await fondo(p));
  await pulsa(p, '#ext-done button[data-act="pick-theme"]');
  ok('theme: Choose theme… opens the Color Theme picker', await hasta(() => p.locator('#ext-themepick').count()));
  await p.keyboard.press('Escape');
  const now = (await fila(p, 'elffuss-test.pure-theme').locator('.ext-now').innerText().catch(() => '')).replace(/\s+/g, ' ');
  ok('installed list: says which theme is active right now', /Active theme/i.test(now) && /Pure Night/.test(now), now);
  await p.screenshot({ path: OUT + '/extfb-theme.png' });

  // ── 2. Language with grammar + settings + code: open file highlighted at once ──
  await abre(p, 'data.tomlish');
  ok('language: before installing, the file is plain text', (await p.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getLanguageId())) === 'plaintext');
  await instalaFichero(p, 'tomlish.vsix', partialLangVsix());
  ok('language: the open file switches to the new language', await hasta(() => p.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getLanguageId() === 'tomlish')));
  const tipos = await hasta(async () => { const x = await p.evaluate(() => window.monaco.editor.tokenize('name = 1', 'tomlish').flat().map(t => t.type)); return x.some(t => /variable\.other\.key/.test(t)) && x; });
  ok('language: the grammar tokenizes', !!tipos, JSON.stringify(tipos));
  const t2 = await tarjeta(p);
  ok('language: notice says highlighting for Tomlish (.tomlish)', /Tomlish/.test(t2) && /\.tomlish/.test(t2) && /highlight/i.test(t2), t2);
  ok('language: notice says the open file is already highlighted, with a button to go there', /data\.tomlish/.test(t2) && await p.locator('#ext-done button[data-act="goto"]').count() >= 1, t2);
  ok('language: notice says what the settings change (comment with #, brackets)', /#/.test(t2) && /\[\s?\]/.test(t2), t2);
  ok('language: notice says what does not work, in plain words, and that it comes with the next version', /format/i.test(t2) && /next version/i.test(t2) && !JERGA.test(t2), t2);
  const now2 = (await fila(p, 'elffuss-test.tomlish').locator('.ext-now').innerText().catch(() => '')).replace(/\s+/g, ' ');
  ok('installed list: «Highlighting 1 open file»', /Highlighting 1 open file/i.test(now2), now2);
  await p.screenshot({ path: OUT + '/extfb-lang.png' });

  // ── 3. Snippets: count, languages and prefixes to try ──
  await instalaFichero(p, 'snips.vsix', jsSnippetsVsix());
  const t3 = await tarjeta(p);
  ok('snippets: «4 snippets for JavaScript and TypeScript»', /4 snippets/.test(t3) && /JavaScript/.test(t3) && /TypeScript/.test(t3), t3);
  ok('snippets: shows prefixes to type (clg, imp…) and how to accept', /clg/.test(t3) && /imp/.test(t3) && /Tab/.test(t3), t3);
  const now3 = (await fila(p, 'elffuss-test.js-snips').locator('.ext-now').innerText().catch(() => '')).replace(/\s+/g, ' ');
  ok('installed list: «4 snippets» with a link to try them', /4 snippets/.test(now3) && await fila(p, 'elffuss-test.js-snips').locator('button[data-act="try-snippet"]').count() === 1, now3);
  await pulsa(p, '#ext-done button[data-act="try-snippet"]');
  ok('snippets: Try opens a JavaScript file and puts the cursor in the editor', await hasta(() => p.evaluate(() => {
    const ed = window.monaco.editor.getEditors()[0];
    return document.getElementById('settings-panel').hidden && ed.getModel().getLanguageId() === 'javascript' && ed.hasTextFocus();
  })));

  // ── 4. Code-only .vsix: not installed, said plainly ──
  const m4 = await instalaFichero(p, 'previewer.vsix', codeOnlyVsix());
  ok('code-only: not installed', await fila(p, 'elffuss-test.previewer').count() === 0, m4);
  ok('code-only: says its main feature needs its own code, in plain words', /own code/i.test(m4 || '') && !JERGA.test(m4 || ''), m4);
  ok('code-only (custom editors): does not promise the next version', !/next version/i.test(m4 || ''), m4);

  // ── 5. Plain language everywhere in the panel ──
  const todo = await p.evaluate(() => document.getElementById('ext-panel').innerText);
  ok('panel text: no internal terms (contributes, customEditors, main/browser…)', !JERGA.test(todo), (todo.match(JERGA) || [''])[0]);
  ok('no page errors', !p.errores.length, p.errores.slice(0, 3).join(' | '));
  await p.context().close();
}

// ── 6. Search results (Open VSX mocked): verdict before installing ──
{
  const { ctx, p } = await nuevaPagina('en-US');
  const manifests = {
    'elffuss-test/previewer': { publisher: 'elffuss-test', name: 'previewer', version: '1.0.0', displayName: 'Rich Previewer', description: 'LaTeX, STL and video preview with right-click copy', categories: ['Visualization', 'Other'], main: './dist/extension.js',
      contributes: { languages: [{ id: 'csv', aliases: ['CSV'], extensions: ['.csv'] }, { id: 'tsv', extensions: ['.tsv'] }], commands: [{}], menus: {}, customEditors: [{}], configuration: {} } },
    'elffuss-test/tomlish': { publisher: 'elffuss-test', name: 'tomlish', version: '1.0.0', displayName: 'Tomlish Support', categories: ['Programming Languages', 'Formatters'], main: './x.js', browser: './b.js',
      contributes: { languages: [{ id: 'tomlish', aliases: ['Tomlish'], extensions: ['.tomlish'], configuration: './c.json' }], grammars: [{ language: 'tomlish', scopeName: 'source.tomlish', path: './g.json' }], commands: [{}] } },
    'elffuss-test/heavy': { publisher: 'elffuss-test', name: 'heavy', version: '1.0.0', displayName: 'Heavy Workshop', categories: ['Programming Languages', 'Linters'], main: './x.js',
      contributes: { languages: [{ id: 'heavy', aliases: ['Heavy'], extensions: ['.hv'], configuration: './c.json' }], grammars: [{ language: 'heavy', scopeName: 'source.hv', path: './g.json' }], commands: new Array(12).fill({}), views: { x: [{ type: 'webview' }] }, customEditors: [{}] } },
    'elffuss-test/pure-theme': { publisher: 'elffuss-test', name: 'pure-theme', version: '1.0.0', displayName: 'Pure Theme', categories: ['Themes'], contributes: { themes: [{ label: 'Pure Night', path: './n.json' }, { label: 'Pure Dusk', path: './d.json' }] } },
  };
  const descargas = [];
  await ctx.route('https://open-vsx.org/**', route => {
    const u = new URL(route.request().url());
    const json = o => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (u.pathname === '/api/-/search') {
      return json({ totalSize: 4, offset: 0, extensions: Object.values(manifests).map(m => ({ namespace: m.publisher, name: m.name, version: m.version, displayName: m.displayName, description: m.description || '', downloadCount: 10 })) });
    }
    const mm = /^\/api\/([^/]+)\/([^/]+)\/([^/]+)\/file\/package\.json$/.exec(u.pathname);
    if (mm) return json(manifests[`${mm[1]}/${mm[2]}`]);
    const md = /^\/api\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/.exec(u.pathname);
    if (md && manifests[`${md[1]}/${md[2]}`]) {
      const m = manifests[`${md[1]}/${md[2]}`];
      return json({ namespace: m.publisher, name: m.name, version: m.version, displayName: m.displayName, license: 'MIT', files: { manifest: `https://open-vsx.org/api/${m.publisher}/${m.name}/${m.version}/file/package.json`, download: `https://open-vsx.org/api/${m.publisher}/${m.name}/${m.version}/file/x.vsix` } });
    }
    descargas.push(u.pathname);
    return route.fulfill({ status: 404, body: '' });
  });
  await abrePanel(p);
  await p.uncheck('#ext-only-works');                   // this section reads every verdict, the ones that do nothing too
  await p.fill('#ext-q', 'anything');
  await p.press('#ext-q', 'Enter');
  const r = id => p.locator(`#ext-results .ext-row[data-id="${id}"]`);
  await r('elffuss-test.pure-theme').waitFor({ timeout: 10000 }).catch(() => {});
  const listo = await hasta(() => p.evaluate(() => document.querySelectorAll('#ext-results .ext-verdict').length >= 4));
  ok('results: every row gets a verdict before installing', !!listo);
  const v = async id => (await r(id).locator('.ext-verdict').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const btn = id => r(id).locator('.ext-install');
  const vPrev = await v('elffuss-test.previewer');
  ok('code-only: «The main thing … does not work in Code: it needs to run its own code»', /main/i.test(vPrev) && /does not work in Code/i.test(vPrev) && /own code/i.test(vPrev), vPrev);
  ok('code-only: Install is disabled and labelled so', (await btn('elffuss-test.previewer').getAttribute('aria-disabled')) === 'true' && !/^Install$/.test((await btn('elffuss-test.previewer').innerText()).trim()), await btn('elffuss-test.previewer').innerText());
  ok('code-only with custom editors: no «next version» promise', !/next version/i.test(vPrev), vPrev);
  await btn('elffuss-test.previewer').click({ timeout: 3000 }).catch(() => {});
  await sleep(400);
  ok('code-only: clicking it downloads nothing', !descargas.some(x => /previewer/.test(x)), descargas.join(' '));
  const vToml = await v('elffuss-test.tomlish');
  ok('partial: «Partly works» naming the language, and the missing part in plain words', /Tomlish/.test(vToml) && /format/i.test(vToml) && /next version/i.test(vToml) && !JERGA.test(vToml), vToml);
  ok('partial: the button says what you get («Install only the highlighting»)', /only the highlighting/i.test(await btn('elffuss-test.tomlish').innerText()), await btn('elffuss-test.tomlish').innerText());
  const vHeavy = await v('elffuss-test.heavy');
  ok('mostly code: leads with the main feature not working, then «Only … would apply: highlighting for Heavy»', /does not work in Code/i.test(vHeavy) && /Only/.test(vHeavy) && /Heavy/.test(vHeavy), vHeavy);
  ok('mostly code: install is a secondary button', /ghost/.test(await btn('elffuss-test.heavy').getAttribute('class')) && /only/i.test(await btn('elffuss-test.heavy').innerText()));
  const vPure = await v('elffuss-test.pure-theme');
  ok('declarative: plain Install and the theme names', (await btn('elffuss-test.pure-theme').innerText()).trim() === 'Install' && /Pure Night/.test(vPure), vPure);
  await r('elffuss-test.previewer').locator('.ext-name').click({ timeout: 3000 }).catch(() => {});
  const det = await hasta(async () => { const x = await r('elffuss-test.previewer').locator('.ext-detail').innerText({ timeout: 2000 }); return !/Reading/.test(x) && x; });
  ok('details: plain language, no raw contribution names', !!det && !JERGA.test(det) && !/commands|menus|configuration/.test(det), det);
  const todo = await p.evaluate(() => document.getElementById('ext-panel').innerText);
  ok('results panel: no internal terms', !JERGA.test(todo), (todo.match(JERGA) || [''])[0]);
  await p.screenshot({ path: OUT + '/extfb-results.png' });
  // keyboard: the disabled button still takes focus and is announced as such
  await btn('elffuss-test.previewer').focus({ timeout: 3000 }).catch(() => {});
  const nombre = await btn('elffuss-test.previewer').evaluate(b => (b.getAttribute('aria-label') || b.textContent) + ' | ' + (b.getAttribute('aria-describedby') ? document.getElementById(b.getAttribute('aria-describedby'))?.textContent : ''));
  ok('a11y: the disabled button is focusable and its reason is linked (aria-describedby)', /does not work/i.test(nombre), nombre);
  await ctx.close();
}

// ── 7. Spanish + phone width ──
{
  const { p } = await nuevaPagina('es-ES');
  await abrePanel(p);                                   // the activity bar is in the drawer on a phone
  await p.setViewportSize({ width: 390, height: 800 });
  await instalaFichero(p, 'pure.vsix', pureThemeVsix());
  const t = await tarjeta(p);
  ok('es: «Tema «Pure Night» aplicado»', /Tema «Pure Night» aplicado/.test(t), t);
  ok('es: botones Deshacer y Elegir tema…', /Deshacer/.test(t) && /Elegir tema/.test(t), t);
  const ancho = await p.evaluate(() => { const x = document.getElementById('ext-panel'); return [x.scrollWidth, x.clientWidth, document.documentElement.scrollWidth, innerWidth]; });
  ok('phone width: no horizontal overflow', ancho[0] <= ancho[1] + 1 && ancho[2] <= ancho[3] + 1, ancho.join(','));
  const fuera = await p.evaluate(() => [...document.querySelectorAll('#ext-done button')].filter(b => { const r = b.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).length);
  ok('phone width: notice buttons fit on screen', fuera === 0, String(fuera));
  await p.screenshot({ path: OUT + '/extfb-phone-es.png' });
  const todo = await p.evaluate(() => document.getElementById('ext-panel').innerText);
  ok('es: sin términos internos', !JERGA.test(todo), (todo.match(JERGA) || [''])[0]);
  await p.context().close();
}

// ── LIVE: real Open VSX ──
{
  const vivo = await fetch('https://open-vsx.org/api/esbenp/prettier-vscode', { signal: AbortSignal.timeout(8000) }).then(r => r.ok).catch(() => false);
  if (!vivo) notRun('live Open VSX', 'no network');
  else {
    const { p } = await nuevaPagina('en-US');
    await abrePanel(p);
    await p.fill('#ext-q', 'prettier');
    await p.press('#ext-q', 'Enter');
    const row = p.locator('#ext-results .ext-row[data-id="esbenp.prettier-vscode"]');
    await row.waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    // Con el nivel 2, el código para el navegador de Prettier puede correr en el
    // recinto: ya no se esconde ni se da por «no funciona». La fila lo dice, y
    // «Instalar» lleva a su botón de código en vez de ser un botón muerto.
    const visto = await hasta(async () => (await row.isVisible()) && /Code’s sandbox/.test(await row.innerText()), { tiempo: 20000 });
    ok('live: Prettier (browser code) shows even with «Only ones that work in Code» on, and says it can run in Code’s sandbox', !!visto, await row.innerText().catch(() => ''));
    ok('live: …and its Install is not a dead button', (await row.locator('.ext-install').getAttribute('aria-disabled')) !== 'true', await row.innerText().catch(() => ''));
    await p.fill('#ext-q', 'dracula');
    await p.press('#ext-q', 'Enter');
    const d = p.locator('#ext-results .ext-row[data-id="dracula-theme.theme-dracula"]');
    await d.waitFor({ timeout: 20000 }).catch(() => {});
    await d.locator('.ext-install').click().catch(() => {});
    ok('live: Dracula applied on install', await hasta(async () => (await fondo(p)) === 'rgb(40, 42, 54)', { tiempo: 40000 }), await fondo(p));
    await p.screenshot({ path: OUT + '/extfb-live-dracula.png' });
    ok('live: no page errors', !p.errores.length, p.errores.slice(0, 3).join(' | '));
    await p.context().close();
  }
}

console.log(fails ? `\n❌ ${fails} FAILURE(S)` : '\n✅ EXTENSIONS: VISIBLE EFFECT AFTER INSTALL OK');
await b.close();
process.exit(fails ? 1 : 0);

// Extensions panel: the "Popular" list and the "Only ones that work in Code"
// filter on search results.
//
//   CENSUS=<extensions.tsv> BASE=http://127.0.0.1:8999 node tests/ext_popular.mjs
//
// 1. (no browser) web/js/ext/popular.json against the static census of Open
//    VSX (tests/catalog_census.mjs writes it; CENSUS= points to another copy):
//    no entry has code of its own, every one gets the panel's "works" verdict,
//    no built-in language pack, ordered by downloads, three kinds in the top 10.
// 2. (browser, Open VSX mocked) Popular shows on opening with no request to
//    Open VSX; a search hides what does nothing, says how many, fetches more
//    pages to fill the view, and "show" / the checkbox bring them back.
// 3. LIVE: installs a few entries of the real list from Open VSX. Without
//    network it is NOT RUN and does not count as a failure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { describe, factsFromManifest, works } from '../web/js/ext/verdict.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:8999';
const OUT = process.env.SCRATCH || '/tmp/elffuss-test';
fs.mkdirSync(OUT, { recursive: true });
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const notRun = (n, e) => console.log('⏭️  NOT RUN ' + n + (e ? '  — ' + e : ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, { tiempo = 12000, cada = 150 } = {}) {
  const fin = Date.now() + tiempo;
  let v;
  while (Date.now() < fin) { try { v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(cada); }
  return v;
}
const NOMBRE_VETADO = /Claude[-_ ]?Code/i;

// ── 1. the list itself ──
const POP = JSON.parse(fs.readFileSync(path.join(HERE, '../web/js/ext/popular.json'), 'utf8'));
const items = POP.items;
{
  ok(`popular.json: between 30 and 40 entries (${items.length})`, items.length >= 30 && items.length <= 40);
  const CENSUS = process.env.CENSUS || path.join(HERE, 'catalog-census/extensions.tsv');
  if (!fs.existsSync(CENSUS)) ok('census found (CENSUS=<extensions.tsv>)', false, CENSUS + ' does not exist: this check cannot run without it');
  else {
    const [head, ...lines] = fs.readFileSync(CENSUS, 'utf8').trim().split('\n');
    const cols = head.split('\t');
    const census = new Map(lines.map(l => { const r = Object.fromEntries(l.split('\t').map((v, i) => [cols[i], v])); return [r.id.toLowerCase(), r]; }));
    ok(`census read (${census.size} extensions)`, census.size > 10000);
    const fuera = items.filter(p => !census.has(p.id.toLowerCase()));
    ok('every entry is in the census', !fuera.length, fuera.map(p => p.id).join(' '));
    const conCodigo = items.filter(p => census.get(p.id.toLowerCase())?.runtime !== 'none');
    ok('no entry needs Node, or any code of its own (census runtime=none)', !conCodigo.length, conCodigo.map(p => `${p.id}=${census.get(p.id.toLowerCase())?.runtime}`).join(' '));
    const noFunciona = items.filter(p => census.get(p.id.toLowerCase())?.works !== '1' || census.get(p.id.toLowerCase())?.declarative !== '1');
    ok('every entry works in Code by the census (works=1, declarative=1)', !noFunciona.length, noFunciona.map(p => p.id).join(' '));
    const orden = items.map(p => Number(census.get(p.id.toLowerCase())?.rank));
    ok('ordered by downloads (census rank ascending)', orden.every((r, i) => i === 0 || r > orden[i - 1]), orden.join(','));
  }
  ok('no built-in vscode.* language pack', !items.some(p => /^vscode\./i.test(p.id)));
  // (every language exists here: which ones Monaco has is the generator's job,
  // checked against Monaco's own bundle when the list is built)
  const host = { builtinLanguage: () => false, grammarSkippedFor: () => false, languageName: id => id, languageExtensions: () => [] };
  const malas = items.filter(p => p.analysis.hasCode || !works(describe(factsFromManifest(host, p.analysis))) || describe(factsFromManifest(host, p.analysis)).kind !== 'full');
  ok('the panel\'s own verdict on each stored analysis: «Works in Code», no code', !malas.length, malas.map(p => p.id).join(' '));
  const top = new Set(items.slice(0, 10).map(p => p.kind));
  ok('the top 10 mixes themes, languages and snippets', top.has('theme') && top.has('language') && top.has('snippets'), [...top].join(','));
  ok('each entry: id, name, kind and a one-line description in es and en', items.every(p => p.id && p.displayName && ['theme', 'language', 'snippets'].includes(p.kind) && p.description?.es?.trim() && p.description?.en?.trim() && !/\n/.test(p.description.es + p.description.en)));
  const texto = fs.readFileSync(path.join(HERE, '../web/js/ext/popular.json'), 'utf8') + fs.readFileSync(path.join(HERE, '../web/js/ext/i18n.js'), 'utf8');
  ok('the list and the panel strings never name that other product', !NOMBRE_VETADO.test(texto));
}

// ── 2. the panel, Open VSX mocked ──
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
    await w('.env', 'API_KEY=abc # secret\n');
  });
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await hasta(() => p.evaluate(() => !!window.monaco?.editor?.getEditors?.().length), { tiempo: 30000 });
  return { ctx, p };
}
const abrePanel = async p => {
  if (await p.locator('#ext-panel').isVisible().catch(() => false)) return;
  await p.evaluate(() => document.getElementById('act-ext').click());     // on a phone the activity bar is in the drawer
  await p.waitForSelector('#ext-panel', { timeout: 10000 });
};

// 60 results in three pages of 20; two of each page work, the rest only run
// their own code (one of them is published per platform, so its package.json
// is only under /linux-x64/: before, that row came with no verdict and stayed)
const TOTAL = 60;
const mock = i => {
  const funciona = i % 20 < 2;
  const id = funciona ? `works-${i}` : `node-${i}`;
  return { namespace: 'elffuss-test', name: id, version: '1.0.0', displayName: funciona ? `Theme ${i}` : `Tool ${i}`, description: '', downloadCount: 1000 - i,
    files: { download: `https://open-vsx.org/api/elffuss-test/${id}/${i === 5 ? 'linux-x64/' : ''}1.0.0/file/x.vsix` } };
};
const manifiesto = name => (name.startsWith('works-')
  ? { publisher: 'elffuss-test', name, version: '1.0.0', categories: ['Themes'], contributes: { themes: [{ label: `Mock ${name}`, path: './t.json' }] } }
  : { publisher: 'elffuss-test', name, version: '1.0.0', categories: ['Linters'], main: './out/extension.js', contributes: { commands: [{ command: 'x' }], configuration: {} } });
async function simula(ctx) {
  const log = { search: [], openvsx: [] };
  await ctx.route(/open-vsx\.org|eclipsecontent\.org/, route => {
    const u = new URL(route.request().url());
    log.openvsx.push(u.pathname);
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
    if (u.pathname === '/api/-/search') {
      const off = Number(u.searchParams.get('offset')) || 0, size = Number(u.searchParams.get('size')) || 20;
      log.search.push(off);
      return json({ totalSize: TOTAL, offset: off, extensions: Array.from({ length: Math.max(0, Math.min(size, TOTAL - off)) }, (_, k) => mock(off + k)) });
    }
    const m = /^\/api\/elffuss-test\/([^/]+)\/(?:([^/]+)\/)?1\.0\.0\/file\/package\.json$/.exec(u.pathname);
    if (m && (m[1] === 'node-5') === (m[2] === 'linux-x64')) return json(manifiesto(m[1]));
    return json({ error: 'not found' }, 404);
  });
  return log;
}
const visibles = p => p.locator('#ext-list .ext-row:not([hidden])').count();
const ocultasDom = p => p.locator('#ext-list .ext-row[hidden]').count();

{
  const { ctx, p } = await nuevaPagina('en-US');
  const log = await simula(ctx);
  await abrePanel(p);
  const filas = p.locator('#ext-list.ext-popular .ext-row');
  ok('opening the panel: Popular is there at once, with every entry of the list', await hasta(async () => (await filas.count()) === items.length), String(await filas.count()));
  const veredictos = await hasta(async () => { const v = await filas.locator('.ext-verdict').allInnerTexts(); return v.length === items.length && v; });
  ok('each popular row has its verdict line «Works in Code: …»', !!veredictos && veredictos.every(t => /^Works in Code: /.test(t)), (veredictos || []).find(t => !/^Works in Code: /.test(t)) || '');
  const kinds = await filas.locator('.ext-kind').allInnerTexts();
  ok('each popular row is tagged with its kind', kinds.length === items.length && kinds.every(k => /^(theme|language|snippets)$/i.test(k)), kinds.slice(0, 5).join(','));
  ok('…in the order of the list', (await filas.evaluateAll(rs => rs.map(r => r.dataset.id))).join() === items.map(x => `${x.namespace}.${x.name}`).join());
  ok('Popular asked Open VSX for nothing (verdicts precomputed, no icons)', log.openvsx.length === 0, log.openvsx.join(' '));
  ok('the filter is on by default', await p.isChecked('#ext-only-works'));
  await p.screenshot({ path: OUT + '/extpop-popular.png' });

  await p.fill('#ext-q', 'tool');
  await p.press('#ext-q', 'Enter');
  const lleno = await hasta(async () => log.search.length === 3 && (await p.textContent('#ext-status')) === '60 results · 54 hidden because they do not work in Code', { tiempo: 20000 });
  ok('filter on: it fetched more pages by itself to fill the view (3 searches)', !!lleno && log.search.join() === '0,20,40', log.search.join());
  ok('filter on: only the 6 that work are shown', (await visibles(p)) === 6, String(await visibles(p)));
  const linea = (await p.locator('#ext-hidden').innerText()).replace(/\s+/g, ' ');
  ok('the hidden count is said: «54 hidden because they do not work in Code · show»', linea === '54 hidden because they do not work in Code · show', linea);
  ok('…and it is right: 54 rows hidden in the page', (await ocultasDom(p)) === 54, String(await ocultasDom(p)));
  ok('…the status says it too (screen readers)', (await p.textContent('#ext-status')) === '60 results · 54 hidden because they do not work in Code', await p.textContent('#ext-status'));
  ok('the per-platform build got its verdict too (and is hidden)', await p.locator('#ext-list .ext-row[data-id="elffuss-test.node-5"] .ext-verdict').count() === 1 && !(await p.locator('#ext-list .ext-row[data-id="elffuss-test.node-5"]').isVisible()));
  ok('all fetched: no «More results»', await p.locator('#ext-more').count() === 0);
  await p.screenshot({ path: OUT + '/extpop-filtered.png' });

  await p.click('#ext-show-hidden');
  ok('«show»: all 60 visible, the filter unticked, the hidden line gone', await hasta(async () => (await visibles(p)) === 60 && !(await p.isChecked('#ext-only-works')) && !(await p.locator('#ext-hidden').isVisible())));
  ok('…focus goes to the filter checkbox', await p.evaluate(() => document.activeElement?.id) === 'ext-only-works');
  const honesto = (await p.locator('#ext-list .ext-row[data-id="elffuss-test.node-3"] .ext-verdict').innerText()).replace(/\s+/g, ' ');
  ok('filter off: the ones that do not work carry the honest verdict', /does not work in Code/.test(honesto), honesto);
  ok('filter off: the status gives no hidden count', (await p.textContent('#ext-status')) === '60 results', await p.textContent('#ext-status'));
  await p.keyboard.press('Space');
  ok('keyboard: Space on the checkbox turns the filter back on (6 visible, 54 hidden)', await hasta(async () => (await p.isChecked('#ext-only-works')) && (await visibles(p)) === 6 && /^54 hidden/.test(await p.locator('#ext-hidden').innerText())));
  ok('the choice is remembered in this browser', await p.evaluate(() => localStorage.getItem('elffusscode.ext.onlyWorks')) === '1');

  await p.fill('#ext-q', '');
  await p.press('#ext-q', 'Enter');
  ok('clearing the search brings Popular back', await hasta(async () => (await p.locator('#ext-list.ext-popular .ext-row').count()) === items.length));
  ok('no page errors', !p.errores.length, p.errores.slice(0, 3).join(' | '));
  await ctx.close();
}

// Spanish, phone width
{
  const { ctx, p } = await nuevaPagina('es-ES', { width: 390, height: 844 });
  await simula(ctx);
  await abrePanel(p);
  await hasta(async () => (await p.locator('#ext-list.ext-popular .ext-row .ext-verdict').count()) === items.length);
  const primera = (await p.locator('#ext-list.ext-popular .ext-row').first().innerText()).replace(/\s+/g, ' ');
  ok('es: Popular en castellano («Funciona en Code: …», descripción y tipo)', /Funciona en Code: /.test(primera) && primera.includes(items[0].description.es) && /snippets|tema|lenguaje/i.test(primera), primera);
  ok('es: «Solo las que funcionan en Code»', (await p.locator('label.ext-filter').innerText()).trim() === 'Solo las que funcionan en Code');
  const ancho = () => p.evaluate(() => { const x = document.getElementById('ext-panel'); return [x.scrollWidth, x.clientWidth, document.documentElement.scrollWidth, innerWidth]; });
  let a = await ancho();
  ok('phone width, Popular: no horizontal overflow', a[0] <= a[1] + 1 && a[2] <= a[3] + 1, a.join(','));
  await p.screenshot({ path: OUT + '/extpop-phone-es.png' });
  await p.fill('#ext-q', 'tool');
  await p.press('#ext-q', 'Enter');
  const linea = await hasta(async () => { const t = (await p.locator('#ext-hidden').innerText()).replace(/\s+/g, ' '); return /^54 /.test(t) && t; }, { tiempo: 20000 });
  ok('es: «54 ocultas porque no funcionan en Code · mostrar»', linea === '54 ocultas porque no funcionan en Code · mostrar', String(linea));
  a = await ancho();
  ok('phone width, filtered search: no horizontal overflow', a[0] <= a[1] + 1 && a[2] <= a[3] + 1, a.join(','));
  const fuera = await p.evaluate(() => [...document.querySelectorAll('#ext-panel button, #ext-panel label')].filter(b => { const r = b.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).length);
  ok('phone width: every button fits on screen', fuera === 0, String(fuera));
  await p.screenshot({ path: OUT + '/extpop-phone-es-search.png' });
  ok('es: sin errores de página', !p.errores.length, p.errores.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── 3. LIVE: install some of the real list from the Popular section ──
{
  const vivo = await fetch('https://open-vsx.org/api/dracula-theme/theme-dracula', { signal: AbortSignal.timeout(8000) }).then(r => r.ok).catch(() => false);
  if (!vivo) notRun('live installs from Popular', 'no network');
  else {
    const { p } = await nuevaPagina('en-US');
    await abrePanel(p);
    const fila = id => p.locator(`#ext-list.ext-popular .ext-row[data-id="${id}"]`);
    const instala = async id => {
      await fila(id).locator('.ext-install').focus();
      await p.keyboard.press('Enter');                  // with the keyboard
      return hasta(async () => (await p.locator(`#ext-installed .ext-row[data-id="${id.toLowerCase()}"]`).count()) === 1, { tiempo: 60000 });
    };
    const fondo = () => p.evaluate(() => getComputedStyle(document.querySelector('#editor .monaco-editor-background') || document.querySelector('#editor .monaco-editor')).backgroundColor);
    await fila('dracula-theme.theme-dracula').waitFor({ timeout: 10000 });
    ok('live: Dracula installs from Popular', !!(await instala('dracula-theme.theme-dracula')));
    ok('live: …and its theme is applied', await hasta(async () => (await fondo()) === 'rgb(40, 42, 54)', { tiempo: 20000 }), await fondo());
    ok('live: DotENV installs from Popular', !!(await instala('mikestead.dotenv')));
    const lang = await p.evaluate(async () => { await (await import('/js/ide.js')).openFile('.env'); await new Promise(r => setTimeout(r, 800)); return window.monaco.editor.getEditors()[0].getModel().getLanguageId(); });
    ok('live: …a .env file opens as dotenv', lang === 'dotenv', lang);
    const tipos = await p.evaluate(() => window.monaco.editor.tokenize('API_KEY=abc # secret', 'dotenv')[0].map(t => t.type).join(' '));
    ok('live: …with its own grammar (comment scope)', /comment/.test(tipos), tipos);
    await abrePanel(p);
    ok('live: JavaScript (ES6) snippets install from Popular', !!(await instala('xabikos.JavaScriptSnippets')));
    const tarjeta = (await p.locator('#ext-done').innerText().catch(() => '')).replace(/\s+/g, ' ');
    ok('live: …the notice counts its snippets', /\d+ snippets for JavaScript/.test(tarjeta), tarjeta.slice(0, 200));
    ok('live: Nix installs from Popular', !!(await instala('bbenoist.Nix')));
    const nix = await p.evaluate(() => window.monaco.languages.getLanguages().some(l => l.id === 'nix'));
    ok('live: …and Code now knows the Nix language', nix);
    await p.screenshot({ path: OUT + '/extpop-live.png' });
    ok('live: no page errors', !p.errores.length, p.errores.slice(0, 3).join(' | '));
    await p.context().close();
  }
}

console.log(fails ? `\n❌ ${fails} FAILURE(S)` : '\n✅ EXTENSIONS: POPULAR AND «ONLY ONES THAT WORK» OK');
await b.close();
process.exit(fails ? 1 : 0);

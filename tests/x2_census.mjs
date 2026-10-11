// Censo EN EJECUCIÓN del nivel 2 (manual, con red): de las N extensiones más
// descargadas de Open VSX, las que traen código para navegador se instalan y
// arrancan de verdad, una a una, en el recinto real, con la baliza escuchando.
//
//   node tests/x2_census.mjs [--top 500] [--pause 1500] [--out web/js/ext2/tested.json]
//   node tests/x2_census.mjs --only ns.name,ns.name [--merge]
//       --only re-runs just those; with --merge their entries replace the ones
//       in the existing output (and the counts are recomputed); without it,
//       nothing is written
//
// Por cada una: baja el .vsix y comprueba su SHA-256 (falla cerrado), lo
// guarda como lo haría una instalación (con sus lenguajes, para que Code
// reconozca sus ficheros), espera a que el recinto esté en marcha, abre
// entonces un documento de muestra por lenguaje que aporte, lanza
// onStartupFinished, «*» y los onCommand de sus comandos (solo activa: no
// ejecuta ningún comando) y anota:
//   · si arranca, o el error con el que no arranca;
//   · qué comandos y proveedores registra (por tipo), y los de fase 2;
//   · si pone diagnósticos;
//   · lo que no está soportado (el comando «type», llamadas sin servicio).
// Cualquier visita a la baliza es un fallo del recinto. Salida: tested.json
// (por id@versión) y un resumen con recuentos. Sin tiempos.
// Los manifiestos y los .vsix se guardan en tests/.cache/ para repetir sin red.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './lib/x2-server.mjs';
import { startBeacon } from './lib/beacon.mjs';
import { fetchVsix, readCode, seedReal } from './lib/x2-vsix.mjs';
import { readVsix, analyzeManifest } from '../web/js/ext/vsix.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const API = 'https://open-vsx.org';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const TOP = Number(arg('--top', 500));
const PAUSE = Number(arg('--pause', 1500));
const ONLY = arg('--only', '') ? new Set(arg('--only').toLowerCase().split(',')) : null;
const MERGE = process.argv.includes('--merge');
const OUT = path.resolve(arg('--out', path.join(REPO, 'web/js/ext2/tested.json')));
const CACHE = path.join(HERE, '.cache', 'census');
fs.mkdirSync(CACHE, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, { timeout = 20000, every = 250 } = {}) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* reintenta */ } await sleep(every); }
  return v;
}
async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'elffuss-code-census' } });
    if (r.status === 429) { await sleep(10000 * (attempt + 1)); continue; }
    if (!r.ok) throw Object.assign(new Error(`${url}: HTTP ${r.status}`), { status: r.status });
    return r.json();
  }
  throw new Error('rate limited: ' + url);
}

// ── 1. las N más descargadas ──
const listFile = path.join(CACHE, `top-${TOP}.json`);
let top;
if (fs.existsSync(listFile)) top = JSON.parse(fs.readFileSync(listFile, 'utf8'));
else {
  top = [];
  for (let off = 0; off < TOP; off += 100) {
    const j = await getJson(`${API}/api/-/search?size=${Math.min(100, TOP - off)}&offset=${off}&sortBy=downloadCount&sortOrder=desc`);
    top.push(...j.extensions.map((e, i) => ({ rank: off + i + 1, namespace: e.namespace, name: e.name, version: e.version, downloads: e.downloadCount })));
    await sleep(PAUSE);
  }
  fs.writeFileSync(listFile, JSON.stringify({ date: new Date().toISOString().slice(0, 10), list: top }, null, 1));
  top = JSON.parse(fs.readFileSync(listFile, 'utf8'));
}
const listDate = top.date;
top = top.list;

// ── 2. sus package.json (4 a la vez, con pausa), en caché ──
// Las extensiones por plataforma pueden publicar una compilación «web» para
// el navegador: si existe, es la que cuenta (y la que se instalaría).
async function manifestOf(e) {
  const file = path.join(CACHE, `${e.namespace}.${e.name}.json`);
  if (fs.existsSync(file)) {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c.variant || c.targetPlatform === 'universal') return c;
  }
  const base = `${API}/api/${encodeURIComponent(e.namespace)}/${encodeURIComponent(e.name)}`;
  let meta = await getJson(base);
  let variant = (meta.targetPlatform || 'universal') === 'universal' ? 'universal' : 'platform';
  if (variant === 'platform' && meta.downloads && meta.downloads.web) {
    meta = await getJson(base + '/web');
    variant = 'web';
  }
  const manifest = meta.files?.manifest ? await getJson(meta.files.manifest) : null;
  const out = { version: meta.version, targetPlatform: meta.targetPlatform || 'universal', variant, license: meta.license || '', manifest };
  fs.writeFileSync(file, JSON.stringify(out));
  return out;
}
const withManifest = [];
for (let i = 0; i < top.length; i += 4) {
  const batch = top.slice(i, i + 4);
  const got = await Promise.all(batch.map(async e => { try { return { ...e, ...(await manifestOf(e)) }; } catch (err) { return { ...e, error: String(err.message || err) }; } }));
  withManifest.push(...got);
  if (got.some(g => !fs.existsSync(path.join(CACHE, `${g.namespace}.${g.name}.json`)))) await sleep(PAUSE);
}
const browserOnes = withManifest.filter(e => e.manifest && typeof e.manifest.browser === 'string' && (!ONLY || ONLY.has(`${e.namespace}.${e.name}`.toLowerCase())));
console.log(`top ${TOP} (${listDate}): ${withManifest.filter(e => e.manifest).length} manifests read, ${withManifest.filter(e => e.manifest && typeof e.manifest.browser === 'string').length} with a browser entry`);

// ── 3. en ejecución, una a una ──
const SAMPLES = { javascript: 'js', typescript: 'ts', json: 'json', jsonc: 'jsonc', markdown: 'md', html: 'html', css: 'css', scss: 'scss', less: 'less', python: 'py',
  yaml: 'yaml', xml: 'xml', plaintext: 'txt', shellscript: 'sh', go: 'go', rust: 'rs', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', php: 'php', ruby: 'rb', sql: 'sql',
  toml: 'toml', ini: 'ini', dockerfile: 'Dockerfile', makefile: 'Makefile', vue: 'vue', svelte: 'svelte', javascriptreact: 'jsx', typescriptreact: 'tsx', lua: 'lua', dart: 'dart' };
const SAMPLE_TEXT = 'hello world\n// TODO: check\nfoo  bar\n';
const srv = await startServer();
const beacon = await startBeacon();
const browser = await chromium.launch({ args: [`--host-resolver-rules=${beacon.resolverRules}`] });
const vendor = JSON.parse(fs.readFileSync(path.join(REPO, 'web/js/ext2/vendor-manifest.json'), 'utf8'));
const results = {};

for (const [k, e] of browserOnes.entries()) {
  const id = `${e.namespace}.${e.name}`.toLowerCase();
  const key = `${id}@${e.version}`;
  const r = { rank: e.rank, downloads: e.downloads };
  results[key] = r;
  const a = analyzeManifest(e.manifest);
  r.declarative = Object.fromEntries(Object.entries(a.applies).filter(([, n]) => n));
  r.workbench = Object.keys(e.manifest.contributes || {}).filter(c => ['views', 'viewsContainers', 'viewsWelcome', 'customEditors', 'notebooks', 'notebookRenderer', 'walkthroughs', 'debuggers', 'breakpoints', 'terminal', 'taskDefinitions', 'problemMatchers', 'authentication', 'chatParticipants', 'languageModelTools', 'mcpServerDefinitionProviders', 'resourceLabelFormatters'].includes(c));
  if (Array.isArray(e.manifest.enabledApiProposals) && e.manifest.enabledApiProposals.length) r.apiProposals = e.manifest.enabledApiProposals.length;
  // (sin nombrar la plataforma: solo si es la compilación web o una por plataforma)
  if (e.variant && e.variant !== 'universal') r.variant = e.variant;
  let pkg, lv;
  try {
    const v = await fetchVsix({ namespace: e.namespace, name: e.name, version: e.version, targetPlatform: e.variant === 'web' ? 'web' : '' });
    pkg = await readCode(v.bytes);
    lv = await readVsix(v.bytes).catch(() => null);
  } catch (err) {
    r.state = 'install-failed';
    // los topes de tamaño del nivel 2 (32 MiB por fichero, 64 MiB por extensión)
    r.error = err?.code === 'big' ? (/descomprime demasiado/.test(err.message) ? 'over the 64 MiB limit for one extension' : 'a file over the 32 MiB limit') : String(err.message || err).slice(0, 300);
    console.log(`${k + 1}/${browserOnes.length} ${key}: install failed (${r.error})`);
    continue;
  }
  r.bytes = pkg.bytes;
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* — */ } });
  const page = await ctx.newPage();
  try {
    await page.goto(srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
    const langs = lv?.languages || [];
    const files = new Map([['sample.txt', SAMPLE_TEXT], ['sample.js', SAMPLE_TEXT]]);
    for (const l of langs) {
      const name = l.filenames?.[0] || (l.extensions?.[0] ? 'sample' + l.extensions[0] : null);
      if (name && /^[\w.+-]{1,60}$/.test(name)) files.set(name, SAMPLE_TEXT);
    }
    for (const ev of Array.isArray(e.manifest.activationEvents) ? e.manifest.activationEvents : []) {
      const m = /^onLanguage:(.+)$/.exec(ev);
      if (m && SAMPLES[m[1]]) files.set(/^[A-Z]/.test(SAMPLES[m[1]]) ? SAMPLES[m[1]] : 'sample.' + SAMPLES[m[1]], SAMPLE_TEXT);
    }
    await page.evaluate(async files => {
      const o = await navigator.storage.getDirectory();
      for (const [n, t] of files) { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); }
    }, [...files]);
    await seedReal(page, pkg, { languages: langs });
    await page.goto(srv.codeOrigin + '/?test-opfs', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });
    // (una que el recinto rechaza —sustituye el tecleo— se queda fuera y, si era
    // la única, el recinto se desmonta: eso es «no soportada», no un fallo)
    const st = await until(() => page.evaluate(async id => {
      const b = await import('/js/ext2/bridge.js');
      const s = b.state();
      return s.state === 'running' || s.state === 'error' || s.extensions.some(x => x.id === id && x.state === 'unsupported') ? s : null;
    }, id), { timeout: 60000 });
    const refusedNow = st?.extensions?.find(x => x.id === id && x.state === 'unsupported');
    if (refusedNow) { r.state = 'unsupported'; r.unsupported = 'replaces typing'; r.error = (refusedNow.text || '').slice(0, 300); r.contributedCommands = (e.manifest.contributes?.commands || []).length; continue; }
    if (st?.state !== 'running') { r.state = 'sandbox-error'; r.error = st?.error?.message || 'no start'; continue; }
    // Los documentos de muestra se abren con el recinto YA en marcha, uno a
    // uno, como los abriría alguien: cada uno llega a las extensiones y
    // dispara su onLanguage. (Que las pestañas abiertas ANTES de arrancar
    // también lleguen lo prueba tests/x2_ux.mjs, X11.)
    for (const n of [...files.keys()].slice(0, 12)) await page.evaluate(async n => { await (await import('/js/ide.js')).openFile(n); }, n).catch(() => {});
    // Lo que la extensión le pregunte al usuario (avisos, diálogos, selectores,
    // abrir direcciones) se contesta como lo haría alguien con prisa: cerrar o
    // cancelar. Una extensión que espera esa respuesta para terminar de
    // arrancar arranca igual, y se cuenta qué pidió.
    await page.evaluate(() => {
      const c = window.__x2asked = { toasts: 0, dialogs: 0, picks: 0, opens: 0 };
      setInterval(() => {
        for (const x of document.querySelectorAll('#x2-toasts .x2-toast-close')) { c.toasts++; x.click(); }
        for (const [sel, k] of [['#x2-dialog', 'dialogs'], ['#x2-pick', 'picks'], ['#x2-input', 'picks'], ['#x2-open', 'opens']]) {
          const d = document.querySelector(sel);
          if (!d) continue;
          c[k]++;
          // (los selectores escuchan en su campo; los diálogos, en el documento)
          (d.querySelector('input') || d.querySelector('[role="dialog"]') || d).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
      }, 300);
    });
    const events = ['onStartupFinished', '*', ...((e.manifest.contributes?.commands || []).map(c => c && typeof c.command === 'string' ? 'onCommand:' + c.command : null).filter(Boolean).slice(0, 50))];
    await page.evaluate(async events => { const b = await import('/js/ext2/bridge.js'); for (const ev of events) b.activate(ev); }, events);
    const ext = await until(async () => {
      const s = await page.evaluate(async () => (await import('/js/ext2/bridge.js')).state());
      const x = s.extensions.find(y => y.id === id);
      return x && ['active', 'error', 'unsupported', 'stopped'].includes(x.state) ? x : null;
    }, { timeout: 20000 });
    await sleep(2000);
    const stats = await page.evaluate(async () => (await import('/js/ext2/bridge.js')).stats());
    const finalState = (await page.evaluate(async () => (await import('/js/ext2/bridge.js')).state())).extensions.find(y => y.id === id);
    r.state = finalState?.state === 'active' || ext?.state === 'active' ? 'active' : finalState?.state || 'not-activated';
    if (finalState?.text) r.error = finalState.text.slice(0, 300);
    const xs = stats?.extensions?.[id];
    if (xs?.activationError) r.activation = 'failed';
    else if (xs && !xs.activated) r.activation = xs.started ? 'started, never finished' : 'no activation event fired';
    if (xs?.errors?.length && !r.error) r.error = xs.errors.join(' · ').slice(0, 300);
    if (process.env.X2_CENSUS_DEBUG) console.log('   commands:', JSON.stringify(stats?.commands?.slice(0, 12)), 'status:', JSON.stringify(xs));
    r.commands = stats?.commands?.length || 0;
    r.contributedCommands = (e.manifest.contributes?.commands || []).length;
    r.providers = stats?.providers || {};
    if (stats && Object.keys(stats.later || {}).length) r.later = stats.later;
    r.diagnostics = (stats?.markers || 0) > 0;
    if (stats?.unsupported?.length || finalState?.state === 'unsupported') r.unsupported = 'replaces typing';
    const unsupportedCalls = (stats?.errors || []).filter(t => /not supported/.test(t)).map(t => (/Unsupported: ([\w$.]+)/.exec(t) || [])[1]).filter(Boolean);
    if (unsupportedCalls.length) r.unsupportedCalls = [...new Set(unsupportedCalls)].slice(0, 10);
    const otherErrors = (stats?.errors || []).filter(t => !/not supported/.test(t));
    if (otherErrors.length) r.sandboxErrors = otherErrors.length;
    const asked = await page.evaluate(() => window.__x2asked || null).catch(() => null);
    if (asked && Object.values(asked).some(Boolean)) r.askedUser = Object.fromEntries(Object.entries(asked).filter(([, n]) => n));
  } catch (err) {
    r.state = r.state || 'census-error';
    r.error = String(err.message || err).slice(0, 300);
  } finally {
    await ctx.close().catch(() => {});
    const prov = Object.entries(r.providers || {}).map(([k2, n]) => `${k2}:${n}`).join(',');
    console.log(`${k + 1}/${browserOnes.length} ${key}: ${r.state}${r.error ? ' (' + r.error.slice(0, 80) + ')' : ''} commands ${r.commands ?? '-'}/${r.contributedCommands ?? '-'} ${prov}`);
    await sleep(PAUSE);
  }
}

await browser.close();
const hits = beacon.hits.length;
await beacon.close();
await srv.close();

// ── 4. resumen y tested.json ──
let merged = results;
let reruns = null;
if (ONLY && MERGE && fs.existsSync(OUT)) {
  const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  merged = { ...prev.results };
  for (const k of Object.keys(merged)) if (ONLY.has(k.split('@')[0])) delete merged[k];
  Object.assign(merged, results);
  reruns = [...(prev.reruns || []), { date: new Date().toISOString().slice(0, 10), ids: Object.keys(results) }];
}
const all = Object.values(merged);
const useful = x => x.state === 'active' && (x.commands > 0 || Object.keys(x.providers || {}).length > 0 || x.diagnostics);
const counts = {
  topN: TOP, listDate, browserEntry: all.length,
  installed: all.filter(x => x.state !== 'install-failed').length,
  active: all.filter(x => x.state === 'active').length,
  activeAndUseful: all.filter(useful).length,
  activeNothingRegistered: all.filter(x => x.state === 'active' && !useful(x)).length,
  error: all.filter(x => x.state === 'error').length,
  notActivated: all.filter(x => ['installed', 'not-activated'].includes(x.state)).length,
  unsupported: all.filter(x => x.state === 'unsupported' || x.unsupported).length,
  installFailed: all.filter(x => x.state === 'install-failed').length,
  sandboxOrCensusError: all.filter(x => ['sandbox-error', 'census-error'].includes(x.state)).length,
  withWorkbenchContributions: all.filter(x => x.workbench?.length).length,
  withFormatter: all.filter(x => x.state === 'active' && (x.providers?.format || x.providers?.formatRange)).length,
  beaconHits: hits,
};
const out = {
  schema: 1, date: new Date().toISOString().slice(0, 10), vscode: vendor.vscode, library: vendor.library, buildId: vendor.buildId,
  method: `Runtime census: the top ${TOP} Open VSX extensions by downloads (list of ${listDate}) that have a browser entry, each installed from its verified .vsix and started alone in the real sandbox; once the sandbox ran, one sample document per language was opened; activation events fired: those documents' languages, onStartupFinished, * and onCommand for each contributed command (no command was executed).`,
  counts, ...(reruns ? { reruns } : {}), results: merged,
};
if (!ONLY || MERGE) fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log('\n' + JSON.stringify(counts, null, 1));
if (hits) console.log(`\n❌ the beacon recorded ${hits} hits: a sandbox leak`);
process.exit(hits ? 1 : 0);

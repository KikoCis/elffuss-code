// Static census of the WHOLE Open VSX catalog (manual, run once by the owner):
// every extension's package.json, classified with the panel's own rules
// (web/js/ext2/classify.js), so the README gives exact counts instead of an
// extrapolation from a sample.
//
//   node tests/catalog_census.mjs
//       every extension: about 20,000 requests to the Open VSX API, at most
//       2.5 a second (the API allows 3), resumable (see below); writes
//       tests/catalog-census/summary.json and extensions.tsv (committed)
//   node tests/catalog_census.mjs --ranks 1-20,10001-10020
//       only those download ranks (one block from each end of the paging),
//       to try it: a few dozen requests; writes
//       tests/.cache/catalog/summary-ranks.json
//   node tests/catalog_census.mjs --recount
//       no network: classify again what the cache holds (after a rule change)
//   options: --gap <ms between two requests, 400>  --out <folder>
//
// Listing: the search API stops at offset 10,000, so ranks up to 10,000 are
// read by downloads, descending, and the rest from the other end, ascending.
// Extensions with equal download counts can come back in a different order
// from the two ends, so one may appear twice and another never: the listing is
// always completed by a second pass sorted by publication date (those found
// only there have no rank), and whatever is still missing is counted and said.
//
// Manifests: for an extension published for all platforms, its package.json
// by its listed version (one request). For one published per platform, the
// "web" build of that same version if it has one (as tests/x2_census.mjs
// does; an older web build is not what an install gets), or else the listed
// platform's (two requests). No .vsix is ever downloaded and nothing is
// installed or run: that is tests/x2_census.mjs, on the top 500.
//
// What it reads goes to tests/.cache/catalog/raw.jsonl (one line per
// extension, the manifest without its build-only fields), so a stopped run
// continues where it was, and --recount classifies again without the network.
// Built-in languages are Monaco 0.52.2's (tests/lib/monaco-languages.json), as
// the panel sees them. The summary has counts, the date and the number of
// requests; no timings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, WORKBENCH } from '../web/js/ext2/classify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = 'https://open-vsx.org';
const CAP = 10000;                                    // la búsqueda no pasa de este desplazamiento
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const GAP = Number(arg('--gap', 400));
const RANKS = arg('--ranks', '') ? arg('--ranks').split(',').map(r => r.split('-').map(Number)) : null;
const RECOUNT = process.argv.includes('--recount');
const CACHE = path.join(HERE, '.cache', 'catalog');
const OUTDIR = path.resolve(arg('--out', RANKS ? CACHE : path.join(HERE, 'catalog-census')));
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUTDIR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const inRanks = r => !RANKS || (r != null && RANKS.some(([a, b]) => r >= a && r <= (b || a)));
const today = new Date().toISOString().slice(0, 10);

// ── peticiones: como mucho una cada GAP ms a la API, y paciencia con el 429 ──
let requests = 0, nextSlot = 0;
async function slot() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + GAP;
  if (at > now) await sleep(at - now);
}
async function getJson(url, { notFound = false } = {}) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    await slot();
    requests++;
    let r;
    try { r = await fetch(url, { headers: { 'User-Agent': 'elffuss-code-census' }, signal: AbortSignal.timeout(60000) }); }
    catch (e) { if (attempt === 6) throw e; await sleep(5000 * attempt); continue; }
    // cerca del tope: más despacio (una respuesta de la caché de Open VSX no trae la cabecera)
    const left = r.headers.get('x-ratelimit-remaining');
    if (left !== null && /^\d+$/.test(left) && Number(left) < 300) nextSlot = Math.max(nextSlot, Date.now() + 5000);
    if (r.status === 429 || r.status >= 500) { await r.body?.cancel(); await sleep((r.status === 429 ? 60000 : 15000) * attempt); continue; }
    if (r.status === 404 && notFound) { await r.body?.cancel(); return null; }
    if (!r.ok) { await r.body?.cancel(); throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status }); }
    return r.json();
  }
  throw new Error('gave up after retries');
}

// «…/api/ns/name/<plataforma>/<versión>/file/x.vsix» → la plataforma (o null)
function platformOf(download) {
  try {
    const parts = new URL(download).pathname.split('/').filter(Boolean);
    return parts[0] === 'api' && parts.length === 7 && parts[5] === 'file' ? parts[3] : null;
  } catch { return null; }
}

// ── 1. la lista, por descargas (y, si faltan, por fecha) ──
const listFile = path.join(CACHE, RANKS ? `list-ranks.json` : `list-${today}.json`);
async function listing() {
  if (RECOUNT || (!RANKS && fs.existsSync(listFile))) {
    const files = fs.readdirSync(CACHE).filter(f => /^list-\d{4}-\d\d-\d\d\.json$/.test(f)).sort();
    if (!files.length) throw new Error('--recount: no listing in the cache');
    return JSON.parse(fs.readFileSync(path.join(CACHE, files.at(-1)), 'utf8'));
  }
  const search = (offset, sortBy, order) => getJson(`${API}/api/-/search?size=100&offset=${offset}&sortBy=${sortBy}&sortOrder=${order}&includeAllVersions=false`);
  const first = await search(0, 'downloadCount', 'desc');
  const total = first.totalSize;
  const byId = new Map();
  let repeated = 0;
  const take = (exts, rankOf) => exts.forEach((e, i) => {
    const id = `${e.namespace}.${e.name}`;
    if (byId.has(id.toLowerCase())) { repeated++; return; }
    byId.set(id.toLowerCase(), { rank: rankOf(i), id, namespace: e.namespace, name: e.name, version: e.version, platform: platformOf(e.files?.download), downloads: e.downloadCount ?? null });
  });
  const want = (lo, hi) => !RANKS || RANKS.some(([a, b]) => lo <= (b || a) && hi >= a);
  for (let off = 0; off < Math.min(total, CAP); off += 100) {
    if (!want(off + 1, off + 100)) continue;
    const j = off === 0 ? first : await search(off, 'downloadCount', 'desc');
    take(j.extensions, i => off + i + 1);
  }
  for (let off = 0; off < total - CAP; off += 100) {           // del final hacia arriba
    if (!want(total - off - 99, total - off)) continue;
    const j = await search(off, 'downloadCount', 'asc');
    take(j.extensions, i => total - off - i);
  }
  // los que el empate de descargas dejó fuera (puede haberlos aunque la lista
  // no se quede corta: entre las dos puntas del orden pueden entrar extensiones
  // nuevas): por fecha de publicación, siempre que se lee el catálogo entero
  let filled = 0, totalAtEnd = total;
  if (!RANKS) {
    const seen = new Set(byId.keys());
    const add = j => { totalAtEnd = j.totalSize; for (const e of j.extensions) { const k = `${e.namespace}.${e.name}`.toLowerCase(); if (!seen.has(k)) { seen.add(k); filled++; byId.set(k, { rank: null, id: `${e.namespace}.${e.name}`, namespace: e.namespace, name: e.name, version: e.version, platform: platformOf(e.files?.download), downloads: e.downloadCount ?? null }); } } };
    for (let off = 0; off < Math.min(total, CAP); off += 100) add(await search(off, 'timestamp', 'desc'));
    for (let off = 0; off < total - CAP; off += 100) add(await search(off, 'timestamp', 'asc'));
  }
  // (el catálogo crece mientras se lista: su tamaño al acabar es el que cuenta)
  const list = { date: today, total, totalAtEnd, repeated, filledByDate: filled, missing: RANKS ? null : Math.max(0, totalAtEnd - byId.size), extensions: [...byId.values()] };
  fs.writeFileSync(listFile, JSON.stringify(list));
  return list;
}

// ── 2. cada package.json, una vez, guardado tal cual (sin lo de compilar) ──
const DROP = ['scripts', 'devDependencies', 'dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'resolutions', 'overrides', 'readme', 'files', 'jest', 'eslintConfig', 'prettier', 'lint-staged', 'husky', 'packageManager', 'volta', 'pnpm', 'workspaces', '__metadata'];
const slim = m => { if (!m || typeof m !== 'object' || Array.isArray(m)) return null; const o = { ...m }; for (const k of DROP) delete o[k]; return o; };
async function read(e) {
  const base = `${API}/api/${encodeURIComponent(e.namespace)}/${encodeURIComponent(e.name)}`;
  const v = encodeURIComponent(e.version);
  let variant = 'universal', url = `${base}/${v}/file/package.json`;
  if (e.platform) {
    // la web de ESTA versión, si la publica (una compilación web más vieja no
    // es la que se instalaría), o la de la plataforma de la lista
    const meta = await getJson(`${base}/${v}`, { notFound: true });
    if (meta?.downloads?.web) { variant = 'web'; url = `${base}/web/${v}/file/package.json`; }
    else { variant = 'platform'; url = `${base}/${encodeURIComponent(e.platform)}/${v}/file/package.json`; }
  }
  const manifest = await getJson(url, { notFound: true });
  if (!manifest) return { id: e.id, version: e.version, rank: e.rank, variant, error: 'no package.json published' };
  return { id: e.id, version: e.version, rank: e.rank, variant, manifest: slim(manifest) };
}

const list = await listing();
const todo = list.extensions.filter(e => inRanks(e.rank)).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
console.log(`Open VSX on ${list.date}: ${list.total} extensions; listed ${list.extensions.length}${list.missing ? `, ${list.missing} not reachable by the search` : ''}; to classify: ${todo.length}${RANKS ? ' (ranks ' + arg('--ranks') + ')' : ''}`);

const rawFile = path.join(CACHE, 'raw.jsonl');
const done = new Map();
if (fs.existsSync(rawFile)) {
  for (const line of fs.readFileSync(rawFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const x = JSON.parse(line); done.set(x.id.toLowerCase(), x); } catch { /* línea a medias de una parada */ }
  }
}
const runsFile = path.join(CACHE, 'runs.json');
const runs = fs.existsSync(runsFile) ? JSON.parse(fs.readFileSync(runsFile, 'utf8')) : [];
if (!RECOUNT) {
  // (una por extensión y versión: si la lista trae otra versión, se vuelve a leer)
  const pending = todo.filter(e => { const d = done.get(e.id.toLowerCase()); return !d || d.version !== e.version; });
  const out = fs.openSync(rawFile, 'a');
  let n = 0;
  const worker = async () => {
    while (pending.length) {
      const e = pending.shift();
      const x = await read(e).catch(err => ({ id: e.id, version: e.version, rank: e.rank, error: String(err.message || err).slice(0, 200) }));
      x.rank = e.rank;
      done.set(x.id.toLowerCase(), x);
      fs.writeSync(out, JSON.stringify(x) + '\n');
      if (++n % 500 === 0) console.log(`  ${n} read, ${pending.length} to go`);
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  fs.closeSync(out);
  runs.push({ date: today, ranks: RANKS ? arg('--ranks') : 'all', requests, read: n });
  if (!RANKS) fs.writeFileSync(runsFile, JSON.stringify(runs, null, 1));
}

// ── 3. recuento, con las reglas del panel ──
const langs = JSON.parse(fs.readFileSync(path.join(HERE, 'lib/monaco-languages.json'), 'utf8'));
const builtin = new Set(langs.languages.map(l => l.id));
const monarch = new Set(langs.languages.filter(l => l.monarch).map(l => l.id));
const tested = JSON.parse(fs.readFileSync(path.join(HERE, '../web/js/ext2/tested.json'), 'utf8'));
const opts = { tested, builtinLanguage: id => builtin.has(id), grammarSkippedFor: id => builtin.has(id) && !monarch.has(id) };
const rows = todo.map(e => ({ e, x: done.get(e.id.toLowerCase()) })).filter(r => r.x);
const classes = rows.map(({ e, x }) => {
  if (x.error || !x.manifest) return { e, x, c: null };
  return { e, x, c: classify(x.manifest, opts) };
});
const ok = classes.filter(r => r.c);
const count = (set, f) => set.filter(f).length;
const tally = set => ({
  extensions: set.length,
  browserEntry: count(set, r => r.c.runtime === 'browser'),
  runsInSandbox: count(set, r => r.c.eligible),
  nodeOnly: count(set, r => r.c.runtime === 'node'),
  noCode: count(set, r => r.c.runtime === 'none'),
  declarativeApplies: count(set, r => r.c.hasDeclarative),
  worksInCode: count(set, r => r.c.works),
  worksOnlyThroughCode: count(set, r => r.c.works && !r.c.hasDeclarative),
  nothingWorks: count(set, r => !r.c.works),
});
const bands = {};
for (const n of [100, 500, 1000, 5000]) bands['top' + n] = tally(ok.filter(r => r.e.rank != null && r.e.rank <= n));
const summary = {
  schema: 1,
  date: list.date,
  method: 'Static census: every extension that the Open VSX search lists, its latest package.json (for one published per platform, the web build of that version if it has one, else the listed platform build), classified with Elffuss Code\'s panel rules (web/js/ext2/classify.js; Monaco 0.52.2\'s built-in languages; the runtime census in web/js/ext2/tested.json for the top 500). Nothing was downloaded as a .vsix, installed or run. "Runs in the sandbox" assumes a browser and a site where level 2 is available.',
  catalog: list.totalAtEnd ?? list.total,
  catalogWhenTheListingStarted: list.total,
  listed: list.extensions.length,
  notReachableBySearch: list.missing,
  ranks: RANKS ? arg('--ranks') : 'all',
  read: ok.length,
  unreadable: classes.length - ok.length,
  // las peticiones que pide leerlo todo una vez: dos listados de páginas de 100
  // (por descargas y por fecha), un package.json por extensión y, en las
  // publicadas por plataforma, la consulta de su compilación web
  requests: RANKS ? requests : 2 * Math.ceil((list.totalAtEnd ?? list.total) / 100) + classes.length + classes.filter(r => r.e.platform).length,
  ...tally(ok),
  browser: {
    runsAndShowsWorkbenchParts: count(ok, r => r.c.eligible && r.c.unavailable.length > 0),
    runsWithProposedApis: count(ok, r => r.c.eligible && r.c.apiProposals > 0),
    cannotRun: count(ok, r => r.c.runtime === 'browser' && !r.c.eligible),
    whyCannotRun: Object.fromEntries(['engine', 'never', 'census'].map(k => [k, count(ok, r => r.c.runtime === 'browser' && !r.c.eligible && r.c.reasons.includes(k))])),
    missingDependencies: count(ok, r => r.c.runtime === 'browser' && r.c.deps.missing.length > 0),
    testedInCode: count(ok, r => r.c.runtime === 'browser' && !!r.c.census),
  },
  workbenchContributions: Object.fromEntries(WORKBENCH.map(k => [k, count(ok, r => r.c.unavailable.includes(k))]).filter(([, n]) => n)),
  packs: count(ok, r => r.c.pack.length > 0),
  webBuilds: count(ok, r => r.x.variant === 'web'),
  bands,
};
const name = RANKS ? 'summary-ranks.json' : 'summary.json';
fs.writeFileSync(path.join(OUTDIR, name), JSON.stringify(summary, null, 1) + '\n');
if (!RANKS) {
  // una línea por extensión, para poder comprobar cada recuento
  const b = v => (v ? 1 : 0);
  const lines = ['rank\tid\tversion\tvariant\truntime\tdeclarative\truns_in_sandbox\tworks\tworkbench\twhy_not'];
  for (const { e, x, c } of classes.sort((p, q) => (p.e.rank ?? 1e9) - (q.e.rank ?? 1e9) || p.e.id.localeCompare(q.e.id))) {
    lines.push([e.rank ?? '-', e.id, x.version, x.variant || '-', c ? c.runtime : 'unreadable', b(c?.hasDeclarative), b(c?.eligible), b(c?.works), b(c && c.unavailable.length), c ? c.reasons.join(',') : (x.error || '')].join('\t'));
  }
  fs.writeFileSync(path.join(OUTDIR, 'extensions.tsv'), lines.join('\n') + '\n');
}
console.log(JSON.stringify(summary, null, 1));
console.log(`summary: ${path.relative(path.resolve(HERE, '..'), path.join(OUTDIR, name))}`);

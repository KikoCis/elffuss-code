// Static census of the WHOLE Open VSX catalog (manual, run once by the owner):
// one package.json per extension, classified with Code's own rules, so the
// README can give exact counts instead of an extrapolation from a sample.
//
//   node tests/catalog_census.mjs
//       every extension: tens of thousands of requests to Open VSX, 4 at a
//       time with a pause between batches; resumable (see below)
//   node tests/catalog_census.mjs --ranks 1-20,19301-19320
//       only those download ranks, to try it (a few dozen requests)
//   options: --pause <ms between batches, 300>  --out <summary file>
//
// Paging: the search API stops at offset 10,000, so ranks up to 10,000 are read
// by downloads, descending, and the rest from the other end, ascending. Every
// extension is then read once: its metadata (for a platform-specific one, its
// "web" build if it has one, as an install would) and its package.json. No
// .vsix is ever downloaded, and nothing is installed or run: that is
// tests/x2_census.mjs, on the top 500.
//
// Each extension is classified with level 1's analyzeManifest and
// web/js/ext2/classify.js: declarative parts that apply, browser code that
// can run in the sandbox (or why not), Node only, workbench parts that won't
// appear. What it reads goes to tests/.cache/catalog/ (one line per extension),
// so a stopped run continues where it was and a second run only recounts.
// The summary (counts, the date, no timings) is printed and written as JSON.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify } from '../web/js/ext2/classify.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API = 'https://open-vsx.org';
const CAP = 10000;                                    // la búsqueda no pasa de este desplazamiento
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PAUSE = Number(arg('--pause', 300));
const RANKS = arg('--ranks', '') ? arg('--ranks').split(',').map(r => r.split('-').map(Number)) : null;
const CACHE = path.join(HERE, '.cache', 'catalog');
const OUT = path.resolve(arg('--out', path.join(CACHE, RANKS ? 'summary-ranks.json' : 'summary.json')));
fs.mkdirSync(CACHE, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const inRanks = r => !RANKS || RANKS.some(([a, b]) => r >= a && r <= (b || a));

let requests = 0;
async function getJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    requests++;
    let r;
    try { r = await fetch(url, { headers: { 'User-Agent': 'elffuss-code-census' }, signal: AbortSignal.timeout(30000) }); }
    catch (e) { if (attempt === 3) throw e; await sleep(5000 * (attempt + 1)); continue; }
    if (r.status === 429 || r.status >= 500) { await sleep(15000 * (attempt + 1)); continue; }
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return r.json();
  }
  throw new Error('gave up after retries');
}

// ── 1. la lista, por descargas ──
const search = (offset, order) => getJson(`${API}/api/-/search?size=100&offset=${offset}&sortBy=downloadCount&sortOrder=${order}&includeAllVersions=false`);
const first = await search(0, 'desc');
const total = first.totalSize;
const today = new Date().toISOString().slice(0, 10);
const listFile = path.join(CACHE, `list-${today}.json`);
let list;
if (fs.existsSync(listFile)) list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
else {
  list = [];
  const take = (exts, rankOf) => exts.forEach((e, i) => list.push({ rank: rankOf(i), id: `${e.namespace}.${e.name}`, namespace: e.namespace, name: e.name, version: e.version }));
  const want = page => !RANKS || RANKS.some(([a, b]) => page.lo <= (b || a) && page.hi >= a);
  for (let off = 0; off < Math.min(total, CAP); off += 100) {
    const page = { lo: off + 1, hi: off + 100 };
    if (!want(page)) continue;
    const j = off === 0 ? first : await search(off, 'desc');
    take(j.extensions, i => off + i + 1);
    await sleep(PAUSE);
  }
  for (let off = 0; off < total - CAP; off += 100) {           // del final hacia arriba
    const page = { lo: total - off - 99, hi: total - off };
    if (!want(page)) continue;
    const j = await search(off, 'asc');
    take(j.extensions, i => total - off - i);
    await sleep(PAUSE);
  }
  if (!RANKS) fs.writeFileSync(listFile, JSON.stringify(list));
}
const seen = new Map();
for (const e of list) if (!seen.has(e.id.toLowerCase())) seen.set(e.id.toLowerCase(), e);
const todo = [...seen.values()].filter(e => inRanks(e.rank)).sort((a, b) => a.rank - b.rank);
console.log(`Open VSX today: ${total} extensions; to classify: ${todo.length}${RANKS ? ' (ranks ' + arg('--ranks') + ')' : ''}; repeated in the paging: ${list.length - seen.size}`);

// ── 2. cada package.json, una vez (4 a la vez, con pausa), y su clase ──
const progress = path.join(CACHE, 'manifests.jsonl');
const done = new Map();
if (fs.existsSync(progress)) {
  for (const line of fs.readFileSync(progress, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const x = JSON.parse(line); done.set(x.id.toLowerCase(), x); } catch { /* línea a medias de una parada */ }
  }
}
function classOf(manifest) {
  const c = classify(manifest);
  return {
    browser: typeof manifest.browser === 'string', main: typeof manifest.main === 'string', runtime: c.runtime,
    declarative: c.hasDeclarative, eligible: !!c.eligible, works: !!c.works, workbench: c.unavailable.length > 0,
    reasons: c.reasons || [], pack: Array.isArray(c.pack) && c.pack.length > 0,
  };
}
async function read(e) {
  const base = `${API}/api/${encodeURIComponent(e.namespace)}/${encodeURIComponent(e.name)}`;
  let meta = await getJson(base);
  let variant = (meta.targetPlatform || 'universal') === 'universal' ? 'universal' : 'platform';
  if (variant === 'platform' && meta.downloads && meta.downloads.web) { meta = await getJson(base + '/web'); variant = 'web'; }
  if (!meta.files?.manifest) return { id: e.id, version: meta.version || e.version, rank: e.rank, variant, error: 'no package.json published' };
  const manifest = await getJson(meta.files.manifest);
  return { id: e.id, version: meta.version || e.version, rank: e.rank, variant, ...classOf(manifest) };
}
const out = fs.openSync(progress, 'a');
let fresh = 0;
// (una por extensión: para volver a leerlas otro día, bórrese tests/.cache/catalog/)
const pending = todo.filter(e => !done.has(e.id.toLowerCase()));
for (let i = 0; i < pending.length; i += 4) {
  const batch = pending.slice(i, i + 4);
  const got = await Promise.all(batch.map(e => read(e).catch(err => ({ id: e.id, version: e.version, rank: e.rank, error: String(err.message || err).slice(0, 200) }))));
  for (const x of got) { done.set(x.id.toLowerCase(), x); fs.writeSync(out, JSON.stringify(x) + '\n'); fresh++; }
  if ((i / 4) % 50 === 0) console.log(`  ${Math.min(i + 4, pending.length)} of ${pending.length} read`);
  await sleep(PAUSE);
}
fs.closeSync(out);

// ── 3. recuento ──
const rows = todo.map(e => done.get(e.id.toLowerCase())).filter(Boolean);
const ok = rows.filter(r => !r.error);
const n = f => ok.filter(f).length;
const summary = {
  date: today, catalog: total, classified: ok.length, unreadable: rows.length - ok.length,
  ranks: RANKS ? arg('--ranks') : 'all', requestsThisRun: requests, readThisRun: fresh,
  browserEntry: n(r => r.browser),
  browserRunsInSandbox: n(r => r.browser && r.eligible),
  browserRunsAndShowsWorkbenchParts: n(r => r.browser && r.eligible && r.workbench),
  browserCannotRun: n(r => r.browser && !r.eligible),
  nodeOnly: n(r => r.main && !r.browser),
  noCode: n(r => !r.main && !r.browser),
  declarativeApplies: n(r => r.declarative),
  worksInCode: n(r => r.works),
  worksOnlyThroughCode: n(r => r.works && !r.declarative),
  nothingWorks: n(r => !r.works),
  packs: n(r => r.pack),
  whyBrowserCannotRun: Object.fromEntries(['engine', 'proposals', 'never', 'deps'].map(k => [k, n(r => r.browser && !r.eligible && r.reasons.includes(k))])),
  webBuilds: n(r => r.variant === 'web'),
};
fs.writeFileSync(OUT, JSON.stringify(summary, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
console.log(`summary: ${path.relative(path.resolve(HERE, '..'), OUT)}`);

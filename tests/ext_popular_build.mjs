// Builds web/js/ext/popular.json: the "Popular" list of the Extensions panel.
// Only extensions whose main value works in Code as soon as they are installed
// (colour themes, highlighting for a language Code does not have yet, snippet
// packs), ordered by Open VSX downloads.
//
//   node tests/ext_popular_build.mjs --census <extensions.tsv> [--draft] [--n 36]
//
// --census  the static census of the whole catalog (tests/catalog_census.mjs
//           writes tests/catalog-census/extensions.tsv; that is the default)
// --draft   print every candidate with its verdict and the reason it was left
//           out, and write nothing (to curate: add an entry to TEXT or SKIP)
// --n       how many entries (36)
//
// What it reads, all with GET and at most one request every 400 ms: for each
// candidate its Open VSX metadata and published package.json (and
// package.nls.json when names are %keys%), and once Monaco 0.52.2's bundle from
// jsdelivr, to know which languages and file extensions Code already
// highlights. Cached in tests/.cache/popular/, so a second run is offline.
//
// Rules, in order:
//   1. census: runtime=none (no code at all), works=1, declarative=1, ranked
//   2. not a built-in language pack (vscode.*) and not in SKIP
//   3. the panel's own verdict (web/js/ext/verdict.js) is "works in Code" (full)
//   4. nothing it brings duplicates Code: no grammar for a language Monaco
//      already highlights, for a file extension Monaco already claims, or for
//      VS Code's id of a language Code names differently (no file of its own)
//   5. it has a hand-written one-line description in TEXT (es and en)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeManifest, resolveNls } from '../web/js/ext/vsix.js';
import { describe, factsFromManifest } from '../web/js/ext/verdict.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CENSUS = path.resolve(arg('--census', path.join(HERE, 'catalog-census/extensions.tsv')));
const DRAFT = process.argv.includes('--draft');
const N = Number(arg('--n', 36));
const CACHE = path.join(HERE, '.cache', 'popular');
const OUT = path.join(ROOT, 'web/js/ext/popular.json');
const API = 'https://open-vsx.org';
const MONACO = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/editor/editor.main.js';
fs.mkdirSync(CACHE, { recursive: true });

// Left out on purpose, with the reason.
const SKIP = {
  'ms-vscode.cpptools-themes': 'the Visual Studio colours Code already has as its default dark and light themes',
  'ms-vscode.vscode-typescript-next': 'TypeScript and JavaScript are already highlighted',
};

// One plain line per entry: what you get. Kept by hand so it says what the
// extension is FOR, not what its package.json lists.
const TEXT = {
  // themes
  'gitpod.gitpod-theme': ['Los temas de Gitpod, claro y oscuro, de tonos suaves.', 'Gitpod\'s soft light and dark themes.'],
  'dracula-theme.theme-dracula': ['Dracula: el tema oscuro de fondo morado y colores vivos.', 'Dracula: the dark theme with a purple background and vivid colours.'],
  'GitHub.github-vscode-theme': ['Los temas de GitHub, claros y oscuros, también de alto contraste.', 'GitHub\'s light and dark themes, high-contrast ones included.'],
  'jdinhlife.gruvbox': ['Gruvbox: tonos cálidos y retro, en claro y en oscuro.', 'Gruvbox: warm retro tones, light and dark.'],
  'akamud.vscode-theme-onedark': ['One Dark, el tema oscuro clásico de Atom.', 'One Dark, Atom\'s classic dark theme.'],
  'enkia.tokyo-night': ['Tokyo Night: oscuro, con los colores de Tokio de noche.', 'Tokyo Night: dark, in the colours of Tokyo at night.'],
  'BeardedBear.beardedtheme': ['Bearded Theme: decenas de variantes, de muy oscuras a claras.', 'Bearded Theme: dozens of variants, from very dark to light.'],
  'sdras.night-owl': ['Night Owl: pensado para programar de noche; también en claro.', 'Night Owl: made for coding at night; a light one too.'],
  'ahmadawais.shades-of-purple': ['Shades of Purple: morados intensos y amarillo.', 'Shades of Purple: bold purples with yellow.'],
  'arcticicestudio.nord-visual-studio-code': ['Nord: azules fríos del Ártico, sereno y limpio.', 'Nord: cool Arctic blues, calm and clean.'],
  'johnpapa.winteriscoming': ['Winter is Coming: azul oscuro, negro y una versión clara.', 'Winter is Coming: dark blue, black and a light one.'],
  'wesbos.theme-cobalt2': ['Cobalt2: azul cobalto con amarillo, de Wes Bos.', 'Cobalt2: cobalt blue with yellow, by Wes Bos.'],
  'aleksa-codes.one-dark-modern-pro': ['One Dark Modern Pro: One Dark con los colores de la interfaz actual.', 'One Dark Modern Pro: One Dark with a modern interface palette.'],
  'metaphore.kanagawa-vscode-color-theme': ['Kanagawa: colores de la estampa japonesa La gran ola.', 'Kanagawa: colours from the Japanese print The Great Wave.'],
  'liviuschera.noctis': ['Noctis: once temas, claros y oscuros, de colores templados.', 'Noctis: eleven light and dark themes in calm colours.'],
  'jolaleye.horizon-theme-vscode': ['Horizon: oscuro y cálido, con rosas y naranjas.', 'Horizon: warm and dark, with pinks and oranges.'],
  'antfu.theme-vitesse': ['Vitesse: temas sobrios en claro, oscuro y negro.', 'Vitesse: understated light, dark and black themes.'],
  // languages Code does not have
  'wholroyd.jinja': ['Resalta plantillas Jinja (.j2, .jinja), también dentro de HTML y YAML.', 'Highlights Jinja templates (.j2, .jinja), inside HTML and YAML too.'],
  'mikestead.dotenv': ['Resalta los ficheros .env de variables de entorno.', 'Highlights .env files of environment variables.'],
  'bpruitt-goddard.mermaid-markdown-syntax-highlighting': ['Resalta diagramas Mermaid (.mmd, .mermaid).', 'Highlights Mermaid diagrams (.mmd, .mermaid).'],
  'bbenoist.Doxygen': ['Resalta ficheros de documentación Doxygen (.dox).', 'Highlights Doxygen documentation files (.dox).'],
  'IBM.output-colorizer': ['Colorea ficheros de log (.log): fechas, niveles, errores.', 'Colours log files (.log): dates, levels, errors.'],
  'bbenoist.Nix': ['Resalta el lenguaje Nix (.nix).', 'Highlights the Nix language (.nix).'],
  'mrmlnc.vscode-apache': ['Resalta la configuración de Apache (.htaccess, .conf).', 'Highlights Apache configuration (.htaccess, .conf).'],
  // snippets
  'EricSia.pythonsnippets3': ['Snippets de Python: bucles, clases, funciones y más con un prefijo.', 'Python snippets: loops, classes, functions and more from a prefix.'],
  'xabikos.JavaScriptSnippets': ['Snippets de JavaScript y TypeScript: imports, funciones flecha, console.log…', 'JavaScript and TypeScript snippets: imports, arrow functions, console.log…'],
  'johnpapa.Angular2': ['Snippets de Angular: componentes, servicios y rutas en TypeScript y HTML.', 'Angular snippets: components, services and routes in TypeScript and HTML.'],
  'eventyret.bootstrap-4-cdn-snippet': ['Snippets de Bootstrap 4: la página base con el CDN y sus componentes.', 'Bootstrap 4 snippets: the starter page with the CDN and its components.'],
  'dannysteenman.cdk-snippets': ['Snippets de AWS CDK para Python y TypeScript.', 'AWS CDK snippets for Python and TypeScript.'],
  'onecentlin.laravel5-snippets': ['Snippets de Laravel en PHP: rutas, modelos, consultas.', 'Laravel snippets in PHP: routes, models, queries.'],
  'Nash.awesome-flutter-snippets': ['Snippets de Flutter en Dart: widgets y su estructura.', 'Flutter snippets in Dart: widgets and their boilerplate.'],
  'hollowtree.vue-snippets': ['Snippets de Vue 2 en JavaScript, TypeScript y HTML.', 'Vue 2 snippets in JavaScript, TypeScript and HTML.'],
  'HansUXdev.bootstrap5-snippets': ['Snippets de Bootstrap 5 y Font Awesome en HTML.', 'Bootstrap 5 and Font Awesome snippets in HTML.'],
  'robole.markdown-snippets': ['Snippets de Markdown: tablas, enlaces, imágenes, listas de tareas.', 'Markdown snippets: tables, links, images, task lists.'],
  'imgildev.vscode-tailwindcss-snippets': ['Snippets de Tailwind CSS en HTML.', 'Tailwind CSS snippets in HTML.'],
  'donjayamanne.jquerysnippets': ['Más de 130 snippets de jQuery en JavaScript y HTML.', 'Over 130 jQuery snippets in JavaScript and HTML.'],
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
let next = 0, requests = 0;
async function get(url, { json = true, notFound = false } = {}) {
  const file = path.join(CACHE, encodeURIComponent(url).slice(0, 240));
  if (fs.existsSync(file)) { const t = fs.readFileSync(file, 'utf8'); return t === '\u0000404' ? null : json ? JSON.parse(t) : t; }
  for (let i = 1; i <= 5; i++) {
    const wait = next - Date.now();
    next = Math.max(Date.now(), next) + 400;
    if (wait > 0) await sleep(wait);
    requests++;
    const r = await fetch(url, { headers: { 'User-Agent': 'elffuss-code-popular' } }).catch(() => null);
    if (!r || r.status === 429 || r.status >= 500) { await sleep(5000 * i); continue; }
    if (r.status === 404 && notFound) { fs.writeFileSync(file, '\u0000404'); return null; }
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    const t = await r.text();
    fs.writeFileSync(file, t);
    return json ? JSON.parse(t) : t;
  }
  throw new Error('gave up: ' + url);
}

// ── what Code already highlights: Monaco's languages and their file extensions ──
const bundle = await get(MONACO, { json: false });
const builtin = new Set();
const claimed = new Set();
for (const m of bundle.matchAll(/id:"([\w.+-]+)",extensions:\[([^\]]*)\]/g)) {
  builtin.add(m[1]);
  for (const x of m[2].matchAll(/"([^"]+)"/g)) claimed.add(x[1].toLowerCase());
}
for (const m of bundle.matchAll(/registerLanguage\(\{id:"([\w.+-]+)"/g)) builtin.add(m[1]);
if (builtin.size < 60 || !claimed.has('.js') || !claimed.has('.json')) throw new Error(`could not read Monaco's languages from ${MONACO} (${builtin.size} found)`);
// the panel's host, as Node sees it (no extension installed)
const host = {
  builtinLanguage: id => builtin.has(id),
  grammarSkippedFor: id => id === 'json' || id === 'plaintext',     // Monaco's built-ins without Monarch
  languageName: () => null,
  languageExtensions: () => [],
};

// ── 1. census ──
if (!fs.existsSync(CENSUS)) throw new Error(`no census at ${CENSUS}: pass --census <extensions.tsv>`);
const [head, ...lines] = fs.readFileSync(CENSUS, 'utf8').trim().split('\n');
const cols = head.split('\t');
const rows = lines.map(l => Object.fromEntries(l.split('\t').map((v, i) => [cols[i], v])));
const candidates = rows.filter(r => r.runtime === 'none' && r.works === '1' && r.declarative === '1' && /^\d+$/.test(r.rank))
  .sort((a, b) => a.rank - b.rank);
console.log(`census: ${rows.length} extensions; ${candidates.length} with no code that work in Code`);

// a grammar duplicates Code when its language is Monaco's, or when every file
// extension of that language is already Monaco's
function duplicates(pkg) {
  const c = pkg.contributes || {};
  const langs = Array.isArray(c.languages) ? c.languages : [];
  const out = [];
  for (const g of Array.isArray(c.grammars) ? c.grammars : []) {
    const id = g?.language;
    if (typeof id !== 'string') continue;                 // injections: they add to another grammar
    if (builtin.has(id)) { out.push(id); continue; }
    const own = langs.filter(l => l?.id === id);
    const exts = own.flatMap(l => (Array.isArray(l.extensions) ? l.extensions : [])).map(x => String(x).toLowerCase());
    const names = own.flatMap(l => [...(Array.isArray(l.filenames) ? l.filenames : []), ...(Array.isArray(l.filenamePatterns) ? l.filenamePatterns : [])]);
    if (!exts.length && !names.length) out.push(`${id} (no file of its own: VS Code's id for a language Code names differently)`);
    // a file extension Monaco already has would be taken over (PostCSS claims .css)
    else if (exts.some(x => claimed.has(x))) out.push(`${id} (${exts.filter(x => claimed.has(x)).join(' ')})`);
  }
  return out;
}

function kindOf(f) {
  if (f.highlight.length || f.settingsOnly.length) return 'language';
  if (f.snippets.length) return 'snippets';
  if (f.themes.length) return 'theme';
  return null;
}

const picked = [];
const draft = [];
for (const r of candidates) {
  if (!DRAFT && picked.length >= N) break;
  if (DRAFT && r.rank > 3000) break;
  const why = reason => draft.push({ rank: r.rank, id: r.id, reason });
  if (r.id.startsWith('vscode.')) { why('built-in language pack'); continue; }
  if (SKIP[r.id]) { why('skip: ' + SKIP[r.id]); continue; }
  const [ns, name] = [r.id.slice(0, r.id.indexOf('.')), r.id.slice(r.id.indexOf('.') + 1)];
  const base = `${API}/api/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/${encodeURIComponent(r.version)}`;
  const meta = await get(base, { notFound: true });
  if (!meta || meta.error) { why('no metadata'); continue; }
  if (meta.deprecated) { why('deprecated'); continue; }
  let pkg = await get(`${base}/file/package.json`, { notFound: true });
  if (!pkg) { why('no package.json'); continue; }
  if (JSON.stringify(pkg.contributes || {}).includes('"%')) {
    const nls = await get(`${base}/file/package.nls.json`, { notFound: true });
    if (nls) pkg = resolveNls(pkg, nls);
  }
  const a = analyzeManifest(pkg);
  const f = factsFromManifest(host, a);
  const v = describe(f);
  if (v.kind !== 'full') { why(`verdict ${v.kind}: ${v.verdict}`); continue; }
  const dup = duplicates(pkg);
  if (dup.length) { why(`duplicates Code: ${dup.join(', ')}`); continue; }
  const kind = kindOf(f);
  if (!kind) { why('nothing'); continue; }
  const text = TEXT[r.id];
  if (text === null) { why('left out by hand'); continue; }
  if (!text) { why(`NEEDS TEXT (${kind}): ${v.verdict} | ${meta.displayName}: ${meta.description}`); continue; }
  draft.push({ rank: r.rank, id: r.id, reason: `OK ${kind}: ${v.verdict}` });
  picked.push({
    id: r.id, namespace: meta.namespace, name: meta.name, version: meta.version,
    displayName: String(meta.displayName || meta.name), kind,
    description: { es: text[0], en: text[1] },
    downloads: Number(meta.downloadCount) || 0, rank: Number(r.rank), verified: !!meta.verified,
    // what the panel needs to give its verdict with no request (vsix.js analyzeManifest)
    analysis: {
      hasCode: a.hasCode, browserEntry: a.browserEntry, categories: a.categories, sizes: a.sizes, webviews: a.webviews,
      ignored: a.ignored, pack: a.pack, themeLabels: a.themeLabels, grammarLangs: a.grammarLangs, languageList: a.languageList, snippetLangs: a.snippetLangs,
    },
  });
}

if (DRAFT) {
  for (const d of draft) console.log(`${String(d.rank).padStart(5)}  ${d.id.padEnd(55)} ${d.reason}`);
  console.log(`\n${picked.length} would be picked; ${requests} requests`);
  process.exit(0);
}
if (picked.length < N) throw new Error(`only ${picked.length} of ${N}: run with --draft and add TEXT entries`);
const top10 = new Set(picked.slice(0, 10).map(p => p.kind));
if (top10.size < 3) console.warn(`warning: the top 10 has only ${[...top10].join(', ')}`);
const out = {
  schema: 1,
  note: 'Generated by tests/ext_popular_build.mjs from the Open VSX census; do not edit by hand.',
  census: path.basename(path.dirname(CENSUS)) + '/' + path.basename(CENSUS),
  items: picked,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`${picked.length} entries → ${path.relative(ROOT, OUT)}; ${requests} requests`);
for (const p of picked) console.log(`${String(p.rank).padStart(5)}  ${p.kind.padEnd(9)} ${p.id}`);

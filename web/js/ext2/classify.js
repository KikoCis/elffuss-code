// Qué funcionará de una extensión en Elffuss Code, ANTES de instalarla, a
// partir de su package.json (y del censo en ejecución, tested.json, si la
// probamos). Lo usa el panel de extensiones para decirlo con honradez:
//
//   · lo declarativo (nivel 1): temas, gramáticas, snippets, lenguajes;
//   · código para el navegador que puede correr en el recinto (nivel 2);
//   · «necesita Node»: no está disponible en el navegador;
//   · lo que no aparecerá aquí (vistas, webviews, depurador…);
//   · si la probamos en Code y qué pasó, o que aún no.
//
// Es pequeño y no carga nada del recinto: viaja con el panel.
import { analyzeManifest } from '../ext/vsix.js';

export const VSCODE = '1.138.0';

// Contribuciones que necesitan la interfaz completa de VS Code: aquí no salen.
export const WORKBENCH = ['views', 'viewsContainers', 'viewsWelcome', 'customEditors', 'notebooks', 'notebookRenderer', 'walkthroughs', 'debuggers',
  'breakpoints', 'terminal', 'taskDefinitions', 'problemMatchers', 'authentication', 'chatParticipants', 'languageModelTools',
  'mcpServerDefinitionProviders', 'resourceLabelFormatters', 'statusBarItems', 'remoteHelp', 'typescriptServerPlugins'];
// Eventos de activación que en Code nunca ocurren
const NEVER = [/^workspaceContains:/, /^onView:/, /^onWebviewPanel:/, /^onCustomEditor:/, /^onNotebook(Serializer)?:?/, /^onDebug/, /^onTerminalProfile:/,
  /^onAuthenticationRequest:/, /^onChatParticipant:/, /^onWalkthrough:/, /^onOpenExternalUri:/, /^onFileSystem:/, /^onSearch:/, /^onTaskType:/, /^onRenderer:/];

// ¿satisface 1.138.0 el rango de engines.vscode? (^x.y.z, ~x.y.z, >=x.y.z, x.y.z, *)
const triple = s => { const m = /^(\d+)\.(\d+|x|\*)(?:\.(\d+|x|\*))?/.exec(s); return m ? [Number(m[1]), m[2] === 'x' || m[2] === '*' ? 0 : Number(m[2]), m[3] === undefined || m[3] === 'x' || m[3] === '*' ? 0 : Number(m[3])] : null; };
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
export function engineOk(range, version = VSCODE) {
  if (typeof range !== 'string' || !range.trim() || range.trim() === '*') return true;
  const v = triple(version);
  const r = range.trim().replace(/-[\w.]+$/, '');
  let m;
  if ((m = /^\^\s*(.+)$/.exec(r))) { const t = triple(m[1]); return !!t && cmp(v, t) >= 0 && v[0] === t[0]; }
  if ((m = /^~\s*(.+)$/.exec(r))) { const t = triple(m[1]); return !!t && cmp(v, t) >= 0 && v[0] === t[0] && v[1] === t[1]; }
  if ((m = /^>=\s*(.+)$/.exec(r))) { const t = triple(m[1]); return !!t && cmp(v, t) >= 0; }
  const t = triple(r);
  return t ? cmp(v, t) >= 0 : true;                // sin entenderlo, no se bloquea
}

const arr = v => (Array.isArray(v) ? v : []);
function settingsCount(conf) {
  let n = 0;
  for (const c of [].concat(conf || [])) if (c && typeof c.properties === 'object' && c.properties) n += Object.keys(c.properties).length;
  return n;
}

export function classify(manifest, { tested = null, installed = new Set() } = {}) {
  const m = manifest && typeof manifest === 'object' ? manifest : {};
  const c = m.contributes && typeof m.contributes === 'object' ? m.contributes : {};
  const a = analyzeManifest(m);
  const id = `${m.publisher}.${m.name}`.toLowerCase();
  const runtime = typeof m.browser === 'string' ? 'browser' : typeof m.main === 'string' ? 'node' : 'none';
  const events = arr(m.activationEvents).filter(e => typeof e === 'string');
  const neverEvents = events.filter(e => NEVER.some(r => r.test(e)));
  // solo eventos que nunca llegan (y ninguna otra forma de activarse)
  const startsNever = runtime === 'browser' && events.length > 0 && neverEvents.length === events.length && !arr(c.commands).length && !arr(c.languages).length;
  const deps = arr(m.extensionDependencies).filter(d => typeof d === 'string').map(d => d.toLowerCase());
  const unavailable = WORKBENCH.filter(k => c[k] !== undefined && (!Array.isArray(c[k]) || c[k].length) && (typeof c[k] !== 'object' || Object.keys(c[k]).length));
  const apiProposals = arr(m.enabledApiProposals).length;
  const engine = engineOk(m.engines && m.engines.vscode);
  const census = tested && tested.results && typeof m.version === 'string' ? tested.results[`${id}@${m.version}`] || null : null;
  const reasons = [];
  if (runtime === 'browser') {
    if (!engine) reasons.push('engine');
    if (apiProposals) reasons.push('proposals');
    if (startsNever) reasons.push('never');
    if (deps.some(d => !installed.has(d))) reasons.push('deps');
  }
  const failed = !!census && ['error', 'install-failed', 'unsupported'].includes(census.state);
  if (failed) reasons.push('census');
  const declarative = { themes: a.applies.themes, grammars: a.applies.grammars, snippets: a.applies.snippets, languages: a.applies.languages };
  const hasDeclarative = Object.values(declarative).some(Boolean);
  // «puede correr»: entrada de navegador, sin nada que lo impida de antemano.
  // Si faltan dependencias aún puede instalarse, pero se dice.
  const eligible = runtime === 'browser' && engine && !apiProposals && !startsNever && !failed;
  return {
    id, version: typeof m.version === 'string' ? m.version : '', runtime, engineOk: engine, apiProposals, startsNever, neverEvents,
    deps: { all: deps, missing: deps.filter(d => !installed.has(d)) }, unavailable, declarative, hasDeclarative, ignored: a.ignored,
    counts: { commands: arr(c.commands).length, keybindings: arr(c.keybindings).length, settings: settingsCount(c.configuration) },
    census, eligible, reasons,
    // ¿algo de ella funciona en Code? (para el filtro)
    works: hasDeclarative || eligible,
    pack: a.pack,
  };
}

// Ajustes que escribe el usuario (JSON) contra los que la extensión declara
// en contributes.configuration: solo claves suyas y del tipo que dice.
export function contributedSettings(manifest) {
  const out = Object.create(null);                 // sin prototipo: «__proto__» no es un ajuste
  const conf = manifest && manifest.contributes && manifest.contributes.configuration;
  for (const c of [].concat(conf || [])) {
    if (!c || typeof c.properties !== 'object' || !c.properties) continue;
    for (const [k, v] of Object.entries(c.properties)) if (k !== '__proto__' && v && typeof v === 'object') out[k] = v;
  }
  return out;
}
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const fits = (v, t) => t === typeOf(v) || (t === 'number' && typeof v === 'number') || (t === 'integer' && Number.isInteger(v));
export function validateSettings(manifest, text) {
  let v;
  try { v = JSON.parse(String(text ?? '').trim() || '{}'); } catch (e) { return { ok: false, errors: [{ code: 'json', detail: String(e.message || e).slice(0, 200) }] }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, errors: [{ code: 'object' }] };
  const known = contributedSettings(manifest);
  const errors = [];
  for (const [k, x] of Object.entries(v)) {
    const p = Object.hasOwn(known, k) ? known[k] : null;
    if (!p) { errors.push({ code: 'unknown', key: k }); continue; }
    const types = [].concat(p.type || []).filter(t => typeof t === 'string');
    if (types.length && !types.some(t => fits(x, t))) { errors.push({ code: 'type', key: k, type: types.join(' | ') }); continue; }
    if (Array.isArray(p.enum) && p.enum.length && !p.enum.some(e => JSON.stringify(e) === JSON.stringify(x))) errors.push({ code: 'enum', key: k, list: p.enum.slice(0, 10).map(e => JSON.stringify(e)).join(', ') });
  }
  if (JSON.stringify(v).length > 100000) errors.push({ code: 'big' });
  return errors.length ? { ok: false, errors } : { ok: true, value: v };
}

let censo = null;
export function loadTested() {
  censo ??= fetch(new URL('./tested.json', import.meta.url), { cache: 'no-cache', credentials: 'same-origin' })
    .then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(j => (j && j.schema === 1 && j.results && typeof j.results === 'object' ? j : null));
  return censo;
}

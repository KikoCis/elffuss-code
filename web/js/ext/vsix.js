// Un .vsix (zip) → lo que Elffuss Code sabe aplicar: temas, gramáticas,
// snippets y lenguajes. NUNCA se lee, importa ni evalúa JavaScript del
// paquete: `main` y `browser` se ignoran y solo se descomprimen el manifiesto,
// sus traducciones, la licencia y los ficheros que citan esas contribuciones.
import { openZip } from './unzip.js';
import { parseJsonc, parsePlist } from './formats.js';
import { loadTheme, joinPath } from './themes.js';
import { normalizeSnippets } from './snippets.js';

export const SUPPORTED = ['themes', 'grammars', 'snippets', 'languages'];

// Contribuciones que solo tienen sentido con el código de la extensión
// corriendo (haría falta un host de extensiones). El resto de las que no se
// aplican son declarativas: «todavía no».
const NEEDS_CODE = new Set([
  'commands', 'menus', 'submenus', 'keybindings', 'views', 'viewsContainers', 'viewsWelcome', 'debuggers',
  'breakpoints', 'taskDefinitions', 'customEditors', 'notebooks', 'notebookRenderer', 'authentication',
  'walkthroughs', 'terminal', 'codeActions', 'configuration', 'typescriptServerPlugins', 'chatParticipants',
  'languageModelTools', 'mcpServerDefinitionProviders', 'remoteHelp', 'resourceLabelFormatters', 'statusBarItems',
]);

// Lo que una extensión aplicaría aquí y lo que no, a partir de su package.json
// (sirve igual con el manifiesto que publica Open VSX que con el del .vsix).
export function analyzeManifest(pkg) {
  const c = pkg && typeof pkg.contributes === 'object' && pkg.contributes ? pkg.contributes : {};
  const n = k => (Array.isArray(c[k]) ? c[k].length : 0);
  const applies = { themes: n('themes'), grammars: n('grammars'), snippets: n('snippets'), languages: n('languages') };
  const ignored = [];
  for (const k of Object.keys(c)) {
    if (SUPPORTED.includes(k)) continue;
    ignored.push({ key: k, why: NEEDS_CODE.has(k) ? 'code' : 'later' });
  }
  const hasCode = typeof pkg?.main === 'string' || typeof pkg?.browser === 'string';
  const pack = Array.isArray(pkg?.extensionPack) ? pkg.extensionPack.filter(x => typeof x === 'string') : [];
  const snippetLangs = [...new Set((c.snippets || []).map(s => s?.language).filter(x => typeof x === 'string'))];
  const languages = [...new Set([...(c.languages || []).map(l => l?.id), ...(c.grammars || []).map(g => g?.language)].filter(x => typeof x === 'string'))];
  return { applies, ignored, hasCode, pack, snippetLangs, languages, any: Object.values(applies).some(Boolean) };
}

// %clave% → texto de package.nls(.<idioma>).json, en todo el manifiesto.
export function resolveNls(pkg, nls) {
  const msg = v => (typeof v === 'string' ? v : v && typeof v.message === 'string' ? v.message : null);
  const walk = v => {
    if (typeof v === 'string') {
      const m = /^%([^%\s]+)%$/.exec(v);
      return m && msg(nls?.[m[1]]) != null ? msg(nls[m[1]]) : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x); return o; }
    return v;
  };
  return walk(pkg);
}

const strs = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);
const mapaStr = v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === 'string') o[k] = x;
  return o;
};

// Lee el paquete entero. Los fallos de una contribución suelta van a
// `warnings` y no tumban la instalación del resto.
export async function readVsix(bytes, { lang = 'en' } = {}) {
  const zip = openZip(bytes);
  const dec = new TextDecoder();
  const readText = async p => {
    if (!p.startsWith('extension/')) throw new Error('ruta fuera de la extensión: ' + p);
    return dec.decode(await zip.read(p));
  };
  if (!zip.has('extension/package.json')) throw Object.assign(new Error('no es una extensión de VS Code (falta extension/package.json)'), { code: 'notvsix' });
  let pkg = parseJsonc(await readText('extension/package.json'));
  let nls = {};
  for (const f of ['extension/package.nls.json', `extension/package.nls.${lang}.json`]) {
    if (zip.has(f)) { try { nls = { ...nls, ...parseJsonc(await readText(f)) }; } catch { /* traducción rota: se queda la clave */ } }
  }
  pkg = resolveNls(pkg, nls);
  if (typeof pkg.name !== 'string' || typeof pkg.publisher !== 'string') throw new Error('package.json sin name/publisher');

  const warnings = [];
  const ruta = p => joinPath('extension', String(p));
  const c = pkg.contributes && typeof pkg.contributes === 'object' ? pkg.contributes : {};

  const themes = [];
  for (const [i, t] of (Array.isArray(c.themes) ? c.themes : []).entries()) {
    if (!t || typeof t.path !== 'string') continue;
    try {
      const data = await loadTheme(ruta(t.path), readText, { label: t.label || t.id || t.path, uiTheme: t.uiTheme });
      themes.push({ index: i, id: typeof t.id === 'string' ? t.id : '', label: data.label, uiTheme: data.uiTheme, path: ruta(t.path), data });
    } catch (e) { warnings.push(`tema ${t.label || t.path}: ${e.message}`); }
  }

  const grammars = [];
  for (const g of Array.isArray(c.grammars) ? c.grammars : []) {
    if (!g || typeof g.path !== 'string' || typeof g.scopeName !== 'string') continue;
    try {
      const p = ruta(g.path);
      const text = await readText(p);
      const data = /\.json$/i.test(p) ? parseJsonc(text) : parsePlist(text);
      if (!data || typeof data !== 'object' || !Array.isArray(data.patterns) && !data.injectionSelector) throw new Error('no parece una gramática TextMate');
      grammars.push({
        path: p, scopeName: g.scopeName, data,
        language: typeof g.language === 'string' ? g.language : undefined,
        embeddedLanguages: mapaStr(g.embeddedLanguages), tokenTypes: mapaStr(g.tokenTypes),
        injectTo: strs(g.injectTo), balancedBracketScopes: Array.isArray(g.balancedBracketScopes) ? strs(g.balancedBracketScopes) : undefined,
        unbalancedBracketScopes: Array.isArray(g.unbalancedBracketScopes) ? strs(g.unbalancedBracketScopes) : undefined,
      });
    } catch (e) { warnings.push(`gramática ${g.scopeName}: ${e.message}`); }
  }

  const snippets = [];
  const porRuta = new Map();
  for (const s of Array.isArray(c.snippets) ? c.snippets : []) {
    if (!s || typeof s.path !== 'string' || typeof s.language !== 'string') continue;
    const p = ruta(s.path);
    try {
      if (!porRuta.has(p)) porRuta.set(p, normalizeSnippets(parseJsonc(await readText(p))));
      if (porRuta.get(p).length) snippets.push({ language: s.language, path: p, data: porRuta.get(p) });
    } catch (e) { warnings.push(`snippets ${s.path}: ${e.message}`); }
  }

  const languages = [];
  for (const l of Array.isArray(c.languages) ? c.languages : []) {
    if (!l || typeof l.id !== 'string' || !l.id) continue;
    const entry = {
      id: l.id, aliases: strs(l.aliases), extensions: strs(l.extensions), filenames: strs(l.filenames),
      filenamePatterns: strs(l.filenamePatterns), mimetypes: strs(l.mimetypes),
      firstLine: typeof l.firstLine === 'string' ? l.firstLine : undefined, configPath: null, config: null,
    };
    if (typeof l.configuration === 'string') {
      try { entry.configPath = ruta(l.configuration); entry.config = parseJsonc(await readText(entry.configPath)); }
      catch (e) { warnings.push(`configuración de ${l.id}: ${e.message}`); entry.configPath = null; }
    }
    languages.push(entry);
  }

  // licencia: la que diga «SEE LICENSE IN x» o el LICENSE* de la raíz
  let licenseText = '';
  const ref = /^SEE LICEN[SC]E IN (.+)$/i.exec(String(pkg.license || ''))?.[1]?.trim();
  const candidatas = [ref && ruta(ref), ...zip.names.filter(n => /^extension\/licen[sc]e(\.[\w-]+|-[\w.-]+)?$/i.test(n))].filter(Boolean);
  for (const f of candidatas) {
    if (!zip.has(f)) continue;
    try { licenseText = (await readText(f)).slice(0, 200_000); break; } catch { /* siguiente */ }
  }

  return {
    manifest: pkg,
    publisher: pkg.publisher, name: pkg.name, version: String(pkg.version || '0.0.0'),
    id: `${pkg.publisher}.${pkg.name}`.toLowerCase(),
    displayName: typeof pkg.displayName === 'string' ? pkg.displayName : pkg.name,
    description: typeof pkg.description === 'string' ? pkg.description : '',
    license: typeof pkg.license === 'string' ? pkg.license : '',
    licenseText, themes, grammars, snippets, languages, warnings,
    analysis: analyzeManifest(pkg),
  };
}

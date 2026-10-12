// Lo que una extensión hará de verdad en Code, dicho en llano y en una línea,
// antes de instalarla y después. Nada de términos internos (los nombres de
// las contribuciones, «main/browser», «host de extensiones»): el usuario ve
// qué funciona, qué no, y si lo que no funciona llegará o no.
//
// Entrada: los «hechos» de una extensión (del package.json de Open VSX antes de
// instalar, o del registro ya instalado; panel.js los arma):
//   hasCode, browserEntry, categories, sizes {clave de contribución: cuántas},
//   webviews, ignored [{key}], themes [nombre], highlight [{name, exts}],
//   settingsOnly [nombre], snippets [{name, count|null}]
import { tx } from './i18n.js';
import { uiLang } from '../i18n.js';

export function listaO(xs) {
  const v = [...new Set(xs.filter(Boolean))];
  try { return new Intl.ListFormat(uiLang(), { type: 'disjunction' }).format(v); } catch { return v.join(', '); }
}
export function lista(xs) {
  const v = [...new Set(xs.filter(Boolean))];
  try { return new Intl.ListFormat(uiLang(), { type: 'conjunction' }).format(v); } catch { return v.join(', '); }
}
export const esTexto = x => typeof x === 'string' && !!x.trim() && !/^%[^%\s]+%$/.test(x);
const corta = (xs, n = 4) => (xs.length > n ? [...xs.slice(0, n), tx('andMore', { n: xs.length - n })] : xs);

// Categorías de Open VSX que hablan de una función que hace su código.
const POR_CATEGORIA = {
  Formatters: 'fFormat', Linters: 'fLint', Debuggers: 'fDebug', Visualization: 'fPreview', Notebooks: 'fNotebooks',
  Testing: 'fTesting', 'SCM Providers': 'fScm', 'Data Science': 'fData', 'Machine Learning': 'fAI', AI: 'fAI', Chat: 'fAI',
  Keymaps: 'fKeys', Education: null, Other: null, Themes: null, Snippets: null, 'Programming Languages': null, 'Language Packs': 'fLangPack',
  Azure: 'fCloud', 'Extension Packs': null,
};
// Contribuciones que necesitan el código de la extensión, en palabras llanas.
const POR_CLAVE = {
  commands: 'fCommands', menus: 'fCommands', submenus: 'fCommands', keybindings: 'fKeys', customEditors: 'fPreview',
  views: 'fPanels', viewsContainers: 'fPanels', viewsWelcome: 'fPanels', debuggers: 'fDebug', breakpoints: 'fDebug',
  taskDefinitions: 'fTasks', notebooks: 'fNotebooks', notebookRenderer: 'fNotebooks', configuration: 'fSettings',
  jsonValidation: 'fJsonCheck', semanticTokenTypes: 'fSemantic', semanticTokenScopes: 'fSemantic', semanticTokenModifiers: 'fSemantic',
  iconThemes: 'fIcons', productIconThemes: 'fIcons', terminal: 'fTerminal', chatParticipants: 'fAI', languageModelTools: 'fAI',
  mcpServerDefinitionProviders: 'fAI', authentication: 'fAccounts', walkthroughs: 'fWalk', statusBarItems: 'fStatus',
  codeActions: 'fCodeActions', typescriptServerPlugins: 'fLangServer', problemMatchers: 'fTasks', problemPatterns: 'fTasks',
  resourceLabelFormatters: null, configurationDefaults: null, remoteHelp: null, colors: null, icons: 'fIcons',
};
// Lo que ni con la siguiente versión funcionaría aquí: ventanas propias
// (vistas web, editores a medida), depuradores, terminales, cuadernos.
const NUNCA = new Set(['customEditors', 'notebookRenderer', 'notebooks', 'debuggers', 'terminal', 'views', 'viewsContainers']);
const DECLARATIVAS = new Set(['Themes', 'Snippets', 'Programming Languages']);

// Funciones que no funcionan, en llano y sin repetir.
export function missingFeatures(f) {
  const claves = [];
  // las categorías hablan de lo que hace su código: sin código no falta nada
  // (un paquete de snippets que se etiqueta «Machine Learning» no deja de funcionar)
  if (f.hasCode) for (const c of f.categories || []) if (POR_CATEGORIA[c]) claves.push(POR_CATEGORIA[c]);
  const principales = [...new Set(claves)];
  for (const i of f.ignored || []) {
    const k = Object.hasOwn(POR_CLAVE, i.key) ? POR_CLAVE[i.key] : 'fOther';
    if (k) claves.push(k);
  }
  return { principales: principales.map(k => tx(k)), todas: [...new Set(claves)].map(k => tx(k)) };
}

// Lo principal que no funciona: lo que dicen sus categorías o, si no dicen
// nada, sus funciones concretas; «otras funciones» sola no explica nada.
function loPrincipal(principales, faltan) {
  const concretas = faltan.filter(x => x !== tx('fOther'));
  return lista((principales.length ? principales : concretas.length ? concretas : [tx('fOwn')]).slice(0, 3));
}

// ── de un package.json analizado (vsix.js analyzeManifest) o de un registro
// instalado a los «hechos» de arriba. `h` es el host de extensiones (host.js)
// o algo con la misma forma: builtinLanguage, grammarSkippedFor, languageName,
// languageExtensions. Así el panel, las pruebas y el generador de la lista de
// populares (tests/ext_popular_build.mjs) dicen lo mismo.
const BONITOS = {
  javascript: 'JavaScript', typescript: 'TypeScript', javascriptreact: 'JavaScript React', typescriptreact: 'TypeScript React',
  html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less', json: 'JSON', jsonc: 'JSON', vue: 'Vue', python: 'Python', markdown: 'Markdown',
  shellscript: 'Shell', go: 'Go', rust: 'Rust', java: 'Java', php: 'PHP', ruby: 'Ruby', csharp: 'C#', cpp: 'C++', c: 'C', yaml: 'YAML',
};
export function languageName(h, id, langs = []) {
  return langs.find(l => l.id === id && esTexto(l.name))?.name || h?.languageName?.(id) || BONITOS[id] || id;
}
export function languageExts(h, id, langs = []) {
  const propias = langs.filter(l => l.id === id).flatMap(l => l.extensions || []);
  return [...new Set(propias.length ? propias : h?.languageExtensions?.(id) || [])];
}
function facts(h, base, { themes = [], grammarLangs = [], langs = [], snippets = [] }) {
  const salta = l => !!h?.grammarSkippedFor?.(l);
  const deSerie = id => !!h?.builtinLanguage?.(id);
  const conGram = [...new Set(grammarLangs.filter(l => l && !salta(l)))];
  // snippets de un lenguaje que Code no tiene (javascriptreact, vue…) no
  // saldrían nunca: ni se cuentan ni se prometen. Y un mismo fichero que sirve
  // a varios lenguajes se cuenta una vez.
  const existe = id => langs.some(l => l.id === id) || !!h?.languageName?.(id) || deSerie(id);
  const porLang = new Map();
  const vistos = new Set();
  for (const s of snippets.filter(x => existe(x.language))) {
    const n = !Number.isFinite(s.count) ? NaN : s.key && vistos.has(s.key) ? 0 : s.count;
    if (s.key) vistos.add(s.key);
    porLang.set(s.language, (porLang.has(s.language) ? porLang.get(s.language) : 0) + n);
  }
  return {
    ...base, themes,
    highlight: conGram.map(id => ({ id, name: languageName(h, id, langs), exts: languageExts(h, id, langs) })),
    settingsOnly: langs.filter(l => l.config && !deSerie(l.id) && !conGram.includes(l.id)).map(l => languageName(h, l.id, langs)),
    keepsBuiltin: [...new Set(grammarLangs.filter(l => l && salta(l)))].map(id => languageName(h, id, langs)),
    snippets: [...porLang].map(([id, n]) => ({ id, name: languageName(h, id, langs), count: Number.isFinite(n) ? n : null })),
  };
}
export function factsFromManifest(h, a) {
  return facts(h, { hasCode: a.hasCode, browserEntry: a.browserEntry, categories: a.categories || [], sizes: a.sizes || {}, webviews: a.webviews, ignored: a.ignored || [], pack: a.pack || [] }, {
    themes: a.themeLabels || [], grammarLangs: a.grammarLangs || [], langs: a.languageList || [],
    snippets: (a.snippetLangs || []).map(language => ({ language, count: null })),
  });
}
export function factsFromRecord(h, e) {
  // registros de antes de guardar categorías: se asume que lo que se aplica es lo principal
  const categories = e.categories || ['Programming Languages'];
  return facts(h, { hasCode: e.hasCode, browserEntry: !!e.browserEntry, categories, sizes: e.sizes || {}, webviews: e.webviews, ignored: e.ignored || [], pack: e.pack || [] }, {
    themes: (e.themes || []).map(t => t.label), grammarLangs: (e.grammars || []).map(g => g.language ?? null),
    langs: (e.languages || []).map(l => ({ id: l.id, name: l.aliases?.[0], extensions: l.extensions || [], config: !!l.configKey })),
    snippets: (e.snippets || []).map(s => ({ language: s.language, key: s.key, count: Number.isFinite(s.count) ? s.count : null })),
  });
}

// ¿Hace algo al instalarla? Lo que decide el filtro «Solo las que funcionan en
// Code» del panel: entera o en parte (lo principal funciona). Las que solo
// funcionarían por su código, o en las que lo principal es su código y solo
// quedaría un resto (unos snippets de una extensión de depurar), no.
export const works = v => v.kind === 'full' || v.kind === 'partial';

export function describe(f) {
  const partes = [];        // { tipo, texto }
  const themes = f.themes || [], highlight = f.highlight || [], settingsOnly = f.settingsOnly || [], snippets = f.snippets || [];
  // el package.json de Open VSX puede traer los nombres sin traducir (%clave%):
  // entonces se cuentan en vez de nombrarlos
  const conNombre = themes.filter(esTexto);
  if (themes.length) partes.push({ tipo: 'theme', texto: conNombre.length === themes.length ? tx('pThemes', { n: themes.length, list: lista(corta(themes.map(t => tx('quoted', { x: t })))) }) : tx('pThemesCount', { n: themes.length }) });
  if (highlight.length) partes.push({ tipo: 'highlight', texto: tx('pHighlight', { list: lista(corta(highlight.map(h => h.name))) }) });
  if (settingsOnly.length) partes.push({ tipo: 'settings', texto: tx('pSettings', { list: lista(corta(settingsOnly)) }) });
  if (snippets.length) {
    const total = snippets.every(s => Number.isFinite(s.count)) ? snippets.reduce((a, s) => a + s.count, 0) : null;
    const langs = lista(corta([...new Set(snippets.map(s => s.name))]));
    partes.push({ tipo: 'snippets', texto: total != null ? tx('pSnippetsN', { n: total, list: langs }) : tx('pSnippets', { list: langs }) });
  }
  const usable = partes.length > 0;
  const hasCode = !!f.hasCode;
  const sizes = f.sizes || {};
  const nunca = !!f.webviews || Object.keys(sizes).some(k => NUNCA.has(k));
  const { principales, todas } = missingFeatures(f);
  const faltan = hasCode && !todas.length ? [tx('fOwn')] : todas;
  // ¿lo principal es lo que hace su código? Si no se declara como tema,
  // snippets o lenguaje; si trae ventanas propias; o si casi todo son comandos
  const categorias = f.categories || [];
  const codigoManda = hasCode && (!usable || !categorias.some(c => DECLARATIVAS.has(c)) || nunca || (sizes.commands || 0) >= 10);
  const futuro = !hasCode ? null : f.browserEntry && !nunca ? 'next' : 'never';
  const queTraen = lista(partes.map(p => p.texto));
  const lineas = [];
  let kind, verdict;
  if (!usable) {
    kind = hasCode ? 'code' : 'nothing';
    if (hasCode) {
      verdict = tx('vMainBroken', { what: loPrincipal(principales, faltan) });
      lineas.push(tx(futuro === 'next' ? 'vNextVersion' : 'vNever'));
    } else verdict = tx('nothing');
  } else if (!hasCode && !faltan.length) {
    kind = 'full';
    verdict = tx('vFull', { list: queTraen });
  } else if (codigoManda) {
    kind = 'mostlyCode';
    verdict = tx('vMainBroken', { what: loPrincipal(principales, faltan) });
    lineas.push(tx('vOnly', { list: queTraen }));
    lineas.push(tx(futuro === 'next' ? 'vNextVersion' : 'vNever'));
  } else {
    kind = 'partial';
    verdict = tx('vPartial', { list: queTraen });
    lineas.push(tx(!hasCode ? 'vMissingLater' : futuro === 'next' ? 'vMissingNext' : 'vMissingNever', { list: lista(faltan) }));
  }
  const tipos = [...new Set(partes.map(p => p.tipo === 'settings' ? 'highlight' : p.tipo))];
  const soloQue = tipos.length === 1 ? { theme: 'installOnlyThemes', highlight: 'installOnlyHighlight', snippets: 'installOnlySnippets' }[tipos[0]] : 'installOnlyWorking';
  const button = kind === 'full' ? { key: 'install', style: 'primary', disabled: false }
    : kind === 'partial' ? { key: soloQue, style: 'primary', disabled: false }
      : kind === 'mostlyCode' ? { key: soloQue, style: 'ghost', disabled: false }
        : { key: kind === 'code' ? 'notHere' : 'nothingHere', style: 'ghost', disabled: true };
  return { kind, verdict, lines: lineas, button, future: futuro, usable, missing: faltan, parts: partes };
}

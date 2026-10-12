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
  for (const c of f.categories || []) if (POR_CATEGORIA[c]) claves.push(POR_CATEGORIA[c]);
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

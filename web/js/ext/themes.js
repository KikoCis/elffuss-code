// Temas de color de VS Code → Monaco.
//
// Un tema de VS Code trae dos cosas: `colors` (los del editor y del resto del
// banco de trabajo, que Monaco entiende tal cual) y `tokenColors`, reglas
// TextMate por ámbito («keyword.control», «string.quoted»…). Monaco colorea sus
// lenguajes de serie (Monarch) con clases propias («keyword», «string»,
// «comment»…), así que a cada clase se le da el color del ámbito TextMate que
// la representa, con la misma regla que usa TextMate: gana el selector más
// largo que sea prefijo del ámbito. Los ficheros con gramática TextMate de una
// extensión no pasan por esta tabla: llevan los colores exactos (grammars.js).
import { parseJsonc, parsePlist, isHexColor, hex6 } from './formats.js';

export const BASES = ['vs-dark', 'vs', 'hc-black', 'hc-light'];

// ── cargar un tema desde el paquete (como colorThemeData.ts de VS Code) ─────
const dirname = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export function joinPath(base, rel) {
  const out = [];
  for (const seg of (base ? base + '/' : '').concat(String(rel)).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!out.length) throw new Error('ruta fuera del paquete: ' + rel); out.pop(); } else out.push(seg);
  }
  return out.join('/');
}

// Ajustes globales de un .tmTheme (regla sin ámbito) → colores del editor.
const TMTHEME_COLORES = {
  background: ['editor.background'], foreground: ['editor.foreground'],
  selection: ['editor.selectionBackground'], inactiveSelection: ['editor.inactiveSelectionBackground'],
  selectionHighlightColor: ['editor.selectionHighlightBackground'],
  findMatchHighlight: ['editor.findMatchHighlightBackground'], currentFindMatchHighlight: ['editor.findMatchBackground'],
  hoverHighlight: ['editor.hoverHighlightBackground'], wordHighlight: ['editor.wordHighlightBackground'],
  wordHighlightStrong: ['editor.wordHighlightStrongBackground'], findRangeHighlight: ['editor.findRangeHighlightBackground'],
  lineHighlight: ['editor.lineHighlightBackground'], rangeHighlight: ['editor.rangeHighlightBackground'],
  caret: ['editorCursor.foreground'], invisibles: ['editorWhitespace.foreground'],
  guide: ['editorIndentGuide.background'], activeGuide: ['editorIndentGuide.activeBackground'],
};
function convertSettings(settings, out) {
  for (const regla of settings) {
    if (!regla || typeof regla !== 'object') continue;
    if (!regla.scope && regla.settings && typeof regla.settings === 'object') {
      for (const [k, v] of Object.entries(regla.settings)) {
        for (const id of TMTHEME_COLORES[k] || []) if (typeof v === 'string') out.colors[id] = v;
      }
    }
    out.tokenColors.push(regla);
  }
}

async function cargaEn(path, readText, out, prof) {
  if (prof > 8) throw new Error('demasiados include en el tema');
  if (/\.json$/i.test(path)) {
    const j = parseJsonc(await readText(path));
    if (typeof j.include === 'string') await cargaEn(joinPath(dirname(path), j.include), readText, out, prof + 1);
    if (Array.isArray(j.settings)) { convertSettings(j.settings, out); return; }
    if (j.colors && typeof j.colors === 'object') {
      for (const [k, v] of Object.entries(j.colors)) {
        if (v === 'default') delete out.colors[k];
        else if (typeof v === 'string') out.colors[k] = v;
      }
    }
    if (Array.isArray(j.tokenColors)) out.tokenColors.push(...j.tokenColors);
    else if (typeof j.tokenColors === 'string') {
      const t = parsePlist(await readText(joinPath(dirname(path), j.tokenColors)));
      if (Array.isArray(t?.settings)) convertSettings(t.settings, out);
    }
    if (typeof j.type === 'string') out.type = j.type;
  } else {
    const t = parsePlist(await readText(path));
    if (!Array.isArray(t?.settings)) throw new Error('el .tmTheme no tiene settings');
    convertSettings(t.settings, out);
  }
}

// Reglas TextMate normalizadas: { scope: [selectores], settings: { foreground,
// background, fontStyle } } con colores ya validados.
function normalizaReglas(reglas) {
  const out = [];
  for (const r of reglas) {
    if (!r || typeof r !== 'object' || !r.settings || typeof r.settings !== 'object') continue;
    const st = {};
    if (isHexColor(r.settings.foreground)) st.foreground = r.settings.foreground;
    if (isHexColor(r.settings.background)) st.background = r.settings.background;
    if (typeof r.settings.fontStyle === 'string') {
      st.fontStyle = r.settings.fontStyle.split(/\s+/).filter(w => ['italic', 'bold', 'underline', 'strikethrough'].includes(w)).join(' ');
    }
    if (!Object.keys(st).length) continue;
    const scope = Array.isArray(r.scope) ? r.scope.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean)
      : typeof r.scope === 'string' ? r.scope.split(',').map(x => x.trim()).filter(Boolean) : [];
    out.push(scope.length ? { scope, settings: st } : { settings: st });
  }
  return out;
}

// Tema listo para guardar: { label, uiTheme, colors, tokenColors }.
export async function loadTheme(path, readText, { label = '', uiTheme = '' } = {}) {
  const out = { colors: {}, tokenColors: [], type: '' };
  await cargaEn(path, readText, out, 0);
  const colors = {};
  for (const [k, v] of Object.entries(out.colors)) if (isHexColor(v)) colors[k] = v;
  const porTipo = { dark: 'vs-dark', light: 'vs', hc: 'hc-black', hcLight: 'hc-light', 'hc-light': 'hc-light' };
  const base = BASES.includes(uiTheme) ? uiTheme : porTipo[out.type] || 'vs-dark';
  return { label: String(label || ''), uiTheme: base, colors, tokenColors: normalizaReglas(out.tokenColors) };
}

// ── resolución TextMate: qué estilo toca a un ámbito ─────────────────────────
// Solo selectores simples («keyword.control»); los de contexto («source.js
// keyword») o con exclusiones no sirven para las clases sueltas de Monarch.
function selectoresSimples(regla) {
  return (regla.scope || []).filter(s => !/[\s()|&,]|^-/.test(s));
}
export function resolveScope(tokenColors, scope) {
  const cands = [];
  tokenColors.forEach((r, idx) => {
    for (const sel of selectoresSimples(r)) {
      if (scope === sel || scope.startsWith(sel + '.')) cands.push({ spec: sel.split('.').length, idx, st: r.settings });
    }
  });
  cands.sort((a, b) => b.spec - a.spec || b.idx - a.idx);
  const out = {};
  for (const c of cands) {
    if (out.foreground === undefined && c.st.foreground) out.foreground = c.st.foreground;
    if (out.fontStyle === undefined && typeof c.st.fontStyle === 'string') out.fontStyle = c.st.fontStyle;
  }
  return out;
}

// Clase de Monaco (Monarch) → ámbitos TextMate que la representan, por orden.
// Incluye las clases con regla propia en los temas de serie de Monaco
// (string.key.json, delimiter.html…): si no se cubrieran, ganaría el color
// del tema de serie y el tema de la extensión quedaría a medias.
const MONARCH = [
  ['comment', ['comment']],
  ['comment.doc', ['comment.block.documentation', 'comment']],
  ['string', ['string']],
  ['string.escape', ['constant.character.escape', 'string']],
  ['string.key.json', ['support.type.property-name.json', 'support.type.property-name', 'variable.other.property']],
  ['string.value.json', ['string.quoted.double.json', 'string']],
  ['string.html', ['string.quoted.double.html', 'string']],
  ['string.sql', ['string.quoted.single.sql', 'string']],
  ['string.yaml', ['string.unquoted.plain.out.yaml', 'string']],
  ['string.link', ['markup.underline.link', 'string']],
  ['regexp', ['string.regexp']],
  ['number', ['constant.numeric']],
  ['number.hex', ['constant.numeric.hex', 'constant.numeric']],
  ['constant', ['constant.language', 'constant']],
  ['keyword', ['keyword', 'storage.type', 'storage']],
  ['keyword.flow', ['keyword.control']],
  ['keyword.flow.scss', ['keyword.control.at-rule', 'keyword.control', 'keyword']],
  ['keyword.json', ['constant.language.json', 'constant.language']],
  ['operator', ['keyword.operator']],
  ['operator.scss', ['keyword.operator']],
  ['operator.sql', ['keyword.operator']],
  ['operator.swift', ['keyword.operator']],
  ['delimiter', ['punctuation', 'meta.brace']],
  ['delimiter.html', ['punctuation.definition.tag']],
  ['delimiter.xml', ['punctuation.definition.tag']],
  ['type', ['entity.name.type', 'support.type', 'storage.type']],
  ['type.identifier', ['entity.name.type', 'entity.name.class', 'support.class']],
  ['identifier', ['variable', 'variable.other.readwrite']],
  ['variable', ['variable']],
  ['variable.predefined', ['variable.language', 'support.variable']],
  ['variable.parameter', ['variable.parameter']],
  ['predefined', ['support.function', 'entity.name.function']],
  ['predefined.sql', ['support.function', 'entity.name.function']],
  ['annotation', ['meta.decorator', 'storage.type.annotation', 'entity.name.function.decorator']],
  ['tag', ['entity.name.tag']],
  ['tag.id.pug', ['entity.other.attribute-name.id', 'entity.name.tag']],
  ['tag.class.pug', ['entity.other.attribute-name.class', 'entity.name.tag']],
  ['meta.tag', ['entity.name.tag']],
  ['meta.scss', ['keyword.control.at-rule', 'keyword']],
  ['metatag', ['meta.tag.sgml', 'punctuation.definition.tag', 'entity.name.tag']],
  ['metatag.html', ['meta.tag.sgml.doctype', 'punctuation.definition.tag', 'entity.name.tag']],
  ['metatag.xml', ['meta.tag.preprocessor.xml', 'punctuation.definition.tag', 'entity.name.tag']],
  ['metatag.content.html', ['string']],
  ['key', ['support.type.property-name', 'entity.name.tag.yaml', 'variable.other.property']],
  ['attribute.name', ['entity.other.attribute-name', 'support.type.property-name']],
  ['attribute.value', ['string', 'support.constant.property-value']],
  ['attribute.value.number', ['constant.numeric']],
  ['attribute.value.number.css', ['constant.numeric']],
  ['attribute.value.unit', ['keyword.other.unit', 'constant.numeric']],
  ['attribute.value.unit.css', ['keyword.other.unit', 'constant.numeric']],
  ['attribute.value.hex.css', ['constant.other.color', 'constant.numeric']],
  ['attribute.value.html', ['string']],
  ['attribute.value.xml', ['string']],
  ['invalid', ['invalid']],
  ['emphasis', ['markup.italic'], 'estilo'],
  ['strong', ['markup.bold'], 'estilo'],
  ['metatag.php', ['punctuation.section.embedded'], 'estilo'],
];

const DEF = {
  'vs-dark': { fg: '#D4D4D4', bg: '#1E1E1E' }, vs: { fg: '#000000', bg: '#FFFFFE' },
  'hc-black': { fg: '#FFFFFF', bg: '#000000' }, 'hc-light': { fg: '#292929', bg: '#FFFFFF' },
};
function defaults(theme) {
  const d = DEF[theme.uiTheme] || DEF['vs-dark'];
  const global = (theme.tokenColors || []).find(r => !r.scope)?.settings || {};
  const bg = hex6(theme.colors?.['editor.background']) || hex6(global.background) || d.bg;
  const fg = hex6(theme.colors?.['editor.foreground'], bg) || hex6(global.foreground, bg) || d.fg;
  return { fg, bg };
}

export function monarchRules(theme) {
  const { fg: defFg, bg } = defaults(theme);
  const reglas = [];
  for (const [token, scopes, modo] of MONARCH) {
    let fg = null, fs;
    for (const sc of scopes) {
      const m = resolveScope(theme.tokenColors || [], sc);
      if (modo === 'estilo') { if (m.fontStyle !== undefined) { fs = m.fontStyle; break; } continue; }
      if (m.foreground) { fg = hex6(m.foreground, bg); fs = m.fontStyle; break; }
    }
    if (modo === 'estilo') { if (fs !== undefined) reglas.push({ token, fontStyle: fs }); continue; }
    // sin regla en el tema: el color por defecto, que es lo que haría VS Code
    // con un ámbito sin pintar (no el del tema de serie de Monaco)
    const r = { token, foreground: (fg || defFg).slice(1) };
    if (fs !== undefined) r.fontStyle = fs;
    reglas.push(r);
  }
  return reglas;
}

// Datos para monaco.editor.defineTheme. `encodedTokensColors` (el mapa de
// colores de TextMate) solo cuando hay gramáticas TextMate activas.
export function toMonacoTheme(theme, encodedTokensColors = null) {
  const colors = {};
  for (const [k, v] of Object.entries(theme.colors || {})) if (isHexColor(v)) colors[k] = v;
  const data = { base: BASES.includes(theme.uiTheme) ? theme.uiTheme : 'vs-dark', inherit: true, rules: monarchRules(theme), colors };
  if (encodedTokensColors) data.encodedTokensColors = encodedTokensColors;
  return data;
}

// Tema en formato vscode-textmate (IRawTheme). Los colores van a '#RRGGBB'
// (el alfa mezclado sobre el fondo): Monaco no admite otra forma en su mapa de
// colores y los dos mapas tienen que deduplicar igual para que los índices
// coincidan.
export function toTextMateTheme(theme) {
  const { fg, bg } = defaults(theme);
  const settings = [{ settings: { foreground: fg, background: bg } }];
  for (const r of theme.tokenColors || []) {
    if (!r.scope || !r.scope.length) continue;
    const st = {};
    const f = hex6(r.settings.foreground, bg); if (f) st.foreground = f;
    const b = hex6(r.settings.background, bg); if (b) st.background = b;
    if (typeof r.settings.fontStyle === 'string') st.fontStyle = r.settings.fontStyle;
    if (Object.keys(st).length) settings.push({ scope: r.scope, settings: st });
  }
  return { name: theme.label || 'tema', settings };
}

// Colores TextMate para los temas de serie de Monaco: un fichero con gramática
// de una extensión se ve como en VS Code con Dark+/Light+/Alto contraste.
// Colores de los temas por defecto de VS Code (licencia MIT).
const R = (scope, foreground, fontStyle) => ({ scope: scope.split(',').map(s => s.trim()), settings: { ...(foreground && { foreground }), ...(fontStyle !== undefined && { fontStyle }) } });
const TM_SERIE = {
  'vs-dark': ['#D4D4D4', '#1E1E1E', [
    R('comment', '#6A9955'), R('string', '#CE9178'), R('string.regexp', '#D16969'), R('constant.numeric, keyword.other.unit, markup.inserted', '#B5CEA8'),
    R('constant.language, constant.character, keyword, storage, variable.language, entity.name.tag, meta.preprocessor', '#569CD6'),
    R('constant.character.escape', '#D7BA7D'), R('keyword.control, entity.name.operator', '#C586C0'), R('keyword.operator', '#D4D4D4'),
    R('entity.name.function, support.function', '#DCDCAA'),
    R('entity.name.type, entity.name.class, entity.name.namespace, support.type, support.class', '#4EC9B0'),
    R('variable, variable.parameter, support.variable, entity.other.attribute-name, support.type.property-name, constant.other.placeholder', '#9CDCFE'),
    R('variable.other.constant', '#4FC1FF'), R('punctuation.definition.tag', '#808080'), R('invalid', '#F44747'),
    R('entity.name.label', '#C8C8C8'), R('markup.deleted, markup.inline.raw', '#CE9178'),
    R('markup.heading', '#569CD6', 'bold'), R('markup.bold', null, 'bold'), R('markup.italic', null, 'italic'), R('markup.underline.link', null, 'underline'),
  ]],
  vs: ['#000000', '#FFFFFE', [
    R('comment', '#008000'), R('string', '#A31515'), R('string.regexp', '#811F3F'), R('constant.numeric, keyword.other.unit, markup.inserted', '#098658'),
    R('constant.language, constant.character, keyword, storage, variable.language, meta.preprocessor', '#0000FF'),
    R('constant.character.escape', '#EE0000'), R('keyword.control, entity.name.operator', '#AF00DB'), R('keyword.operator', '#000000'),
    R('entity.name.function, support.function', '#795E26'),
    R('entity.name.type, entity.name.class, entity.name.namespace, support.type, support.class', '#267F99'),
    R('variable, variable.parameter, support.variable, constant.other.placeholder', '#001080'),
    R('entity.other.attribute-name, support.type.property-name', '#E50000'), R('variable.other.constant', '#0070C1'),
    R('entity.name.tag, punctuation.definition.tag, markup.inline.raw', '#800000'), R('invalid', '#CD3131'), R('markup.deleted', '#A31515'),
    R('markup.heading', '#800000', 'bold'), R('markup.bold', '#000080', 'bold'), R('markup.italic', null, 'italic'), R('markup.underline.link', null, 'underline'),
  ]],
  'hc-black': ['#FFFFFF', '#000000', [
    R('comment', '#7CA668'), R('string', '#CE9178'), R('string.regexp', '#D16969'), R('constant.numeric, keyword.other.unit, markup.inserted', '#B5CEA8'),
    R('constant.language, constant.character, keyword, storage, entity.name.tag, meta.preprocessor', '#569CD6'),
    R('keyword.control', '#C586C0'), R('keyword.operator', '#D4D4D4'), R('entity.name.function, support.function', '#DCDCAA'),
    R('entity.name.type, entity.name.class, entity.name.namespace, support.type, support.class', '#4EC9B0'),
    R('variable, variable.language, variable.parameter, support.variable, entity.other.attribute-name', '#9CDCFE'),
    R('punctuation.definition.tag', '#808080'), R('invalid', '#F44747'), R('markup.deleted', '#CE9178'),
    R('markup.heading', '#6796E6', 'bold'), R('markup.bold', null, 'bold'), R('markup.italic', null, 'italic'), R('markup.underline.link', null, 'underline'),
  ]],
  'hc-light': ['#292929', '#FFFFFF', [
    R('comment', '#515151'), R('string, constant.language, constant.character, keyword, storage, variable.language, entity.name.tag, meta.preprocessor, markup.inline.raw', '#0F4A85'),
    R('string.regexp', '#811F3F'), R('constant.numeric, keyword.other.unit, markup.inserted', '#096D48'),
    R('constant.character.escape', '#EE0000'), R('keyword.control, entity.name.operator, invalid', '#B5200D'), R('keyword.operator', '#000000'),
    R('entity.name.function, support.function', '#5E2CBC'),
    R('entity.name.type, entity.name.class, entity.name.namespace, support.type, support.class', '#185E73'),
    R('variable, variable.parameter, support.variable, constant.other.placeholder', '#001080'),
    R('entity.other.attribute-name, support.type.property-name', '#264F78'), R('variable.other.constant', '#02715D'),
    R('punctuation.definition.tag', '#0F4A85'), R('markup.deleted', '#5A5A5A'),
    R('markup.heading', '#0F4A85', 'bold'), R('markup.bold', '#000080', 'bold'), R('markup.italic', null, 'italic'), R('markup.underline.link', null, 'underline'),
  ]],
};
export function builtinTheme(id) {
  const [fg, bg, tokenColors] = TM_SERIE[id] || TM_SERIE['vs-dark'];
  return { label: id, uiTheme: TM_SERIE[id] ? id : 'vs-dark', colors: { 'editor.foreground': fg, 'editor.background': bg }, tokenColors, builtin: true };
}

// Ids de tema que Monaco acepta (/^[a-z0-9-]+$/i, o lanza «Illegal theme name!»).
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export function themeIdFor(extId, contrib, index, usados = new Set()) {
  const base = ('x-' + slug(extId) + '-' + (slug(contrib.id || contrib.label) || 't' + index)).slice(0, 90).replace(/-+$/, '');
  let id = base;
  for (let n = 2; usados.has(id); n++) id = base + '-' + n;
  usados.add(id);
  return id;
}

// Las pestañas y el estado vacío del editor siguen al tema; el resto del IDE
// conserva su aspecto. Solo entran colores hex validados.
export function chromeCss(theme) {
  const c = k => (isHexColor(theme.colors?.[k]) ? theme.colors[k] : null);
  const { fg, bg } = defaults(theme);
  const tabs = c('editorGroupHeader.tabsBackground') || c('tab.inactiveBackground') || bg;
  const activa = c('tab.activeBackground') || bg;
  const texto = c('tab.inactiveForeground') || fg;
  const textoActiva = c('tab.activeForeground') || fg;
  const borde = c('tab.border') || c('editorGroupHeader.tabsBorder') || c('editorGroup.border') || c('contrastBorder');
  const acento = c('tab.activeBorderTop') || c('tab.activeBorder') || c('focusBorder');
  return [
    `#tabs-bar { background: ${tabs};${borde ? ` border-bottom-color: ${borde};` : ''} }`,
    `#tabs-bar .tab { color: ${texto};${borde ? ` border-right-color: ${borde};` : ''} }`,
    `#tabs-bar .tab.active { background: ${activa}; color: ${textoActiva};${acento ? ` box-shadow: inset 0 2px 0 ${acento};` : ''} }`,
    `#editor-empty { background: ${bg}; color: ${texto}; }`,
  ].join('\n');
}

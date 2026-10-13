// Decoraciones de las extensiones (setDecorations) pintadas en el editor de
// Code. Las opciones de cada tipo NUNCA pasan tal cual: se reconstruyen con
// una lista blanca de valores (colores, longitudes, listas cerradas) y se
// convierten en reglas CSS nuestras, `.monaco-editor .x2d-N`, dentro de
// <style id="x2-deco">. Fuera: fontFamily, cualquier url(), CSS libre, y el
// atajo `border` que no se deje partir en sus tres piezas. El texto antes y
// después (contentText) va como texto inyectado de Monaco, no como CSS, y los
// mensajes al pasar el ratón como markdown canónico (sanitize.js). Los
// iconos de margen no se pintan en esta versión.
//
// Las decoraciones son del documento activo: al cambiar de pestaña se
// borran, y la extensión las vuelve a poner (como en VS Code, al cambiar el
// editor activo).
import { canonicalMarkdown, markdownFromText } from './sanitize.js';

const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse '
  + 'chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen '
  + 'darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray '
  + 'dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred '
  + 'indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey '
  + 'lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon '
  + 'mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue '
  + 'mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred '
  + 'papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna '
  + 'silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow '
  + 'yellowgreen transparent currentcolor').split(' '));
const LENGTH = /^-?\d{1,4}(\.\d{1,3})?(px|em|ch|%)?$/;
const LISTS = {
  borderStyle: new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']),
  fontStyle: new Set(['normal', 'italic', 'oblique']),
  fontWeight: new Set(['normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900']),
  cursor: new Set(['default', 'pointer', 'text', 'crosshair', 'help', 'move', 'not-allowed', 'wait', 'progress', 'zoom-in', 'zoom-out', 'grab', 'grabbing',
    'col-resize', 'row-resize', 'ew-resize', 'ns-resize', 'context-menu', 'cell', 'copy', 'alias', 'none']),
};
const DECO_LINE = new Set(['none', 'underline', 'overline', 'line-through']);
const DECO_STYLE = new Set(['solid', 'double', 'dotted', 'dashed', 'wavy']);
const BORDER_WIDTH = new Set(['thin', 'medium', 'thick']);
// rgb()/hsl() solo con números: con comas o con espacios (y «/ alfa»)
const N = '-?\\d{1,3}(?:\\.\\d{1,3})?(?:%|deg)?';
const FN_COMMAS = new RegExp(`^(?:rgb|hsl)a?\\(\\s*${N}\\s*,\\s*${N}\\s*,\\s*${N}\\s*(?:,\\s*${N}\\s*)?\\)$`);
const FN_SPACES = new RegExp(`^(?:rgb|hsl)a?\\(\\s*${N}\\s+${N}\\s+${N}\\s*(?:\\/\\s*${N}\\s*)?\\)$`);

export function color(v) {
  if (v && typeof v === 'object' && typeof v.themeColor === 'string') return /^[A-Za-z0-9.]{1,100}$/.test(v.themeColor) ? `var(--vscode-${v.themeColor.replace(/\./g, '-')})` : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(s)) return s;
  if (NAMED.has(s)) return s;
  if (FN_COMMAS.test(s) || FN_SPACES.test(s)) return s;
  return null;
}
export const length = v => (typeof v === 'number' && Number.isFinite(v) ? (LENGTH.test(String(v)) ? v + 'px' : null) : typeof v === 'string' && LENGTH.test(v.trim()) ? v.trim() : null);
const lengths = (v, max = 4) => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const parts = String(v).trim().split(/\s+/);
  if (!parts.length || parts.length > max) return null;
  const ok = parts.map(p => length(p));
  return ok.every(Boolean) ? ok.join(' ') : null;
};
const listed = (k, v) => (typeof v === 'string' && LISTS[k].has(v.trim().toLowerCase()) ? v.trim().toLowerCase() : typeof v === 'number' && k === 'fontWeight' && LISTS.fontWeight.has(String(v)) ? String(v) : null);
const opacity = v => { const s = String(v ?? '').trim(); return /^(0(\.\d{1,3})?|1(\.0{1,3})?|\.\d{1,3})$/.test(s) ? s : null; };
export function textDecoration(v) {
  if (typeof v !== 'string') return null;
  const toks = v.trim().toLowerCase().split(/\s+/);
  if (!toks.length || toks.length > 4) return null;
  const out = [];
  for (const t of toks) {
    if (DECO_LINE.has(t) || DECO_STYLE.has(t)) out.push(t);
    else if (color(t)) out.push(color(t));
    else if (length(t)) out.push(length(t));
    else return null;
  }
  return out.join(' ');
}
// `border` / `outline`: solo si se parte en anchura, estilo y color válidos
export function borderShorthand(v) {
  if (typeof v !== 'string') return null;
  const toks = v.trim().toLowerCase().split(/\s+/);
  if (!toks.length || toks.length > 3) return null;
  const out = [];
  for (const t of toks) {
    if (LISTS.borderStyle.has(t) || BORDER_WIDTH.has(t)) out.push(t);
    else if (length(t)) out.push(length(t));
    else if (color(t)) out.push(color(t));
    else return null;
  }
  return out.join(' ');
}

// opciones de un tipo (o de una variante clara/oscura) → declaraciones CSS
const CSS = {
  block: [
    ['backgroundColor', 'background-color', color], ['outline', 'outline', borderShorthand], ['outlineColor', 'outline-color', color],
    ['outlineStyle', 'outline-style', v => listed('borderStyle', v)], ['outlineWidth', 'outline-width', length], ['border', 'border', borderShorthand],
    ['borderColor', 'border-color', color], ['borderRadius', 'border-radius', v => lengths(v)], ['borderSpacing', 'border-spacing', v => lengths(v, 2)],
    ['borderStyle', 'border-style', v => listed('borderStyle', v)], ['borderWidth', 'border-width', v => lengths(v)],
  ],
  inline: [
    ['color', 'color', color], ['fontStyle', 'font-style', v => listed('fontStyle', v)], ['fontWeight', 'font-weight', v => listed('fontWeight', v)],
    ['textDecoration', 'text-decoration', textDecoration], ['cursor', 'cursor', v => listed('cursor', v)], ['opacity', 'opacity', opacity],
    ['letterSpacing', 'letter-spacing', length],
  ],
  content: [
    ['color', 'color', color], ['backgroundColor', 'background-color', color], ['border', 'border', borderShorthand], ['borderColor', 'border-color', color],
    ['fontStyle', 'font-style', v => listed('fontStyle', v)], ['fontWeight', 'font-weight', v => listed('fontWeight', v)],
    ['textDecoration', 'text-decoration', textDecoration], ['margin', 'margin', v => lengths(v)], ['width', 'width', length], ['height', 'height', length],
    ['opacity', 'opacity', opacity],
  ],
};
export function declarations(o, group) {
  if (!o || typeof o !== 'object') return '';
  const out = [];
  for (const [k, prop, fn] of CSS[group]) {
    if (o[k] === undefined || o[k] === null) continue;
    const v = fn(o[k]);
    if (v) out.push(`${prop}: ${v};`);
  }
  return out.join(' ');
}
const contentText = c => (c && typeof c.contentText === 'string' ? c.contentText.replace(/[\r\n]+/g, ' ').slice(0, 200) : null);
const LANES = new Set([1, 2, 4, 7]);
const STICK = new Set([0, 1, 2, 3]);

export class Decorations {
  constructor({ monaco, editor, docs }) {
    this.monaco = monaco;
    this.editor = editor;
    this.docs = docs;
    this.types = new Map();                       // key → { cls, ...options normalizadas }
    this.collections = new Map();                 // key → colección del documento activo
    this.css = new Map();                         // texto CSS → nombre de clase (para no repetir reglas)
    this.n = 0;
    this.style = null;
    this.rules = [];
    this.sub = editor.onDidChangeModel(() => this.clear());
  }

  sheet() {
    if (!this.style || !this.style.isConnected) {
      this.style = document.createElement('style');
      this.style.id = 'x2-deco';
      document.head.appendChild(this.style);
    }
    return this.style;
  }
  // una clase para estas declaraciones (con sus variantes clara y oscura)
  classFor(base, light, dark) {
    if (!base && !light && !dark) return null;
    const sig = base + '|' + light + '|' + dark;
    if (this.css.has(sig)) return this.css.get(sig);
    const cls = 'x2d-' + (++this.n);
    if (base) this.rules.push(`.monaco-editor .${cls} { ${base} }`);
    if (light) this.rules.push(`.monaco-editor.vs .${cls}, .monaco-editor.hc-light .${cls} { ${light} }`);
    if (dark) this.rules.push(`.monaco-editor.vs-dark .${cls}, .monaco-editor.hc-black .${cls} { ${dark} }`);
    this.sheet().textContent = this.rules.join('\n');
    this.css.set(sig, cls);
    return cls;
  }
  contentClass(c, light, dark) {
    return this.classFor(declarations(c, 'content'), declarations(light, 'content'), declarations(dark, 'content'));
  }

  type(key, o) {
    if (typeof key !== 'string' || !o || typeof o !== 'object') return;
    const light = o.light && typeof o.light === 'object' ? o.light : null;
    const dark = o.dark && typeof o.dark === 'object' ? o.dark : null;
    const t = {
      className: this.classFor(declarations(o, 'block'), declarations(light, 'block'), declarations(dark, 'block')),
      inlineClassName: this.classFor(declarations(o, 'inline'), declarations(light, 'inline'), declarations(dark, 'inline')),
      isWholeLine: o.isWholeLine === true,
      stickiness: STICK.has(o.rangeBehavior) ? o.rangeBehavior : undefined,
      ruler: null,
      before: null, after: null,
    };
    const rulerColor = o.overviewRulerColor && typeof o.overviewRulerColor === 'object' && typeof o.overviewRulerColor.themeColor === 'string'
      ? (/^[A-Za-z0-9.]{1,100}$/.test(o.overviewRulerColor.themeColor) ? { id: o.overviewRulerColor.themeColor } : null)
      : color(o.overviewRulerColor);
    if (rulerColor) t.ruler = { color: rulerColor, position: LANES.has(o.overviewRulerLane) ? o.overviewRulerLane : 4 };
    for (const side of ['before', 'after']) {
      const c = o[side] && typeof o[side] === 'object' ? o[side] : null;
      if (!c) continue;
      t[side] = { text: contentText(c), cls: this.contentClass(c, light?.[side], dark?.[side]) };
    }
    this.types.set(key, t);
  }

  // rangos de una decoración en el documento `uri` (solo si es el activo)
  set(key, uri, ranges) {
    const t = this.types.get(key);
    const model = this.docs.modelForUri(uri);
    if (!t || !model || this.editor.getModel() !== model) return;
    const out = [];
    for (const r of ranges.slice(0, 10000)) {
      if (!r || !Array.isArray(r.range)) continue;
      const v = model.validateRange(new this.monaco.Range(r.range[0], r.range[1], r.range[2], r.range[3]));
      const ro = r.ro && typeof r.ro === 'object' ? r.ro : null;
      const opts = { description: 'x2-extension-decoration' };
      if (t.className) opts.className = t.className;
      if (t.inlineClassName) opts.inlineClassName = t.inlineClassName;
      if (t.isWholeLine) opts.isWholeLine = true;
      if (t.stickiness !== undefined) opts.stickiness = t.stickiness;
      if (t.ruler) opts.overviewRuler = t.ruler;
      for (const side of ['before', 'after']) {
        // el texto por rango (renderOptions) manda sobre el del tipo
        const per = ro && ro[side] && typeof ro[side] === 'object' ? ro[side] : null;
        const text = contentText(per) ?? t[side]?.text;
        if (!text) continue;
        const cls = per ? this.contentClass(per, ro.light?.[side], ro.dark?.[side]) || t[side]?.cls : t[side]?.cls;
        opts[side] = { content: text, ...(cls ? { inlineClassName: cls } : {}) };
      }
      const hover = Array.isArray(r.hover) ? r.hover : r.hover ? [r.hover] : [];
      const msgs = hover.slice(0, 10).map(h => (h && typeof h.md === 'string' ? canonicalMarkdown(h.md) : h && typeof h.text === 'string' ? markdownFromText(h.text) : null)).filter(Boolean);
      if (msgs.length) opts.hoverMessage = msgs;
      out.push({ range: v, options: opts });
    }
    let c = this.collections.get(key);
    if (!c) { c = this.editor.createDecorationsCollection(); this.collections.set(key, c); }
    c.set(out);
  }

  remove(key) {
    this.collections.get(key)?.clear();
    this.collections.delete(key);
    this.types.delete(key);
  }

  clear() { for (const c of this.collections.values()) c.clear(); }

  dispose() {
    this.sub?.dispose();
    this.clear();
    this.collections.clear();
    this.types.clear();
    this.style?.remove();
    this.rules = [];
    this.css.clear();
  }
}

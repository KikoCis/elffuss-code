// Lenguajes de VS Code (contributes.languages + language-configuration.json)
// → registro de Monaco y su configuración (comentarios, corchetes, sangría…).

// Expresión de VS Code (cadena o { pattern, flags }) → RegExp. Las que no
// compilan en JavaScript se descartan, como hace VS Code.
function re(v) {
  try {
    if (typeof v === 'string') return new RegExp(v);
    if (v && typeof v.pattern === 'string') return new RegExp(v.pattern, String(v.flags || '').replace(/[^dgimsuy]/g, ''));
  } catch { /* inválida */ }
  return undefined;
}
const par = p => (Array.isArray(p) && p.length === 2 && p.every(x => typeof x === 'string') ? { open: p[0], close: p[1] }
  : p && typeof p.open === 'string' && typeof p.close === 'string' ? { open: p.open, close: p.close, ...(Array.isArray(p.notIn) && { notIn: p.notIn.filter(x => typeof x === 'string') }) }
    : null);
const corchetes = l => (Array.isArray(l) ? l.filter(p => Array.isArray(p) && p.length === 2 && p.every(x => typeof x === 'string')) : undefined);

// language-configuration.json → LanguageConfiguration de Monaco.
export function toLanguageConfiguration(j, monaco) {
  if (!j || typeof j !== 'object') return {};
  const out = {};
  if (j.comments && typeof j.comments === 'object') {
    const c = {};
    if (typeof j.comments.lineComment === 'string') c.lineComment = j.comments.lineComment;
    if (corchetes([j.comments.blockComment])?.length) c.blockComment = j.comments.blockComment;
    out.comments = c;
  }
  if (corchetes(j.brackets)) out.brackets = corchetes(j.brackets);
  if (corchetes(j.colorizedBracketPairs)) out.colorizedBracketPairs = corchetes(j.colorizedBracketPairs);
  if (Array.isArray(j.autoClosingPairs)) out.autoClosingPairs = j.autoClosingPairs.map(par).filter(Boolean);
  if (Array.isArray(j.surroundingPairs)) out.surroundingPairs = j.surroundingPairs.map(par).filter(Boolean).map(({ open, close }) => ({ open, close }));
  if (typeof j.autoCloseBefore === 'string') out.autoCloseBefore = j.autoCloseBefore;
  const wp = re(j.wordPattern);
  if (wp) out.wordPattern = wp;
  if (j.indentationRules && typeof j.indentationRules === 'object') {
    const ir = j.indentationRules;
    const inc = re(ir.increaseIndentPattern), dec = re(ir.decreaseIndentPattern);
    if (inc && dec) {
      out.indentationRules = { increaseIndentPattern: inc, decreaseIndentPattern: dec };
      const nl = re(ir.indentNextLinePattern), un = re(ir.unIndentedLinePattern);
      if (nl) out.indentationRules.indentNextLinePattern = nl;
      if (un) out.indentationRules.unIndentedLinePattern = un;
    }
  }
  if (j.folding && typeof j.folding === 'object') {
    const f = {};
    if (typeof j.folding.offSide === 'boolean') f.offSide = j.folding.offSide;
    const s = re(j.folding.markers?.start), e = re(j.folding.markers?.end);
    if (s && e) f.markers = { start: s, end: e };
    out.folding = f;
  }
  if (Array.isArray(j.onEnterRules) && monaco) {
    const IA = monaco.languages.IndentAction;
    const acciones = { none: IA.None, indent: IA.Indent, indentOutdent: IA.IndentOutdent, outdent: IA.Outdent };
    out.onEnterRules = j.onEnterRules.map(r => {
      const beforeText = re(r?.beforeText);
      const indentAction = acciones[r?.action?.indent];
      if (!beforeText || indentAction === undefined) return null;
      const regla = { beforeText, action: { indentAction } };
      const at = re(r.afterText), pl = re(r.previousLineText);
      if (at) regla.afterText = at;
      if (pl) regla.previousLineText = pl;
      if (typeof r.action.appendText === 'string') regla.action.appendText = r.action.appendText;
      if (Number.isInteger(r.action.removeText)) regla.action.removeText = r.action.removeText;
      return regla;
    }).filter(Boolean);
  }
  return out;
}

// Glob de VS Code (filenamePatterns) → RegExp: **, *, ?, {a,b}.
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
    else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '{') { const e = glob.indexOf('}', i); if (e < 0) { out += '\\{'; continue; } out += '(?:' + glob.slice(i + 1, e).split(',').map(x => x.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|') + ')'; i = e; }
    else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$', 'i');
}

// Lenguaje para una ruta según las contribuciones activas (las últimas
// instaladas mandan). Como VS Code: nombre exacto, luego patrones, luego la
// extensión más larga y, si se da el texto, la primera línea.
export function matchLanguage(contribs, path, primeraLinea = null) {
  const base = String(path).split('/').pop();
  const low = base.toLowerCase();
  for (let i = contribs.length - 1; i >= 0; i--) if ((contribs[i].filenames || []).some(f => f === base)) return contribs[i].id;
  for (let i = contribs.length - 1; i >= 0; i--) {
    for (const g of contribs[i].filenamePatterns || []) {
      try { if (globToRegExp(g).test(g.includes('/') ? path : base)) return contribs[i].id; } catch { /* patrón roto */ }
    }
  }
  let mejor = null, largo = 0;
  for (let i = contribs.length - 1; i >= 0; i--) {
    for (const e of contribs[i].extensions || []) {
      const el = String(e).toLowerCase();
      if (el && el.length > largo && low.endsWith(el)) { mejor = contribs[i].id; largo = el.length; }
    }
  }
  if (mejor) return mejor;
  if (primeraLinea != null) {
    for (let i = contribs.length - 1; i >= 0; i--) {
      const fl = contribs[i].firstLine;
      if (typeof fl !== 'string') continue;
      try { if (new RegExp(fl).test(primeraLinea)) return contribs[i].id; } catch { /* inválida */ }
    }
  }
  return null;
}

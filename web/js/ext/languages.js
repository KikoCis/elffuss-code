// Lenguajes de VS Code (contributes.languages + language-configuration.json)
// → registro de Monaco y su configuración (comentarios, corchetes, sangría…).

// ¿Repite algo que ya se repite? (a+)+, (a*)*, (x|y+){2,}… es la forma clásica
// del retroceso catastrófico: con la línea adecuada, la expresión no termina y
// congela la pestaña. Estas expresiones las ejecuta Monaco en el hilo de la
// página, así que una así se descarta entera. No caza todo (las alternativas
// que se solapan, como (a|a)*, o muchos .* seguidos), pero sí lo más común.
export function nestedRepetition(src) {
  const pila = [{ rep: false }];           // por grupo abierto: ¿dentro hay algo que se repite?
  let ultimo = null;                       // lo que cuantificaría un cuantificador: { rep }
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; ultimo = { rep: false }; continue; }
    if (c === '[') {
      let j = i + 1;
      if (src[j] === '^') j++;
      if (src[j] === ']') j++;
      for (; j < src.length && src[j] !== ']'; j++) if (src[j] === '\\') j++;
      i = j; ultimo = { rep: false }; continue;
    }
    if (c === '(') {
      pila.push({ rep: false });
      const m = /^\(\?(?:[:=!]|<[=!]|<[^>]*>)/.exec(src.slice(i, i + 64));
      if (m) i += m[0].length - 1;
      ultimo = null; continue;
    }
    if (c === ')') {
      const g = pila.length > 1 ? pila.pop() : { rep: false };
      if (g.rep) pila[pila.length - 1].rep = true;
      ultimo = { rep: g.rep }; continue;
    }
    if (c === '|') { ultimo = null; continue; }
    let max = null;
    if (c === '*' || c === '+') max = Infinity;
    else if (c === '?') max = 1;
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i, i + 32));
      if (m) { max = !m[2] ? +m[1] : m[3] === '' ? Infinity : +m[3]; i += m[0].length - 1; }
    }
    if (max === null) { ultimo = { rep: false }; continue; }
    if (src[i + 1] === '?') i++;           // perezoso: igual de caro
    if (ultimo) {
      if (max > 1 && ultimo.rep) return true;
      if (max > 1 || ultimo.rep) pila[pila.length - 1].rep = true;
    }
    ultimo = null;
  }
  return false;
}

// Expresión de VS Code (cadena o { pattern, flags }) → RegExp. Las que no
// compilan en JavaScript se descartan, como hace VS Code, y también las de
// repetición anidada (ver arriba).
function re(v) {
  try {
    const [src, flags] = typeof v === 'string' ? [v, ''] : v && typeof v.pattern === 'string' ? [v.pattern, String(v.flags || '').replace(/[^dgimsuy]/g, '')] : [null];
    if (src == null || nestedRepetition(src)) return undefined;
    return new RegExp(src, flags);
  } catch { /* inválida */ }
  return undefined;
}

// Todas las expresiones de un language-configuration.json que se descartarían
// por peligrosas (para avisar al instalar).
export function unsafeConfigRegexes(j) {
  if (!j || typeof j !== 'object') return [];
  const fuente = v => (typeof v === 'string' ? v : typeof v?.pattern === 'string' ? v.pattern : null);
  const todas = [j.wordPattern, j.indentationRules?.increaseIndentPattern, j.indentationRules?.decreaseIndentPattern,
    j.indentationRules?.indentNextLinePattern, j.indentationRules?.unIndentedLinePattern, j.folding?.markers?.start, j.folding?.markers?.end,
    ...(Array.isArray(j.onEnterRules) ? j.onEnterRules.flatMap(r => [r?.beforeText, r?.afterText, r?.previousLineText]) : [])];
  return todas.map(fuente).filter(s => s != null && nestedRepetition(s));
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
// instaladas mandan). Como VS Code: nombre exacto, luego patrones y luego la
// extensión más larga. La primera línea va aparte (firstLineCandidates): solo
// cuenta si nadie, ni las extensiones ni lo de serie, reclama el fichero.
export function matchLanguage(contribs, path) {
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
  return mejor;
}

// firstLine de las contribuciones, en orden (la última instalada primero):
// anclada al principio como en VS Code y sin las de repetición anidada.
export const FIRST_LINE_MAX = 200;         // caracteres de la primera línea que se miran
export function firstLineCandidates(contribs) {
  const out = [];
  for (let i = contribs.length - 1; i >= 0; i--) {
    const fl = contribs[i].firstLine;
    if (typeof fl !== 'string' || !fl || nestedRepetition(fl)) continue;
    const src = fl.startsWith('^') ? fl : '^' + fl;
    try { new RegExp(src); out.push({ id: contribs[i].id, src }); } catch { /* inválida */ }
  }
  return out;
}
// Corre las expresiones de verdad: en la página va dentro de un Worker con
// tiempo tope (firstline-worker.js), porque una expresión de un paquete puede
// no terminar nunca.
export function matchFirstLine(candidates, line) {
  const l = String(line ?? '').replace(/^﻿/, '').slice(0, FIRST_LINE_MAX);
  if (!l) return null;
  for (const c of candidates) {
    try { if (new RegExp(c.src).test(l)) return c.id; } catch { /* inválida */ }
  }
  return null;
}

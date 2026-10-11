// Del recinto a Monaco 0.52: cada resultado se reconstruye en objetos NUEVOS
// hechos solo de campos primitivos validados. Nada se pasa tal cual: un campo
// que no se conoce no llega, y uno que no cuadra se descarta. El texto pasa
// por sanitize.js (texto plano o markdown canónico).
import { isRange } from './protocol.js';
import { plainText, canonicalMarkdown, markdownFromText, stripClipboard } from './sanitize.js';

export const HANDLE_COMMAND = 'elffuss.x2.runHandle';
const MAXS = { label: 4096, text: 65536, insert: 100000 };
const s = (v, max = MAXS.label) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const int = (v, lo, hi) => (Number.isSafeInteger(v) && v >= lo && v <= hi ? v : undefined);

export function range(monaco, model, r) {
  if (!isRange(r)) return null;
  const v = model.validateRange(new monaco.Range(r[0], r[1], r[2], r[3]));
  return { startLineNumber: v.startLineNumber, startColumn: v.startColumn, endLineNumber: v.endLineNumber, endColumn: v.endColumn };
}

export function textEdits(monaco, model, list, max = 100000) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list.slice(0, max)) {
    if (!e || typeof e.text !== 'string') continue;
    const r = range(monaco, model, e.range);
    if (r) out.push({ range: r, text: e.text.slice(0, 10 << 20) });
  }
  return out;
}

const mdOf = c => (c && typeof c.md === 'string' ? canonicalMarkdown(c.md) : c && typeof c.text === 'string' ? markdownFromText(c.text) : null);
const textOf = c => (c && typeof c.md === 'string' ? plainText(c.md) : c && typeof c.text === 'string' ? c.text.slice(0, MAXS.text) : undefined);

export function hover(monaco, model, v) {
  if (!v || !Array.isArray(v.contents)) return null;
  const contents = v.contents.slice(0, 50).map(mdOf).filter(Boolean);
  if (!contents.length) return null;
  const out = { contents };
  const r = v.range && range(monaco, model, v.range);
  if (r) out.range = r;
  return out;
}

const itemHandles = new WeakMap();
export const handleOfItem = item => itemHandles.get(item);

const command = c => (c && Number.isSafeInteger(c.handle) ? { id: HANDLE_COMMAND, title: s(c.title, 500) || '', arguments: [c.handle] } : undefined);

export function completionItem(monaco, model, position, it) {
  if (!it || typeof it !== 'object') return null;
  let label;
  if (typeof it.label === 'string') label = it.label.slice(0, MAXS.label);
  else if (it.label && typeof it.label.label === 'string') label = { label: it.label.label.slice(0, MAXS.label), detail: s(it.label.detail, 1000), description: s(it.label.description, 1000) };
  else return null;
  const rules = (int(it.insertTextRules, 0, 7) ?? 0) & (1 | 4);       // KeepWhitespace | InsertAsSnippet
  let insertText = typeof it.insertText === 'string' ? it.insertText.slice(0, MAXS.insert) : (typeof label === 'string' ? label : label.label);
  if (rules & 4) insertText = stripClipboard(insertText);
  let r;
  if (Array.isArray(it.range)) r = range(monaco, model, it.range);
  else if (it.range && Array.isArray(it.range.insert) && Array.isArray(it.range.replace)) {
    const a = range(monaco, model, it.range.insert), b = range(monaco, model, it.range.replace);
    if (a && b) r = { insert: a, replace: b };
  }
  if (!r) {
    const w = model.getWordUntilPosition(position);
    r = { startLineNumber: position.lineNumber, startColumn: w.startColumn, endLineNumber: position.lineNumber, endColumn: position.column };
  }
  const out = {
    label, kind: int(it.kind, 0, 27) ?? 18, insertText, insertTextRules: rules, range: r,
    detail: it.detail != null ? plainText(s(it.detail, MAXS.label)) : undefined,
    documentation: textOf(it.documentation),
    sortText: s(it.sortText, 1000), filterText: s(it.filterText, 1000), preselect: it.preselect === true,
    tags: Array.isArray(it.tags) && it.tags.includes(1) ? [1] : undefined,
    commitCharacters: Array.isArray(it.commitCharacters) ? it.commitCharacters.filter(c => typeof c === 'string' && c.length === 1).slice(0, 20) : undefined,
    additionalTextEdits: Array.isArray(it.additionalTextEdits) ? textEdits(monaco, model, it.additionalTextEdits, 1000) : undefined,
    command: command(it.command),
  };
  if (Number.isSafeInteger(it.h)) itemHandles.set(out, it.h);
  return out;
}

export function signatureHelp(v) {
  if (!v || !Array.isArray(v.signatures)) return null;
  const signatures = v.signatures.slice(0, 100).map(sig => ({
    label: s(sig && sig.label) || '',
    documentation: textOf(sig && sig.documentation),
    activeParameter: int(sig && sig.activeParameter, 0, 1000),
    parameters: Array.isArray(sig && sig.parameters) ? sig.parameters.slice(0, 100).map(p => ({
      label: Array.isArray(p && p.label) && p.label.length === 2 && p.label.every(n => int(n, 0, 1e6) !== undefined) ? [p.label[0], p.label[1]] : s(p && p.label, 1000) || '',
      documentation: textOf(p && p.documentation),
    })) : [],
  }));
  if (!signatures.length) return null;
  return { signatures, activeSignature: int(v.activeSignature, 0, 1000) ?? 0, activeParameter: int(v.activeParameter, 0, 1000) ?? 0 };
}

export function symbols(monaco, model, list, depth = 0) {
  if (!Array.isArray(list) || depth > 20) return [];
  const out = [];
  for (const x of list.slice(0, 10000)) {
    if (!x || typeof x.name !== 'string') continue;
    const r = range(monaco, model, x.range), sel = range(monaco, model, x.selectionRange) || r;
    if (!r) continue;
    out.push({
      name: x.name.slice(0, 1000) || '?', detail: s(x.detail, 1000) || '', kind: int(x.kind, 0, 25) ?? 0,
      tags: Array.isArray(x.tags) && x.tags.includes(1) ? [1] : [], range: r, selectionRange: sel,
      children: symbols(monaco, model, x.children, depth + 1),
    });
  }
  return out;
}

// Resultados que apuntan a documentos: solo los que Code tiene abiertos.
export function locations(monaco, list, modelForUri) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const l of list.slice(0, 10000)) {
    const target = l && typeof l.uri === 'string' ? modelForUri(l.uri) : null;
    if (!target) continue;
    const r = range(monaco, target, l.range);
    if (!r) continue;
    out.push({ uri: target.uri, range: r });
  }
  return out;
}

export function highlights(monaco, model, list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10000).map(h => { const r = h && range(monaco, model, h.range); return r ? { range: r, kind: int(h.kind, 0, 2) ?? 0 } : null; }).filter(Boolean);
}

// Ediciones de espacio de trabajo: en v1, solo sobre el documento activo.
export function workspaceEdit(monaco, model, uriOfModel, v) {
  if (!v || !Array.isArray(v.edits)) return { edit: null, reason: 'no changes' };
  const mine = uriOfModel(model);
  const foreign = v.edits.some(e => !e || e.uri !== mine) || (Number.isSafeInteger(v.fileOps) && v.fileOps > 0);
  if (foreign) return { edit: null, reason: 'it changes other files, which Elffuss Code does not allow extensions to do yet' };
  const edits = textEdits(monaco, model, v.edits).map(te => ({ resource: model.uri, textEdit: te, versionId: undefined }));
  return { edit: { edits }, reason: s(v.rejectReason, 1000) };
}

export function codeAction(monaco, model, uriOfModel, a) {
  if (!a || typeof a.title !== 'string') return null;
  const out = { title: a.title.slice(0, 1000), kind: s(a.kind, 200), isPreferred: a.isPreferred === true };
  const disabled = s(a.disabled, 1000);
  if (a.edit) {
    const w = workspaceEdit(monaco, model, uriOfModel, a.edit);
    if (w.edit) out.edit = w.edit;
    else out.disabled = w.reason;
  }
  if (disabled) out.disabled = disabled;
  const c = command(a.command);
  if (c) out.command = c;
  if (Number.isSafeInteger(a.h)) itemHandles.set(out, a.h);
  return out;
}

const SEVERITY = new Set([1, 2, 4, 8]);
export function markers(monaco, model, list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const mk of list.slice(0, 5000)) {
    const r = mk && range(monaco, model, mk.range);
    if (!r || typeof mk.message !== 'string') continue;
    out.push({
      severity: SEVERITY.has(mk.severity) ? mk.severity : 8, message: plainText(mk.message.slice(0, MAXS.text)) || ' ',
      source: s(mk.source, 200), code: s(mk.code, 200), ...r,
      tags: Array.isArray(mk.tags) ? mk.tags.filter(t => t === 1 || t === 2) : undefined,
    });
  }
  return out;
}

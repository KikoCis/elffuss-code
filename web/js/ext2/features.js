// Proveedores de las extensiones, vistos desde la página: por cada
// «providers.add» del recinto se registra en el Monaco 0.52 de Code un
// proveedor equivalente que pregunta al recinto (invoke) y reconstruye la
// respuesta con convert.js. Los modelos de Code son inmemory://, así que el
// selector de la extensión se traduce: esquemas file/untitled/* valen (se
// quitan), cualquier otro no se registra, y los patrones se comprueban aquí
// contra file:///<ruta del proyecto> con un comparador de tiempo lineal.
import * as convert from './convert.js';

// ── glob en tiempo lineal (sin expresiones regulares que puedan atascarse) ──
const MAX_BRACES = 64;
function expandBraces(p) {
  const out = [];
  const stack = [p];
  while (stack.length && out.length < MAX_BRACES) {
    const x = stack.pop();
    const i = x.indexOf('{');
    if (i < 0) { out.push(x); continue; }
    let depth = 0, j = i;
    for (; j < x.length; j++) { if (x[j] === '{') depth++; else if (x[j] === '}' && --depth === 0) break; }
    if (j >= x.length) { out.push(x); continue; }
    const inner = x.slice(i + 1, j), alts = [];
    let d = 0, last = 0;
    for (let k = 0; k < inner.length; k++) {
      if (inner[k] === '{') d++; else if (inner[k] === '}') d--;
      else if (inner[k] === ',' && d === 0) { alts.push(inner.slice(last, k)); last = k + 1; }
    }
    alts.push(inner.slice(last));
    for (const a of alts.reverse()) stack.push(x.slice(0, i) + a + x.slice(j + 1));
  }
  return out;
}
function tokens(p) {
  const t = [];
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') { t.push({ k: 'G' }); while (p[i + 1] === '*') i++; }
      else t.push({ k: 'S' });
    } else if (c === '?') t.push({ k: 'A' });
    else if (c === '[') {
      const j = p.indexOf(']', i + 2);
      if (j < 0) { t.push({ k: 'L', c }); continue; }
      let body = p.slice(i + 1, j);
      const neg = body[0] === '!' || body[0] === '^';
      if (neg) body = body.slice(1);
      const ranges = [];
      for (let k = 0; k < body.length; k++) {
        if (body[k + 1] === '-' && k + 2 < body.length) { ranges.push([body[k], body[k + 2]]); k += 2; }
        else ranges.push([body[k], body[k]]);
      }
      t.push({ k: 'C', neg, ranges });
      i = j;
    } else t.push({ k: 'L', c: c === '\\' ? '/' : c });
  }
  return t;
}
function run(t, path) {
  const closure = set => {
    for (const i of [...set]) for (let k = i; k < t.length && (t[k].k === 'S' || t[k].k === 'G'); k++) set.add(k + 1);
    return set;
  };
  let cur = closure(new Set([0]));
  for (const ch of path) {
    const next = new Set();
    for (const i of cur) {
      const tok = t[i];
      if (!tok) continue;
      if (tok.k === 'G') next.add(i);
      else if (tok.k === 'S') { if (ch !== '/') next.add(i); }
      else if (tok.k === 'A') { if (ch !== '/') next.add(i + 1); }
      else if (tok.k === 'C') { if (ch !== '/' && tok.ranges.some(([a, b]) => ch >= a && ch <= b) !== tok.neg) next.add(i + 1); }
      else if (tok.c === ch) next.add(i + 1);
    }
    if (!next.size) return false;
    cur = closure(next);
  }
  return cur.has(t.length);
}
export function globMatch(pattern, path) {
  if (typeof pattern !== 'string' || pattern.length > 500 || typeof path !== 'string') return false;
  const p = pattern.replace(/\\/g, '/');
  return expandBraces(p).some(x => run(tokens(x), path));
}

// selector del recinto → { languages para Monaco, filtros que se comprueban aquí }
export function compileSelector(selector) {
  const filters = [];
  for (const f of Array.isArray(selector) ? selector : []) {
    if (!f) continue;
    if (f.scheme && !['file', 'untitled', '*'].includes(f.scheme)) continue;
    filters.push({ language: f.language || '*', pattern: f.pattern || null });
  }
  const langs = new Set(filters.map(f => f.language));
  return { filters, monacoSelector: langs.has('*') ? '*' : [...langs], hasLanguage: filters.some(f => f.language !== '*') };
}
export function selectorMatches(filters, path, languageId) {
  const fsPath = '/' + path;
  return filters.some(f => (f.language === '*' || f.language === languageId) && (!f.pattern || globMatch(f.pattern, fsPath) || globMatch(f.pattern, path)));
}

export class Features {
  // call(kind, handle, model, args, token) → valor del recinto, o null si no aplica
  constructor({ monaco, call, docs, touched = () => {}, release = () => {}, report = () => {} }) {
    this.monaco = monaco;
    this.call = call;
    this.docs = docs;
    this.touched = touched;
    this.release = release;
    this.report = report;
    this.handles = new Map();                    // handle → { kind, dispose }
    this.specs = new Map();                      // handle → lo que mandó el recinto (para volver a registrarlo)
    this.prefs = new Map();                      // id de extensión → { lenguaje: 'builtin' | 'extension' }
  }

  // Formateador por lenguaje: «de serie» quita el de esa extensión para ese
  // lenguaje (Monaco elige el más nuevo, así que si no, ganaría la extensión).
  setPrefs(prefs) {
    const next = new Map([...prefs].map(([k, v]) => [String(k).toLowerCase(), v || {}]));
    if (JSON.stringify([...next]) === JSON.stringify([...this.prefs])) return;
    this.prefs = next;
    for (const spec of [...this.specs.values()]) if (spec.kind.startsWith('format')) { this.remove(spec.handle); this.add(spec); }
  }
  // lenguajes con formateador de cada extensión (para el panel)
  formatters() {
    const out = {};
    for (const s of this.specs.values()) {
      if (!s.kind.startsWith('format') || typeof s.meta?.extension !== 'string') continue;
      const id = s.meta.extension.toLowerCase();
      const langs = (Array.isArray(s.selector) ? s.selector : []).map(f => f && f.language).filter(l => typeof l === 'string' && l !== '*');
      out[id] = [...new Set([...(out[id] || []), ...langs])].sort();
    }
    return out;
  }

  add(spec) {
    const { handle, kind, selector, meta = {} } = spec;
    const { monaco, docs } = this;
    this.specs.set(handle, spec);
    const sel = compileSelector(selector);
    if (!sel.filters.length) { this.report(handle, kind, 'its selector targets documents Code does not have'); return; }
    if (kind.startsWith('format') && !sel.hasLanguage) { this.report(handle, kind, 'formatters need a language; this one only names file patterns'); return; }
    if (kind.startsWith('format') && Array.isArray(sel.monacoSelector)) {
      const pref = this.prefs.get(String(meta.extension || '').toLowerCase()) || {};
      sel.monacoSelector = sel.monacoSelector.filter(l => pref[l] !== 'builtin');
      if (!sel.monacoSelector.length) return;      // el usuario prefiere el de serie en todos sus lenguajes
    }
    const ask = async (k, model, args, token) => {
      const path = docs.pathOf(model);
      if (!path || !selectorMatches(sel.filters, path, model.getLanguageId())) return null;
      return this.call(k, handle, model, args, token);
    };
    const pos = p => [p.lineNumber, p.column];
    const rng = r => [r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn];
    const opts = o => ({ tabSize: o?.tabSize, insertSpaces: !!o?.insertSpaces });
    const L = monaco.languages;
    const edited = (model, edits) => { if (edits.length) this.touched(model); return edits; };
    const modelForUri = uri => docs.modelForUri(uri);
    const uriOf = m => docs.uriOf(m);
    const strs = (v, n) => (Array.isArray(v) ? v.filter(c => typeof c === 'string' && c.length === 1).slice(0, n) : []);
    let d;
    switch (kind) {
      case 'format':
        d = L.registerDocumentFormattingEditProvider(sel.monacoSelector, {
          displayName: typeof meta.displayName === 'string' ? meta.displayName.slice(0, 100) : undefined,
          provideDocumentFormattingEdits: async (model, o, token) => edited(model, convert.textEdits(monaco, model, (await ask('format', model, { options: opts(o) }, token))?.edits)),
        });
        break;
      case 'formatRange':
        d = L.registerDocumentRangeFormattingEditProvider(sel.monacoSelector, {
          displayName: typeof meta.displayName === 'string' ? meta.displayName.slice(0, 100) : undefined,
          provideDocumentRangeFormattingEdits: async (model, r, o, token) => edited(model, convert.textEdits(monaco, model, (await ask('formatRange', model, { range: rng(r), options: opts(o) }, token))?.edits)),
        });
        break;
      case 'formatOnType': {
        const chars = strs(meta.triggerCharacters, 20);
        if (!chars.length) return;
        d = L.registerOnTypeFormattingEditProvider(sel.monacoSelector, {
          autoFormatTriggerCharacters: chars,
          provideOnTypeFormattingEdits: async (model, p, ch, o, token) => edited(model, convert.textEdits(monaco, model, (await ask('formatOnType', model, { position: pos(p), ch, options: opts(o) }, token))?.edits)),
        });
        break;
      }
      case 'hover':
        d = L.registerHoverProvider(sel.monacoSelector, {
          provideHover: async (model, p, token) => convert.hover(monaco, model, await ask('hover', model, { position: pos(p) }, token)),
        });
        break;
      case 'completion': {
        const resolve = meta.resolve === true;
        const owners = new WeakMap();
        d = L.registerCompletionItemProvider(sel.monacoSelector, {
          triggerCharacters: strs(meta.triggerCharacters, 50),
          provideCompletionItems: async (model, p, context, token) => {
            const v = await ask('completion', model, { position: pos(p), triggerKind: context?.triggerKind, triggerCharacter: context?.triggerCharacter }, token);
            if (!v || !Array.isArray(v.suggestions)) return null;
            const suggestions = v.suggestions.slice(0, 5000).map(it => convert.completionItem(monaco, model, p, it)).filter(Boolean);
            for (const s of suggestions) owners.set(s, model);
            // aceptar una puede meter texto de la extensión en el documento
            if (suggestions.length) this.touched(model);
            const hs = suggestions.map(convert.handleOfItem).filter(Number.isSafeInteger);
            return { suggestions, incomplete: v.incomplete === true, dispose: () => this.release(hs) };
          },
          ...(resolve ? {
            resolveCompletionItem: async (item, token) => {
              const model = owners.get(item), h = convert.handleOfItem(item);
              if (!model || model.isDisposed() || !Number.isSafeInteger(h)) return item;
              const v = await this.call('completion.resolve', handle, model, { item: h }, token);
              if (!v) return item;
              const r = convert.completionItem(monaco, model, model.validatePosition({ lineNumber: 1, column: 1 }), { ...v, range: undefined });
              if (!r) return item;
              // solo los detalles: lo que se inserta no cambia al resolver
              return { ...item, detail: r.detail ?? item.detail, documentation: r.documentation ?? item.documentation, additionalTextEdits: r.additionalTextEdits ?? item.additionalTextEdits, command: r.command ?? item.command };
            },
          } : {}),
        });
        break;
      }
      case 'signature':
        d = L.registerSignatureHelpProvider(sel.monacoSelector, {
          signatureHelpTriggerCharacters: strs(meta.triggerCharacters, 20),
          signatureHelpRetriggerCharacters: strs(meta.retriggerCharacters, 20),
          provideSignatureHelp: async (model, p, token, context) => {
            const value = convert.signatureHelp(await ask('signature', model, { position: pos(p), triggerKind: context?.triggerKind, triggerCharacter: context?.triggerCharacter, isRetrigger: !!context?.isRetrigger }, token));
            return value ? { value, dispose() {} } : null;
          },
        });
        break;
      case 'codeAction': {
        const resolve = meta.resolve === true;
        const owners = new WeakMap();
        d = L.registerCodeActionProvider(sel.monacoSelector, {
          provideCodeActions: async (model, r, context, token) => {
            const v = await ask('codeAction', model, { range: rng(r), trigger: context?.trigger, only: context?.only }, token);
            if (!v || !Array.isArray(v.actions)) return { actions: [], dispose() {} };
            const actions = v.actions.slice(0, 500).map(a => convert.codeAction(monaco, model, uriOf, a)).filter(Boolean);
            for (const a of actions) { owners.set(a, model); if (a.edit) this.touched(model); }
            const hs = actions.map(convert.handleOfItem).filter(Number.isSafeInteger);
            return { actions, dispose: () => this.release(hs) };
          },
          ...(resolve ? {
            resolveCodeAction: async (action, token) => {
              const model = owners.get(action), h = convert.handleOfItem(action);
              if (!model || model.isDisposed() || !Number.isSafeInteger(h)) return action;
              const v = await this.call('codeAction.resolve', handle, model, { action: h }, token);
              const r = v && convert.codeAction(monaco, model, uriOf, v);
              return r ? { ...action, edit: r.edit ?? action.edit, disabled: r.disabled ?? action.disabled, command: r.command ?? action.command } : action;
            },
          } : {}),
        // sin tipos declarados, ninguno: Monaco descartaría el proveedor al pedir «solo arreglos»
        }, { providedCodeActionKinds: Array.isArray(meta.kinds) && meta.kinds.length ? meta.kinds.filter(k => typeof k === 'string').slice(0, 50) : undefined });
        break;
      }
      case 'symbols':
        d = L.registerDocumentSymbolProvider(sel.monacoSelector, {
          displayName: typeof meta.displayName === 'string' ? meta.displayName.slice(0, 100) : undefined,
          provideDocumentSymbols: async (model, token) => convert.symbols(monaco, model, (await ask('symbols', model, {}, token))?.symbols),
        });
        break;
      case 'definition': case 'declaration': case 'typeDefinition': case 'implementation': {
        const reg = { definition: 'registerDefinitionProvider', declaration: 'registerDeclarationProvider', typeDefinition: 'registerTypeDefinitionProvider', implementation: 'registerImplementationProvider' }[kind];
        const method = { definition: 'provideDefinition', declaration: 'provideDeclaration', typeDefinition: 'provideTypeDefinition', implementation: 'provideImplementation' }[kind];
        d = L[reg](sel.monacoSelector, { [method]: async (model, p, token) => convert.locations(monaco, (await ask(kind, model, { position: pos(p) }, token))?.locations, modelForUri) });
        break;
      }
      case 'references':
        d = L.registerReferenceProvider(sel.monacoSelector, {
          provideReferences: async (model, p, context, token) => convert.locations(monaco, (await ask('references', model, { position: pos(p), includeDeclaration: context?.includeDeclaration !== false }, token))?.locations, modelForUri),
        });
        break;
      case 'highlights':
        d = L.registerDocumentHighlightProvider(sel.monacoSelector, {
          provideDocumentHighlights: async (model, p, token) => convert.highlights(monaco, model, (await ask('highlights', model, { position: pos(p) }, token))?.highlights),
        });
        break;
      case 'rename':
        d = L.registerRenameProvider(sel.monacoSelector, {
          provideRenameEdits: async (model, p, newName, token) => {
            const w = convert.workspaceEdit(monaco, model, uriOf, await ask('rename', model, { position: pos(p), newName }, token));
            if (!w.edit) return { edits: [], rejectReason: w.reason || 'nothing to rename' };
            this.touched(model);
            return w.edit;
          },
          ...(meta.resolve === true ? {
            resolveRenameLocation: async (model, p, token) => {
              const v = await ask('rename.resolve', model, { position: pos(p) }, token);
              if (!v) return null;
              const r = convert.range(monaco, model, v.range);
              return r ? { range: r, text: typeof v.text === 'string' ? v.text.slice(0, 1000) : model.getValueInRange(r), rejectReason: typeof v.rejectReason === 'string' ? v.rejectReason.slice(0, 1000) : undefined } : null;
            },
          } : {}),
        });
        break;
      default:
        return;
    }
    this.handles.set(handle, { kind, dispose: () => d?.dispose() });
  }

  remove(handle) {
    this.specs.delete(handle);
    const h = this.handles.get(handle);
    if (!h) return;
    this.handles.delete(handle);
    try { h.dispose(); } catch { /* ya fuera */ }
  }

  kinds() { return [...this.handles.values()].map(h => h.kind); }
  dispose() { for (const k of [...this.handles.keys()]) this.remove(k); this.specs.clear(); }
}

// Documentos abiertos en Code ↔ sus copias en el recinto («EditorPort»).
//
// El editor de la página es el de siempre (Monaco 0.52 de ide.js); este
// módulo solo ESCUCHA sus modelos y manda al recinto lo justo para que las
// extensiones trabajen: los documentos abiertos como file:///<ruta del
// proyecto> (sin nombre de proyecto ni ruta absoluta), la selección activa y
// cada cambio con su versión. La página manda siempre:
//
//   · cambio en la página → doc.change {base, v, changes}; si el recinto no
//     tiene esa base, pide doc.need y se le manda doc.reset (texto entero).
//   · cambio de una extensión → doc.edit {base, steps}: se aplica SOLO si es el
//     documento activo y su versión sigue siendo base, como un único paso de
//     deshacer; se contesta doc.ack. Si no, se descarta (doc.reset + aviso).
//   · lo que escribe el agente (setValue) → doc.reset.
//
// Ningún fichero se guarda desde aquí: guardar sigue siendo Cmd+S → code.write.
import * as code from '../tools/code.js';
import { range as validRange } from './convert.js';

const MAX_DOC = 5 * 1024 * 1024;

export class EditorPort {
  // openTabs(): [[ruta, modelo]] de las pestañas de ide.js (las que ya
  // estaban abiertas al arrancar el recinto también se ven, como en VS Code)
  constructor({ monaco, editor, post, notify = () => {}, maxBytes = MAX_DOC, openTabs = () => [] }) {
    this.monaco = monaco;
    this.editor = editor;
    this.post = post;
    this.notify = notify;
    this.maxBytes = maxBytes;
    this.openTabs = openTabs;
    this.byModel = new Map();                       // model → { uri, path, v, subs }
    this.byUri = new Map();                         // uri → model
    this.applying = null;
    this.subs = [];
    this.selTimer = null;
    this.tooBig = new Set();
  }

  start() {
    const ed = this.editor;
    this.subs.push(ed.onDidChangeModel(() => { this.track(ed.getModel()); this.sendActive(); }));
    this.subs.push(ed.onDidChangeCursorSelection(() => {
      clearTimeout(this.selTimer);
      this.selTimer = setTimeout(() => this.sendActive(), 80);
    }));
    // Todas las pestañas abiertas, no solo la activa: una extensión que
    // arranca con el lenguaje de un documento (onLanguage) lo ve aunque se
    // abriera antes que el recinto, y sin que el usuario vuelva a esa pestaña.
    let tabs = [];
    try { tabs = this.openTabs() || []; } catch { tabs = []; }
    for (const [path, model] of tabs) if (model !== ed.getModel()) this.track(model, path);
    this.track(ed.getModel());
    this.sendActive();
  }

  uriFor(path) { return this.monaco.Uri.file('/' + path.replace(/^\/+/, '')).toString(); }
  uriOf(model) { return this.byModel.get(model)?.uri || null; }
  pathOf(model) { return this.byModel.get(model)?.path || null; }
  modelForUri(uri) { const m = this.byUri.get(uri); return m && !m.isDisposed() ? m : null; }
  isMirrored(model) { return this.byModel.has(model); }

  // El modelo que acaba de entrar en el editor: su ruta es el fichero actual
  // de Code (ide.js la fija justo antes de setModel), o la de su pestaña al
  // arrancar. Sin ruta (el estado vacío, el chat) no se manda nada.
  track(model, path = code.current().currentFile) {
    if (!model || model.isDisposed() || this.byModel.has(model)) return;
    if (typeof path !== 'string' || !path) return;
    const uri = this.uriFor(path);
    if (this.byUri.has(uri) && this.byUri.get(uri) !== model) this.untrack(this.byUri.get(uri));
    const text = model.getValue();
    if (text.length > this.maxBytes) {
      if (!this.tooBig.has(uri)) { this.tooBig.add(uri); this.notify('big', path); }
      return;
    }
    const st = { uri, path, v: model.getVersionId(), subs: [] };
    this.byModel.set(model, st);
    this.byUri.set(uri, model);
    this.post({ t: 'doc.open', uri, lang: model.getLanguageId(), text, v: st.v });
    st.subs.push(model.onDidChangeContent(e => this.changed(model, st, e)));
    st.subs.push(model.onDidChangeLanguage(() => this.post({ t: 'doc.lang', uri, lang: model.getLanguageId() })));
    st.subs.push(model.onWillDispose(() => this.untrack(model)));
  }

  untrack(model) {
    const st = this.byModel.get(model);
    if (!st) return;
    for (const d of st.subs) { try { d.dispose(); } catch { /* — */ } }
    this.byModel.delete(model);
    if (this.byUri.get(st.uri) === model) this.byUri.delete(st.uri);
    this.post({ t: 'doc.close', uri: st.uri });
  }

  changed(model, st, e) {
    const base = st.v;
    st.v = model.getVersionId();
    if (this.applying === model) return;            // eco de un doc.edit: se contesta con doc.ack
    if (e.isFlush || e.isEolChange || model.getValueLength() > this.maxBytes) { this.reset(model); return; }
    this.post({ t: 'doc.change', uri: st.uri, base, v: st.v, changes: e.changes.map(c => ({ o: c.rangeOffset, l: c.rangeLength, t: c.text })) });
  }

  reset(model) {
    const st = this.byModel.get(model);
    if (!st) return;
    st.v = model.getVersionId();
    this.post({ t: 'doc.reset', uri: st.uri, text: model.getValue(), v: st.v });
  }

  need(uri) { const m = this.modelForUri(uri); if (m) this.reset(m); }

  selections() {
    return (this.editor.getSelections() || []).slice(0, 100).map(s => [s.selectionStartLineNumber, s.selectionStartColumn, s.positionLineNumber, s.positionColumn]);
  }

  sendActive() {
    const model = this.editor.getModel();
    const st = model && this.byModel.get(model);
    this.post({ t: 'editor.active', uri: st ? st.uri : null, selections: st ? this.selections() : [], v: st ? st.v : 0 });
  }

  // lo que hace falta para ejecutar un comando sobre el documento activo
  activeState() {
    const model = this.editor.getModel();
    const st = model && this.byModel.get(model);
    return st ? { uri: st.uri, selections: this.selections(), v: st.v } : {};
  }

  // Cambio que hizo una extensión en el recinto.
  applyEdit({ uri, base, steps }, { onTouched = () => {} } = {}) {
    const model = this.modelForUri(uri);
    if (!model) return;
    const active = this.editor.getModel() === model;
    if (!active || model.getVersionId() !== base) {
      this.reset(model);
      this.notify('discarded', this.pathOf(model));
      return;
    }
    const prepared = [];
    for (const step of steps) {
      const edits = [];
      for (const c of step) {
        const r = validRange(this.monaco, model, c.range);
        if (!r || typeof c.text !== 'string') { this.reset(model); return; }
        edits.push({ range: r, text: c.text, forceMoveMarkers: true });
      }
      prepared.push(edits);
    }
    const st = this.byModel.get(model);
    this.applying = model;
    try {
      this.editor.pushUndoStop();
      for (const edits of prepared) this.editor.executeEdits('x2', edits);
      this.editor.pushUndoStop();
    } finally { this.applying = null; }
    st.v = model.getVersionId();
    this.post({ t: 'doc.ack', uri, v: st.v });
    onTouched(model);
  }

  dispose() {
    clearTimeout(this.selTimer);
    for (const d of this.subs) { try { d.dispose(); } catch { /* — */ } }
    this.subs = [];
    for (const [model, st] of this.byModel) for (const d of st.subs) { try { d.dispose(); } catch { /* — */ } }
    this.byModel.clear();
    this.byUri.clear();
  }
}

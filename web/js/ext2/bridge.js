// Puente del nivel 2: arranca y para el recinto donde corre el código de las
// extensiones, y conecta el editor de Code con él.
//
// Este módulo NO se carga en el camino por defecto: lo importa js/ext/host.js
// (que a su vez solo existe para quien usa extensiones) cuando hay al menos
// una extensión activa con su código encendido y el usuario ya vio el tamaño.
// Orden: manifiesto → bundle verificado (vendor.js) → relevo como texto →
// iframe en el otro sitio (frame.js) → boot por el MessagePort → «ready» →
// documentos, proveedores y comandos. Cualquier fallo lo deja todo parado.
import { sandboxOrigin } from './config.js';
import { loadManifest, loadVendor, supported, disabledByUrl, runtimeInfo, RUNTIME_KEY } from './vendor.js';
import { openSandbox } from './frame.js';
import { validate, isPlainData, PROTOCOL, LIMITS } from './protocol.js';
import { EditorPort } from './docs.js';
import { Features } from './features.js';
import { Commands } from './commands.js';
import { ExtUI, loadCss, userActive } from './ui.js';
import { OpenGate, installAgentGate, markTouched } from './gates.js';
import { Decorations } from './decorations.js';
import * as convert from './convert.js';

const READY_TIMEOUT = 60000;
const CALL_TIMEOUT = 30000;

export { supported, disabledByUrl, runtimeInfo, RUNTIME_KEY };

// Manifiesto que ve el recinto: solo lo que el host de extensiones necesita.
// Fuera `main` (así no cabe un host de Node), lo declarativo que ya aplica el
// nivel 1 en la página (temas, gramáticas, snippets, lenguajes) y los atajos y
// menús (los ata la página).
export function sandboxManifest(manifest, installed = new Set()) {
  const keep = ['name', 'displayName', 'publisher', 'version', 'engines', 'browser', 'activationEvents', 'capabilities', 'l10n'];
  const out = {};
  for (const k of keep) if (manifest[k] !== undefined) out[k] = structuredClone(manifest[k]);
  out.extensionDependencies = (Array.isArray(manifest.extensionDependencies) ? manifest.extensionDependencies : [])
    .filter(d => typeof d === 'string' && installed.has(d.toLowerCase()));
  const c = manifest.contributes && typeof manifest.contributes === 'object' ? manifest.contributes : {};
  out.contributes = {};
  for (const k of ['commands', 'configuration', 'configurationDefaults']) if (c[k] !== undefined) out.contributes[k] = structuredClone(c[k]);
  // sus lenguajes los registra la página; que sigan activándola como en VS Code
  const langs = (Array.isArray(c.languages) ? c.languages : []).map(l => l && l.id).filter(id => typeof id === 'string' && /^[\w.+-]{1,100}$/.test(id));
  if (langs.length) out.activationEvents = [...new Set([...(Array.isArray(out.activationEvents) ? out.activationEvents : []), ...langs.map(id => 'onLanguage:' + id)])];
  return out;
}

// rpc-allowlist.json: { schema: 1, actors: { Actor: ['$método', …] }, hostSetup: { … } }
const validActorMap = o => !!o && typeof o === 'object' && !Array.isArray(o)
  && Object.entries(o).every(([a, ms]) => /^MainThread\w{1,80}$/.test(a) && Array.isArray(ms) && ms.length <= 200 && ms.every(x => typeof x === 'string' && /^\$\w{1,100}$/.test(x)));
export function validAllowlist(j) {
  return !!j && j.schema === 1 && validActorMap(j.actors) && (j.hostSetup === undefined || validActorMap(j.hostSetup));
}
// lo que manda al recinto: las dos listas juntas (actor → métodos)
export function allowedCalls(j) {
  const out = {};
  for (const src of [j.actors, j.hostSetup || {}]) for (const [a, ms] of Object.entries(src)) out[a] = [...new Set([...(out[a] || []), ...ms])];
  return out;
}

const listeners = new Set();
let session = null;
// Las que el recinto marcó «no soportada» (sustituyen el tecleo): no vuelven a
// entrar en esta pestaña. Y lo último que pidió host.js, para rehacer el recinto.
const refused = new Map();                         // id → motivo
let lastSync = null;
// el tema de Code (claro, oscuro, alto contraste): host.js lo dice al cambiar
let themeKind = 'dark';
export function setTheme(kind) {
  if (!['light', 'dark', 'hc', 'hc-light'].includes(kind) || kind === themeKind) return;
  themeKind = kind;
  if (session && session.state === 'running') session.post({ t: 'theme', kind });
}
let lastError = null;
const emit = () => { for (const f of listeners) { try { f(); } catch { /* — */ } } };
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

const refusedList = () => [...refused].map(([id, text]) => ({ id, state: 'unsupported', text, log: [], skipped: [] }));
export function state() {
  if (!session) return { state: lastError ? 'error' : 'stopped', error: lastError, extensions: refusedList(), commands: [], denials: { n: 0, top: [] } };
  return {
    state: session.state, error: session.error, violations: session.violations,
    denials: { n: session.denials.n, top: session.denials.top.map(x => [...x]) },
    ui: { dropped: { ...session.ui.dropped } },
    gate: { shown: session.gate.shown.map(x => ({ ...x })), opened: session.gate.opened, dropped: session.gate.dropped, blocked: session.gate.blocked },
    extensions: [...[...session.status.values()].filter(s => !refused.has(s.id)).map(s => ({ ...s, skipped: session.commands ? session.commands.skipped(s.id).map(x => ({ ...x })) : [] })), ...refusedList()],
    commands: session.commands ? session.commands.entries().map(({ id, label, hint, ext }) => ({ id, label, hint, ext })) : [],
    formatters: session.features ? session.features.formatters() : {},
  };
}
export const commands = () => (session?.commands ? session.commands.entries() : []);
export const runCommand = (id, args) => (session ? session.runCommand(id, args) : Promise.resolve(null));
// foto de la superficie de la API del recinto (para las pruebas: tests/x2-surface.json)
export const surface = () => (session && session.state === 'running' ? session.request({ t: 'surface' }) : Promise.resolve(null));
// para el censo: qué registraron las extensiones, y lanzar un evento de activación
export const stats = () => (session && session.state === 'running' ? session.request({ t: 'stats' }) : Promise.resolve(null));
export const activate = event => { if (session && session.state === 'running' && typeof event === 'string' && /^[\w:.*-]{1,200}$/.test(event)) session.post({ t: 'activate', event }); };

class Session {
  constructor({ monaco, readCode }) {
    this.monaco = monaco;
    this.readCode = readCode;
    this.state = 'starting';
    this.error = null;
    this.violations = 0;
    this.status = new Map();                       // id → { id, state, text, log[] }
    this.pending = new Map();                      // req → resolve
    this.nextReq = 1;
    this.added = new Map();                        // id → version
    this.disposables = [];
    this.markerOwners = new Map();                 // uri → Set(owner)
    this.contextKeys = new Map();
    this.denials = { n: 0, top: [] };              // llamadas que el cortafuegos de RPC rechazó
    this.names = new Map();                        // id → nombre visible (para decir quién pide algo)
    this.ui = new ExtUI({ nameOf: id => this.names.get(id) || null, log: (level, text, id) => this.log(id || null, level, text) });
    this.gate = new OpenGate({ log: (level, text) => this.log(null, level, text) });
    this.restoreAgent = null;
    this.readyPromise = new Promise((res, rej) => { this.onReady = res; this.onFail = rej; });
  }

  post(msg, transfer) {
    if (!this.port) return;
    if (!isPlainData(msg)) { console.warn('[x2] mensaje no plano, no se manda:', msg?.t); return; }
    this.port.postMessage(msg, transfer || []);
  }

  async start() {
    if (!supported()) throw Object.assign(new Error('level 2 needs Chrome or Edge in this version'), { code: 'browser' });
    const origin = sandboxOrigin();
    if (!origin) throw Object.assign(new Error('level 2 is not available on this site'), { code: 'site' });
    const manifest = await loadManifest();
    if (!manifest.enabled) throw Object.assign(new Error('level 2 is turned off'), { code: 'off' });
    const vendor = await loadVendor(manifest);
    const relayRes = await fetch(new URL('./sandbox-relay.js', import.meta.url), { cache: 'no-cache', credentials: 'same-origin' });
    if (!relayRes.ok) throw Object.assign(new Error('relay: HTTP ' + relayRes.status), { code: 'network' });
    const relay = await relayRes.text();
    // lista de llamadas permitidas del cortafuegos de RPC: sin ella no se arranca
    const rpc = await fetch(new URL('./rpc-allowlist.json', import.meta.url), { cache: 'no-cache', credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!validAllowlist(rpc)) throw Object.assign(new Error('the extension sandbox\'s call list is missing or broken'), { code: 'manifest' });
    if (this.state === 'stopped') return;
    this.frame = await openSandbox(origin, { onLost: e => this.fail(e) });
    if (this.state === 'stopped') { this.frame.close(); return; }
    this.port = this.frame.port;
    this.port.onmessage = ev => this.receive(ev.data);
    const config = {
      protocol: PROTOCOL,
      lang: document.documentElement.lang || 'en',
      theme: themeKind,
      languages: this.monaco.languages.getLanguages().slice(0, 1000).map(l => ({ id: l.id, extensions: (l.extensions || []).slice(0, 50), aliases: (l.aliases || []).slice(0, 10) })),
      rpc: { actors: allowedCalls(rpc) },
    };
    this.post({ t: 'boot', vendor: vendor.map(f => ({ role: f.role, name: f.name, bytes: f.bytes })), relay, config }, vendor.map(f => f.bytes));
    let timer;
    await Promise.race([this.readyPromise, new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('the extension sandbox did not start'), { code: 'timeout' })), READY_TIMEOUT); })])
      .finally(() => clearTimeout(timer));
    try { localStorage.setItem(RUNTIME_KEY, manifest.buildId); } catch { /* sin almacenamiento */ }
    loadCss();
    // ide.js crea el editor después de cargar las extensiones: se le espera
    this.editor = await this.waitEditor();
    if (this.state === 'stopped') return;
    this.wire();
    this.state = 'running';
    emit();
  }

  // el editor de la página: el de #editor (ide.js)
  pageEditor() {
    const host = document.getElementById('editor');
    return this.monaco.editor.getEditors().find(e => host && host.contains(e.getContainerDomNode())) || null;
  }

  waitEditor(timeout = 60000) {
    const ya = this.pageEditor();
    if (ya) return Promise.resolve(ya);
    return new Promise((resolve, reject) => {
      const mira = () => { const e = this.pageEditor(); if (e) { sub.dispose(); clearTimeout(t); resolve(e); } };
      const sub = this.monaco.editor.onDidCreateEditor(() => setTimeout(mira, 0));
      const t = setTimeout(() => { sub.dispose(); reject(Object.assign(new Error('Code\'s editor is not open'), { code: 'editor' })); }, timeout);
    });
  }

  wire() {
    const monaco = this.monaco;
    const editor = this.editor;
    this.docs = new EditorPort({
      monaco, editor, post: m => this.post(m),
      notify: (what, path) => statusbar(what === 'big'
        ? `Extensions do not see ${path}: it is larger than 5 MB.`
        : 'An extension\'s change was discarded because the file changed meanwhile.'),
    });
    this.features = new Features({
      monaco, docs: this.docs,
      call: (kind, handle, model, args, token) => this.invoke(kind, handle, model, args, token),
      touched: model => this.touch(model),
      release: hs => { if (hs.length) this.post({ t: 'release', handles: hs.slice(0, 5000) }); },
      report: (handle, kind, why) => this.log(null, 'warn', `a ${kind} provider was not connected: ${why}`),
    });
    this.commands = new Commands({
      monaco, editor,
      run: (id, args) => this.runCommand(id, args),
      onReport: (id, skipped) => this.log(id, 'warn', `${skipped.length} keybinding(s) skipped: ` + skipped.map(s => `${s.key || '?'} (${s.why})`).join(', ')),
    });
    this.disposables.push(monaco.editor.registerCommand(convert.HANDLE_COMMAND, (_, handle) => this.post({ t: 'cmd.exec', req: this.nextReq++, handle, ...this.docs.activeState() })));
    // enlaces del editor (Cmd+clic) mientras corren extensiones: una dirección
    // pudo escribirla una extensión, así que pregunta como open.request
    // (toString(true): la dirección como está escrita, sin volver a codificarla)
    this.disposables.push(monaco.editor.registerLinkOpener({
      open: async uri => { await this.gate.request(typeof uri?.toString === 'function' ? uri.toString(true) : String(uri), { fromEditor: true }); return true; },
    }));
    this.decorations = new Decorations({ monaco, editor, docs: this.docs });
    // los diagnósticos de la propia página (TS, JSON, CSS, HTML), para las
    // extensiones que los decoran (Error Lens y similares)
    const pendientes = new Map();                  // uri del recinto → modelo
    let reloj = null;
    const programa = model => {
      const uri = model && !model.isDisposed() && this.docs.uriOf(model);
      if (!uri) return;
      pendientes.set(uri, model);
      reloj ??= setTimeout(() => {
        reloj = null;
        for (const [u, m2] of pendientes) {
          if (m2.isDisposed()) continue;
          const markers = monaco.editor.getModelMarkers({ resource: m2.uri }).filter(x => !String(x.owner).startsWith('x2:')).slice(0, 5000).map(x => ({
            owner: String(x.owner).slice(0, 60), severity: x.severity, message: String(x.message).slice(0, 4096),
            ...(typeof x.source === 'string' ? { source: x.source.slice(0, 200) } : {}),
            ...(typeof x.code === 'string' ? { code: x.code.slice(0, 200) } : x.code && typeof x.code.value === 'string' ? { code: x.code.value.slice(0, 200) } : {}),
            range: [x.startLineNumber, x.startColumn, x.endLineNumber, x.endColumn],
          }));
          this.post({ t: 'markers.page', uri: u, markers });
        }
        pendientes.clear();
      }, 300);
    };
    this.disposables.push(monaco.editor.onDidChangeMarkers(uris => { for (const u of uris) programa(monaco.editor.getModel(u)); }));
    this.disposables.push(editor.onDidChangeModel(() => setTimeout(() => programa(editor.getModel()), 0)));
    setTimeout(() => programa(editor.getModel()), 0);
    // el agente: sus peticiones web y los runtimes del Bridge preguntan antes
    import('../tools/index.js').then(({ TOOLS }) => {
      if (this.state === 'stopped' || this.state === 'error' || this.restoreAgent) return;
      this.restoreAgent = installAgentGate(TOOLS, { log: (level, text) => this.log(null, level, text) });
    }).catch(e => this.log(null, 'warn', 'agent gate not installed: ' + (e?.message || e)));
    this.docs.start();
  }

  receive(msg) {
    const r = validate(msg);
    if (!r.ok) {
      if (++this.violations > LIMITS.violations) this.fail(Object.assign(new Error('the extension sandbox misbehaved'), { code: 'violations' }));
      return;
    }
    switch (msg.t) {
      case 'ready': this.onReady(); break;
      case 'fatal': this.fail(Object.assign(new Error('the extension sandbox failed: ' + (msg.text || msg.reason)), { code: 'fatal' })); break;
      case 'ext.status': {
        const s = this.status.get(msg.id) || { id: msg.id, log: [] };
        s.state = msg.state; s.text = msg.text || '';
        this.status.set(msg.id, s);
        // quitarla en el recinto no para su código: se rehace sin ella
        if (msg.state === 'unsupported' && !refused.has(msg.id)) { refused.set(msg.id, s.text); if (lastSync) setTimeout(() => sync(lastSync), 0); }
        emit();
        break;
      }
      case 'log': this.log(msg.id || null, msg.level, msg.text); break;
      case 'providers.add': this.features?.add(msg); emit(); break;
      case 'providers.remove': this.features?.remove(msg.handle); emit(); break;
      case 'result': { const p = this.pending.get(msg.req); if (p) { this.pending.delete(msg.req); p(msg.ok ? msg.value : (this.log(null, 'warn', 'call failed: ' + msg.error), null)); } break; }
      case 'doc.edit': this.docs?.applyEdit(msg, { onTouched: m => this.touch(m) }); break;
      case 'doc.need': this.docs?.need(msg.uri); break;
      case 'markers': this.markers(msg); break;
      case 'ctx.set': this.context(msg.key, msg.value); break;
      case 'rpc.denied':
        if (msg.n >= this.denials.n) { this.denials = { n: msg.n, top: msg.top }; emit(); }
        break;
      // lo que la extensión le pide al usuario: siempre se contesta
      case 'ui.notify': this.reply(msg.req, this.ui.notify(msg)); break;
      case 'ui.dialog': this.reply(msg.req, this.ui.dialog(msg)); break;
      case 'ui.pick': this.reply(msg.req, this.ui.pick(msg)); break;
      case 'ui.input': this.reply(msg.req, this.ui.input(msg)); break;
      case 'ui.cancel': this.ui.cancel(msg.req); break;
      case 'ui.progress': this.ui.setProgress(msg); break;
      case 'clipboard.write': this.ui.clipboard(msg.text); break;
      case 'open.request': this.reply(msg.req, this.openRequest(msg.url)); break;
      case 'editor.show': this.show(msg.uri); break;
      case 'editor.reveal': this.reveal(msg.uri, msg.range); break;
      case 'editor.selection': this.selection(msg.uri, msg.selections); break;
      case 'deco.type': this.decorations?.type(msg.key, msg.options); break;
      case 'deco.set': this.decorations?.set(msg.key, msg.uri, msg.ranges); break;
      case 'deco.remove': this.decorations?.remove(msg.key); break;
      case 'pong': break;
      default: break;
    }
  }

  // contesta una pregunta del recinto con un valor plano (o null si falla)
  reply(req, promise) {
    Promise.resolve(promise).then(v => v, () => null).then(v => {
      if (this.state === 'stopped' || this.state === 'error') return;
      this.post({ t: 'ui.result', req, value: isPlainData(v) ? (v ?? null) : null });
    });
  }

  // abrir una dirección externa: el diálogo de gates.js, que enseña la
  // dirección entera; solo se abre si el usuario lo pide
  openRequest(url) { return this.gate.request(url); }

  // el texto de una extensión entró en este documento: su vista previa HTML
  // preguntará antes (gates.js)
  touch(model) {
    const path = model && this.docs?.pathOf(model);
    if (path) markTouched(path).catch(() => {});
  }

  // una extensión quiere enseñar un documento abierto: solo se cambia de
  // pestaña si el usuario acaba de hacer algo (un clic, una tecla); si no, el
  // recinto vuelve a ver la pestaña de verdad
  async show(uri) {
    const model = this.docs?.modelForUri(uri);
    const path = model && this.docs.pathOf(model);
    if (!path) return;
    if (this.editor.getModel() === model) return;
    if (!userActive()) { this.log(null, 'info', 'an extension asked to show ' + path + ' without a recent click; the tab did not change'); this.docs.sendActive(); return; }
    try { await (await import('../ide.js')).openFile(path); } catch { this.docs.sendActive(); }
  }

  reveal(uri, range) {
    const model = this.docs?.modelForUri(uri);
    if (!model || this.editor.getModel() !== model) return;
    const r = convert.range(this.monaco, model, range);
    if (r) this.editor.revealRangeInCenterIfOutsideViewport(r);
  }

  selection(uri, selections) {
    const model = this.docs?.modelForUri(uri);
    if (!model || this.editor.getModel() !== model) return;
    const sels = selections.map(s => {
      const a = model.validatePosition({ lineNumber: s[0], column: s[1] }), b = model.validatePosition({ lineNumber: s[2], column: s[3] });
      return { selectionStartLineNumber: a.lineNumber, selectionStartColumn: a.column, positionLineNumber: b.lineNumber, positionColumn: b.column };
    });
    if (sels.length) this.editor.setSelections(sels);
  }

  log(id, level, text) {
    const s = id ? this.status.get(id) || { id, state: 'installed', text: '', log: [] } : null;
    if (s) { s.log.push({ level, text }); if (s.log.length > 200) s.log.shift(); this.status.set(id, s); }
    (level === 'error' ? console.warn : console.debug)('[x2]', id || '', text);
  }

  markers({ uri, owner, markers }) {
    const model = this.docs?.modelForUri(uri);
    if (!model) return;
    const key = 'x2:' + owner;
    this.monaco.editor.setModelMarkers(model, key, convert.markers(this.monaco, model, markers));
    if (!this.markerOwners.has(model)) this.markerOwners.set(model, new Set());
    this.markerOwners.get(model).add(key);
  }

  context(key, value) {
    if (!this.editor) return;
    let k = this.contextKeys.get(key);
    if (!k) { k = this.editor.createContextKey(key, value ?? undefined); this.contextKeys.set(key, k); }
    else k.set(value ?? undefined);
  }

  invoke(kind, handle, model, args, token) {
    const uri = this.docs?.uriOf(model);
    if (!uri || this.state !== 'running') return Promise.resolve(null);
    const req = this.nextReq++;
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (done) return; done = true; clearTimeout(timer); sub?.dispose(); this.pending.delete(req); resolve(v && typeof v === 'object' && v.stale ? null : v ?? null); };
      const timer = setTimeout(() => { this.post({ t: 'cancel', req }); finish(null); }, CALL_TIMEOUT);
      const sub = token?.onCancellationRequested?.(() => { this.post({ t: 'cancel', req }); finish(null); });
      this.pending.set(req, finish);
      this.post({ t: 'invoke', req, kind, handle, uri, v: model.getVersionId(), args });
    });
  }

  request(msg, timeout = CALL_TIMEOUT) {
    const req = this.nextReq++;
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pending.delete(req); resolve(null); }, timeout);
      this.pending.set(req, v => { clearTimeout(timer); resolve(v); });
      this.post({ ...msg, req });
    });
  }

  async runCommand(id, args) {
    if (this.state !== 'running') return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const req = this.nextReq++;
      const plainArgs = args === undefined ? undefined : isPlainData(args) ? [].concat(args) : undefined;
      const v = await new Promise(resolve => {
        const timer = setTimeout(() => { this.pending.delete(req); resolve(null); }, CALL_TIMEOUT);
        this.pending.set(req, x => { clearTimeout(timer); resolve(x); });
        this.post({ t: 'cmd.exec', req, id, args: plainArgs, ...this.docs.activeState() });
      });
      if (!(v && v.stale)) return v ? v.value ?? null : null;
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  }

  // ¿sobra alguna de las que ya están, o cambió de versión? (ver sync())
  stale(records) {
    const want = new Map(records.map(r => [r.id, r.version]));
    for (const [id, version] of this.added) if (want.get(id) !== version) return true;
    return false;
  }

  async sync(records) {
    const want = new Map(records.map(r => [r.id, r]));
    for (const id of [...this.added.keys()]) {
      if (!want.has(id) || want.get(id).version !== this.added.get(id)) {
        this.post({ t: 'ext.remove', id });
        this.commands?.remove(id);
        this.added.delete(id);
        this.status.delete(id);
      }
    }
    const installed = new Set(records.map(r => r.id));
    for (const r of records) this.names.set(r.id, String(r.displayName || r.id).slice(0, 200));
    this.features?.setPrefs(new Map(records.map(r => [r.id, r.formatter && typeof r.formatter === 'object' ? r.formatter : {}])));
    // los ajustes de todas, juntos (sin «__proto__», que cambiaría el prototipo)
    const settings = {};
    for (const r of records) {
      if (!r.settings || typeof r.settings !== 'object') continue;
      for (const [k, v] of Object.entries(r.settings)) if (k !== '__proto__') settings[k] = v;
    }
    this.post({ t: 'settings', json: JSON.stringify(settings) });
    for (const r of records) {
      if (this.added.has(r.id)) continue;
      const manifest = r.code?.manifest;
      if (!manifest || typeof manifest.browser !== 'string') { this.status.set(r.id, { id: r.id, state: 'error', text: 'no browser entry', log: [] }); continue; }
      let files;
      try { files = await this.readCode(r); }
      catch (e) { this.status.set(r.id, { id: r.id, state: 'error', text: 'its files could not be read: ' + (e?.message || e), log: [] }); continue; }
      if (this.state === 'stopped') return;
      this.added.set(r.id, r.version);
      this.status.set(r.id, { id: r.id, state: 'installed', text: '', log: [] });
      this.post({ t: 'ext.add', id: r.id, version: r.version, manifest: sandboxManifest(manifest, installed), files }, files.map(f => f[1]));
      this.commands.set({ id: r.id, displayName: r.displayName, manifest });
    }
    emit();
  }

  fail(e) {
    this.error = { code: e?.code || 'error', message: String(e?.message || e) };
    lastError = this.error;
    console.warn('[x2] nivel 2 parado:', this.error.message);
    this.stop('error');
  }

  stop(state = 'stopped') {
    if (this.state === 'stopped' || this.state === 'error') return;
    this.state = state;
    for (const p of this.pending.values()) { try { p(null); } catch { /* — */ } }
    this.pending.clear();
    try { this.ui.dispose(); } catch { /* — */ }
    try { this.restoreAgent?.(); } catch { /* — */ }
    this.restoreAgent = null;
    try { this.decorations?.dispose(); } catch { /* — */ }
    try { this.features?.dispose(); } catch { /* — */ }
    try { this.commands?.dispose(); } catch { /* — */ }
    try { this.docs?.dispose(); } catch { /* — */ }
    for (const [model, owners] of this.markerOwners) {
      if (!model.isDisposed()) for (const o of owners) this.monaco.editor.setModelMarkers(model, o, []);
    }
    this.markerOwners.clear();
    for (const k of this.contextKeys.values()) { try { k.reset(); } catch { /* — */ } }
    this.contextKeys.clear();
    for (const d of this.disposables) { try { d.dispose(); } catch { /* — */ } }
    this.disposables = [];
    try { this.port?.close(); } catch { /* — */ }
    try { this.frame?.close(); } catch { /* — */ }
    this.port = null;
    emit();
  }
}

function statusbar(text) {
  const el = document.getElementById('statusbar');
  if (el) el.textContent = text;
}

// Lo llama js/ext/host.js tras cada cambio: con al menos una extensión
// activa con su código encendido, el recinto está arrancado y al día; sin
// ninguna, se desmonta (sin recargar la página).
let cola = Promise.resolve();
export function sync(args) {
  const { monaco, records, readCode } = args;
  lastSync = args;
  const run = async () => {
    const live = disabledByUrl() ? [] : records.filter(r => r && r.enabled && r.runs && !refused.has(r.id));
    // Quitar una extensión del host de extensiones no para su código ni sus
    // proveedores (VS Code reinicia el host para eso): si sobra alguna de las
    // que ya corren, o cambió de versión, el recinto se rehace con las demás.
    if (session && session.state === 'running' && session.stale(live)) { session.stop(); session = null; }
    if (!live.length) { if (session) { session.stop(); session = null; } emit(); return state(); }
    if (!session || session.state === 'error' || session.state === 'stopped') {
      lastError = null;
      session = new Session({ monaco, readCode });
      emit();
      try { await session.start(); }
      catch (e) { session.fail(e); return state(); }
    }
    await session.sync(live);
    return state();
  };
  const r = cola.then(run, run);
  cola = r.catch(() => {});
  return r;
}

export function stop() {
  const r = cola.then(() => { if (session) { session.stop(); session = null; } emit(); });
  cola = r.catch(() => {});
  return r;
}

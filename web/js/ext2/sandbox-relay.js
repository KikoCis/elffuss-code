// Relevo del recinto de extensiones (nivel 2). Este fichero NO corre en Code:
// Code lo lee como texto y se lo entrega al recinto (otro sitio, sin red), que
// lo carga desde un blob:. Por eso no importa nada: recibe el bundle de VS Code
// ya cargado (`m`) y el MessagePort que creó la página.
//
// Qué hace:
//   · arranca los servicios de VS Code sin interfaz, con un editor espejo
//     oculto y servicios que fallan cerrados (abrir enlaces, portapapeles,
//     diálogos, ficheros);
//   · registra las extensiones con sus ficheros como blob: (el recinto nunca
//     pide nada a la red: la página ya bajó y verificó todo al instalar);
//   · mantiene copias de los documentos abiertos en Code, al día por versión;
//   · captura los proveedores (formateo, hover, símbolos…) que registran las
//     extensiones y los ejecuta cuando la página lo pide;
//   · devuelve SIEMPRE datos planos: la página valida y reconstruye todo.
//
// La página no se fía de nada de lo que salga de aquí.

const PROTOCOL = 1;
const MAX_DOC = 5 * 1024 * 1024;
const MAX_HANDLES = 2000;

// registro de VS Code → tipo de proveedor que entiende la página
const KINDS = {
  documentFormattingEditProvider: 'format',
  documentRangeFormattingEditProvider: 'formatRange',
  onTypeFormattingEditProvider: 'formatOnType',
  completionProvider: 'completion',
  hoverProvider: 'hover',
  signatureHelpProvider: 'signature',
  codeActionProvider: 'codeAction',
  documentSymbolProvider: 'symbols',
  definitionProvider: 'definition',
  declarationProvider: 'declaration',
  typeDefinitionProvider: 'typeDefinition',
  implementationProvider: 'implementation',
  referenceProvider: 'references',
  renameProvider: 'rename',
  documentHighlightProvider: 'highlights',
};
// los que aún no se pasan a la página (fase 2): se cuentan, nada más
const LATER = ['codeLensProvider', 'inlayHintsProvider', 'colorProvider', 'linkProvider', 'foldingRangeProvider', 'selectionRangeProvider',
  'linkedEditingRangeProvider', 'inlineCompletionsProvider', 'documentSemanticTokensProvider', 'documentRangeSemanticTokensProvider',
  'documentPasteEditProvider', 'documentDropEditProvider', 'newSymbolNamesProvider', 'multiDocumentHighlightProvider',
  'inlineValuesProvider', 'evaluatableExpressionProvider'];

const str = (v, max = 4096) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const errText = e => String((e && (e.message || e.name)) || e || 'error').slice(0, 500);

function emitter() {
  const ls = new Set();
  const event = (fn, thisArg, store) => {
    const f = thisArg ? fn.bind(thisArg) : fn;
    ls.add(f);
    const d = { dispose: () => ls.delete(f) };
    if (Array.isArray(store)) store.push(d); else if (store && typeof store.add === 'function') store.add(d);
    return d;
  };
  return { event, fire: v => { for (const f of [...ls]) { try { f(v); } catch { /* un oyente roto no para al resto */ } } } };
}

export async function start({ m, port, config, sandbox = {} }) {
  const { monaco } = m;
  const send = (msg, transfer) => { try { port.postMessage(msg, transfer || []); } catch (e) { try { port.postMessage({ t: 'log', level: 'error', text: 'unserializable message ' + msg.t + ': ' + errText(e) }); } catch { /* cerrado */ } } };
  const log = (level, text, id) => send({ t: 'log', level, text: String(text).slice(0, 2000), ...(id ? { id } : {}) });

  // Errores sin capturar del propio recinto (VS Code o una extensión): al
  // registro de la página, con lo que se sepa de ellos, y no a la consola.
  const describe = r => {
    if (r instanceof Error) return (r.name + ': ' + r.message + ' ' + String(r.stack || '').split('\n').slice(1, 3).join(' ')).slice(0, 500);
    try { return 'non-error ' + JSON.stringify(r, Object.getOwnPropertyNames(r || {})).slice(0, 500); } catch { return 'non-error ' + String(r).slice(0, 200); }
  };
  window.addEventListener('unhandledrejection', e => { e.preventDefault(); log('warn', 'unhandled rejection in the sandbox: ' + describe(e.reason)); });
  window.addEventListener('error', e => { e.preventDefault(); log('warn', 'uncaught error in the sandbox: ' + describe(e.error || e.message)); });

  // ── atribución: lo que llega del host de extensiones (RPC) ──
  // Cada llamada del host de extensiones al hilo principal pasa por aquí. Se
  // usa para saber qué proveedores registra una extensión (y no VS Code) y
  // para la foto de la superficie de la API. El cortafuegos (lista de
  // llamadas permitidas) se monta sobre este mismo punto.
  const proto = m.RPCProtocol.prototype;
  const actors = new Map();                         // nombre → actor
  let fromExtHost = 0;
  const invokeOriginal = proto._doInvokeHandler;
  const setOriginal = proto.set;
  proto.set = function (identifier, value) {
    try { actors.set(identifier.sid || m.getStringIdentifierForProxy(identifier.nid), value); } catch { /* — */ }
    return setOriginal.call(this, identifier, value);
  };
  // los fallos al activar una extensión llegan por aquí y no quedan en el
  // estado de VS Code: se apuntan para decir por qué no arranca
  const activationErrors = new Map();               // id → texto
  proto._doInvokeHandler = function (rpcId, methodName, args) {
    if (methodName === '$onExtensionActivationError') {
      try {
        const id = String((args[0] && (args[0].value || args[0]._lower)) || args[0]).toLowerCase();
        activationErrors.set(id, errText(args[1]) + (args[2] && args[2].dependency ? ` (missing dependency ${String(args[2].dependency).slice(0, 200)})` : ''));
        setTimeout(() => status(id), 0);
      } catch { /* — */ }
    }
    fromExtHost++;
    try { return invokeOriginal.call(this, rpcId, methodName, args); }
    finally { fromExtHost--; }
  };

  // ── servicios que fallan cerrados ──
  const openRefused = { n: 0 };
  const opener = {
    _serviceBrand: undefined,
    registerOpener: () => ({ dispose() {} }),
    registerValidator: () => ({ dispose() {} }),
    registerExternalUriResolver: () => ({ dispose() {} }),
    setDefaultExternalOpener() {},
    registerExternalOpener: () => ({ dispose() {} }),
    async open(resource) { openRefused.n++; log('warn', 'blocked an attempt to open ' + String(resource).slice(0, 200)); return false; },
    async resolveExternalUri(resource) { return { resolved: resource, dispose() {} }; },
  };
  const clipboard = {
    _serviceBrand: undefined,
    triggerPaste: () => undefined,
    writeText: async () => { log('warn', 'clipboard write blocked'); },
    readText: async () => '',
    readFindText: async () => '',
    writeFindText: async () => {},
    writeResources: async () => {},
    readResources: async () => [],
    hasResources: async () => false,
    clearInternalState() {},
    readImage: async () => new Uint8Array(0),
  };
  const noHandle = () => {
    const closed = emitter(), visible = emitter();
    return { close() { closed.fire(); }, onDidClose: closed.event, onDidChangeVisibility: visible.event, progress: { infinite() {}, total() {}, worked() {}, done() {} }, updateSeverity() {}, updateMessage() {}, updateActions() {} };
  };
  // v1 aún no pinta avisos: cuentan como enseñados y cerrados en el acto, así
  // una extensión que espera la respuesta del usuario recibe «ninguna» en vez
  // de quedarse esperando para siempre (la parte B2 los lleva a la página)
  const dismissed = () => { const h = noHandle(); setTimeout(() => h.close(), 0); return h; };
  const filterChanged = emitter();
  const msgText = msg => (typeof msg === 'string' ? msg : msg instanceof Error ? msg.message : msg && typeof msg.value === 'string' ? msg.value : String(msg));
  const notifications = {
    _serviceBrand: undefined,
    onDidChangeFilter: filterChanged.event,
    setFilter() {}, getFilter: () => 0, getFilters: () => [], removeFilter() {},
    notify(n) { log('info', 'notification: ' + msgText(n && n.message)); return dismissed(); },
    info(msg) { log('info', 'notification: ' + [].concat(msg).map(msgText).join(' ')); },
    warn(msg) { log('warn', 'notification: ' + [].concat(msg).map(msgText).join(' ')); },
    error(msg) { log('error', 'notification: ' + [].concat(msg).map(msgText).join(' ')); },
    prompt(sev, message) { log('info', 'prompt: ' + msgText(message)); return dismissed(); },
    status(message) { log('info', 'status: ' + msgText(message)); return { close() {} }; },
  };
  const dialogShown = emitter(), dialogWill = emitter();
  const dialogs = {
    _serviceBrand: undefined,
    onWillShowDialog: dialogWill.event,
    onDidShowDialog: dialogShown.event,
    confirm: async () => ({ confirmed: false }),
    prompt: async () => ({ result: undefined }),
    input: async () => ({ confirmed: false }),
    info: async () => {}, warn: async () => {}, error: async () => {}, about: async () => {},
  };
  const refuse = async () => { throw new Error('Not available in Elffuss Code.'); };
  const fileDialogs = {
    _serviceBrand: undefined,
    defaultFilePath: refuse, defaultFolderPath: refuse, defaultWorkspacePath: refuse,
    pickFileFolderAndOpen: refuse, pickFileAndOpen: refuse, pickFolderAndOpen: refuse, pickWorkspaceAndOpen: refuse,
    pickFileToSave: async () => undefined, preferredHome: refuse,
    showSaveDialog: async () => undefined, showSaveConfirm: async () => 1, showOpenDialog: async () => undefined,
  };

  // ── editor espejo: lo que VS Code cree que es «el editor activo» ──
  let mirror = null;
  const activeChanged = emitter(), visibleChanged = emitter();
  const none = () => ({ dispose() {} });
  const nothing = (...a) => none;
  const editorService = {
    _serviceBrand: undefined,
    onWillOpenEditor: nothing, onDidActiveEditorChange: activeChanged.event, onDidVisibleEditorsChange: visibleChanged.event,
    onDidEditorsChange: nothing, onDidCloseEditor: nothing, onDidMostRecentlyActiveEditorsChange: nothing,
    activeEditorPane: undefined, activeEditor: undefined, activeTextEditorLanguageId: undefined,
    visibleEditorPanes: [], visibleEditors: [], editors: [], count: 0, mostRecentlyActiveEditors: [],
    get activeTextEditorControl() { return mirror && mirror.getModel() ? mirror : undefined; },
    get visibleTextEditorControls() { return mirror ? [mirror] : []; },
    getVisibleTextEditorControls() { return mirror ? [mirror] : []; },
    getEditors: () => [], openEditor: async () => undefined, openEditors: async () => [], replaceEditors: async () => {},
    isOpened: () => false, isVisible: () => false, closeEditor: async () => {}, closeEditors: async () => {},
    findEditors: () => [], save: async () => ({ success: false, editors: [] }), saveAll: async () => ({ success: false, editors: [] }),
    revert: async () => false, revertAll: async () => false, createScoped() { return this; },
  };

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
  document.body.appendChild(host);
  const mirrorBox = document.createElement('div');
  mirrorBox.style.cssText = 'width:400px;height:200px';
  host.appendChild(mirrorBox);

  // estado de lenguaje (lo que VS Code pinta en la barra de estado): Code no
  // tiene esa barra; se acepta y no se enseña
  const statusChanged = emitter();
  const languageStatus = { _serviceBrand: undefined, onDidChange: statusChanged.event, addStatus: () => ({ dispose() {} }), getLanguageStatus: () => [] };

  await m.initialize({
    ...m.getExtensionServiceOverride({ enableWorkerExtensionHost: true }),
    ...m.getKeybindingsServiceOverride(),
    ...m.getConfigurationServiceOverride(),
    [m.IEditorService.toString()]: editorService,
    [m.IOpenerService.toString()]: opener,
    [m.IClipboardService.toString()]: clipboard,
    [m.INotificationService.toString()]: notifications,
    [m.IDialogService.toString()]: dialogs,
    [m.IFileDialogService.toString()]: fileDialogs,
    [m.ILanguageStatusService.toString()]: languageStatus,
  }, host);

  const commandService = await m.getService(m.ICommandService);
  const features = await m.getService(m.ILanguageFeaturesService);
  const markerService = await m.getService(m.IMarkerService);
  const extensionService = await m.getService(m.IExtensionService);
  const contextKeys = await m.getService(m.IContextKeyService);
  const quickInput = await m.getService(m.IQuickInputService);

  // selector rápido y cuadro de texto: v1 los cancela (la interfaz llega después)
  try {
    quickInput.pick = async () => { log('info', 'quick pick cancelled: not available yet'); return undefined; };
    quickInput.input = async () => { log('info', 'input box cancelled: not available yet'); return undefined; };
    quickInput.createQuickPick = () => { throw new Error('Not supported in Elffuss Code yet.'); };
    quickInput.createInputBox = () => { throw new Error('Not supported in Elffuss Code yet.'); };
  } catch { /* — */ }

  // lenguajes de la página (los de serie de Code y los del nivel 1)
  const knownLangs = new Set(monaco.languages.getLanguages().map(l => l.id));
  for (const l of Array.isArray(config.languages) ? config.languages : []) {
    if (!l || typeof l.id !== 'string' || knownLangs.has(l.id)) continue;
    monaco.languages.register({ id: l.id, extensions: (l.extensions || []).filter(x => typeof x === 'string'), aliases: (l.aliases || []).filter(x => typeof x === 'string') });
    knownLangs.add(l.id);
  }

  mirror = monaco.editor.create(mirrorBox, {
    model: null, readOnly: false, automaticLayout: false, minimap: { enabled: false },
    hover: { enabled: false }, links: false, codeLens: false, inlayHints: { enabled: 'off' }, colorDecorators: false,
    folding: false, 'semanticHighlighting.enabled': false, quickSuggestions: false, suggestOnTriggerCharacters: false,
    parameterHints: { enabled: false }, lightbulb: { enabled: 'off' }, occurrencesHighlight: 'off', selectionHighlight: false,
    stickyScroll: { enabled: false }, formatOnType: false, formatOnPaste: false, wordBasedSuggestions: 'off',
    matchBrackets: 'never', renderValidationDecorations: 'off',
  });
  mirror.onDidChangeModel(() => { activeChanged.fire(); visibleChanged.fire(); });
  activeChanged.fire();

  // ── proveedores: captura en cada registro de ILanguageFeaturesService ──
  let nextHandle = 1;
  const providers = new Map();                      // handle → { kind, provider }
  const later = { n: 0 };
  const lastExtension = { id: null };
  const selectorOf = sel => [].concat(sel).map(s => (typeof s === 'string' ? { language: s }
    : s && typeof s === 'object' ? { language: str(s.language, 100), scheme: str(s.scheme, 50), pattern: str(typeof s.pattern === 'string' ? s.pattern : s.pattern && s.pattern.pattern, 500) } : null)).filter(Boolean);
  for (const [name, kind] of Object.entries(KINDS)) {
    const reg = features[name];
    if (!reg || typeof reg.register !== 'function') continue;
    const orig = reg.register.bind(reg);
    reg.register = (selector, provider) => {
      const d = orig(selector, provider);
      if (!fromExtHost) return d;                   // de VS Code mismo: no sale
      const handle = nextHandle++;
      const meta = {};
      if (kind === 'completion') { meta.triggerCharacters = (provider.triggerCharacters || []).filter(c => typeof c === 'string').slice(0, 50); meta.resolve = typeof provider.resolveCompletionItem === 'function'; }
      if (kind === 'signature') { meta.triggerCharacters = (provider.signatureHelpTriggerCharacters || []).slice(0, 20); meta.retriggerCharacters = (provider.signatureHelpRetriggerCharacters || []).slice(0, 20); }
      if (kind === 'formatOnType') meta.triggerCharacters = (provider.autoFormatTriggerCharacters || []).slice(0, 20);
      if (kind === 'codeAction') { meta.kinds = (provider.providedCodeActionKinds || []).filter(k => typeof k === 'string').slice(0, 50); meta.resolve = typeof provider.resolveCodeAction === 'function'; }
      if (kind === 'rename') meta.resolve = typeof provider.resolveRenameLocation === 'function';
      if (typeof provider.displayName === 'string') meta.displayName = provider.displayName.slice(0, 200);
      if (provider.extensionId) meta.extension = str(provider.extensionId.value || provider.extensionId._lower || String(provider.extensionId), 200);
      providers.set(handle, { kind, provider });
      send({ t: 'providers.add', handle, kind, selector: selectorOf(selector), meta });
      return { dispose() { d.dispose(); if (providers.delete(handle)) send({ t: 'providers.remove', handle }); } };
    };
  }
  for (const name of LATER) {
    const reg = features[name];
    if (!reg || typeof reg.register !== 'function') continue;
    const orig = reg.register.bind(reg);
    reg.register = (selector, provider) => { if (fromExtHost) later.n++; return orig(selector, provider); };
  }

  // ── setContext: la clave se pone aquí y la página la refleja ──
  m.CommandsRegistry.registerCommand('setContext', (accessor, key, value) => {
    if (typeof key !== 'string') return;
    contextKeys.createKey(key, value);
    if (/^[\w.:-]{1,100}$/.test(key) && (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value))) send({ t: 'ctx.set', key, value: value === undefined ? null : value });
  });

  // ── extensiones ──
  const exts = new Map();                           // id → { reg, urls, state }
  const unsupported = new Set();
  m.CommandsRegistry.onDidRegisterCommand(id => {
    // sustituir el tecleo (Vim, Emacs…) no está soportado: se para esa extensión
    if (id === 'type' && fromExtHost) {
      log('warn', 'an extension registered the "type" command (it replaces typing): not supported');
      for (const [eid, e] of exts) if (e.state === 'active' || e.state === 'activating') unsupported.add(eid);
      for (const eid of unsupported) removeExt(eid, 'unsupported', 'replaces typing (the "type" command), which Elffuss Code does not support');
    }
  });

  const MIME = { js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', json: 'application/json', wasm: 'application/wasm', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', txt: 'text/plain', md: 'text/markdown' };
  async function addExt({ id, manifest, files }) {
    if (exts.has(id)) removeExt(id);
    const reg = m.registerExtension(manifest, m.ExtensionHostKind.LocalWebWorker);
    const urls = [];
    for (const [p, bytes] of files) {
      const type = MIME[String(p).split('.').pop().toLowerCase()] || 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      urls.push(url);
      reg.registerFileUrl('/' + p, url);
    }
    exts.set(id, { reg, urls, state: 'installed' });
    await reg.whenReady();
    status(id);
  }
  function removeExt(id, state = 'stopped', text = '') {
    const e = exts.get(id);
    if (!e) return;
    exts.delete(id);
    try { e.reg.dispose(); } catch { /* — */ }
    setTimeout(() => { for (const u of e.urls) URL.revokeObjectURL(u); }, 5000);
    send({ t: 'ext.status', id, state, text });
  }
  function status(id) {
    const e = exts.get(id);
    if (!e) return;
    const all = extensionService.getExtensionsStatus ? extensionService.getExtensionsStatus() : {};
    const key = Object.keys(all).find(k => k.toLowerCase() === id);
    const st = key ? all[key] : null;
    // no arrancó: el error de activación; arrancada: los errores que haya
    // tenido después solo se cuentan en el texto
    const failed = activationErrors.get(id);
    const errors = [...(failed ? [failed] : []), ...(st ? [...(st.runtimeErrors || []).map(errText), ...(st.messages || []).filter(x => x && x.type === 3).map(x => errText(x.message))] : [])];
    const state = failed ? 'error' : st && st.activationTimes ? 'active' : st && st.activationStarted ? 'activating' : 'installed';
    const text = errors.slice(0, 3).join(' · ').slice(0, 1000);
    if (state === e.state && text === (e.text || '')) return;
    e.state = state;
    e.text = text;
    send({ t: 'ext.status', id, state, text, providersLater: later.n, openRefused: openRefused.n });
  }
  if (extensionService.onDidChangeExtensionsStatus) extensionService.onDidChangeExtensionsStatus(ids => { for (const x of ids || []) status(String(x.value || x).toLowerCase()); });

  // ── documentos ──
  const docs = new Map();                           // uri → { model, pageV, pending, steps, applying }
  let applyingPage = false;
  function openDoc({ uri, lang, text, v }) {
    if (typeof text !== 'string' || text.length > MAX_DOC) return;
    const u = monaco.Uri.parse(uri);
    let d = docs.get(uri);
    if (d) { resetDoc({ uri, text, v }); return; }
    const language = knownLangs.has(lang) ? lang : 'plaintext';
    const model = monaco.editor.createModel(text, language, u);
    d = { model, pageV: v, pending: false, steps: [], timer: null };
    docs.set(uri, d);
    model.onDidChangeContent(e => {
      if (applyingPage) return;
      // cambio de una extensión (un comando que edita, p. ej.): se acumula y
      // se manda en el mismo turno, contra la última versión que la página conoce
      d.steps.push(e.changes.map(c => ({ range: [c.range.startLineNumber, c.range.startColumn, c.range.endLineNumber, c.range.endColumn], text: c.text })));
      if (!d.timer) d.timer = setTimeout(() => flushEdits(uri), 0);
    });
    try { extensionService.activateByEvent('onLanguage:' + language); } catch { /* — */ }
  }
  function flushEdits(uri) {
    const d = docs.get(uri);
    if (!d) return;
    d.timer = null;
    if (!d.steps.length) return;
    const steps = d.steps; d.steps = [];
    if (d.pending) return;                          // ya hay uno en vuelo: la página mandará reset
    d.pending = true;
    send({ t: 'doc.edit', uri, base: d.pageV, steps });
  }
  function applyPage(d, fn) {
    applyingPage = true;
    try { fn(); } finally { applyingPage = false; }
  }
  function resetDoc({ uri, text, v }) {
    const d = docs.get(uri);
    if (!d || typeof text !== 'string') return;
    applyPage(d, () => { if (d.model.getValue() !== text) d.model.setValue(text); });
    d.pageV = v; d.pending = false; d.steps = [];
    if (d.timer) { clearTimeout(d.timer); d.timer = null; }
  }
  function changeDoc({ uri, base, v, changes }) {
    const d = docs.get(uri);
    if (!d) return send({ t: 'doc.need', uri });
    if (d.pending) return;                          // esperando ack/reset de un cambio nuestro
    if (d.pageV !== base) return send({ t: 'doc.need', uri });
    const model = d.model;
    const edits = changes.map(c => {
      const s = model.getPositionAt(c.o), e = model.getPositionAt(c.o + c.l);
      return { range: new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column), text: c.t };
    });
    applyPage(d, () => model.applyEdits(edits));
    d.pageV = v;
  }
  function closeDoc({ uri }) {
    const d = docs.get(uri);
    if (!d) return;
    docs.delete(uri);
    if (mirror.getModel() === d.model) mirror.setModel(null);
    d.model.dispose();
  }
  function setActive({ uri, selections }) {
    const d = uri ? docs.get(uri) : null;
    const model = d ? d.model : null;
    if (mirror.getModel() !== model) mirror.setModel(model);
    if (model && Array.isArray(selections) && selections.length) {
      mirror.setSelections(selections.map(s => new monaco.Selection(s[0], s[1], s[2], s[3])));
    }
  }

  // ── diagnósticos de las extensiones → la página ──
  const ownersOf = new Map();                       // uri → Set(owner)
  markerService.onMarkerChanged(resources => {
    for (const r of resources) {
      const uri = r.toString();
      if (!docs.has(uri)) continue;
      const byOwner = new Map();
      for (const mk of markerService.read({ resource: r })) {
        if (String(mk.owner).startsWith('page:')) continue;
        if (!byOwner.has(mk.owner)) byOwner.set(mk.owner, []);
        byOwner.get(mk.owner).push({
          severity: mk.severity, message: str(mk.message, 4096) || '', source: str(mk.source, 200),
          code: typeof mk.code === 'string' || typeof mk.code === 'number' ? String(mk.code).slice(0, 200) : mk.code && typeof mk.code === 'object' ? String(mk.code.value).slice(0, 200) : undefined,
          range: [mk.startLineNumber, mk.startColumn, mk.endLineNumber, mk.endColumn],
          tags: Array.isArray(mk.tags) ? mk.tags.filter(x => x === 1 || x === 2) : undefined,
        });
      }
      const prev = ownersOf.get(uri) || new Set();
      for (const owner of new Set([...prev, ...byOwner.keys()])) {
        send({ t: 'markers', uri, owner: String(owner).slice(0, 200), markers: (byOwner.get(owner) || []).slice(0, 5000) });
      }
      ownersOf.set(uri, new Set(byOwner.keys()));
    }
  });

  // ── resultados de proveedores → datos planos ──
  const handles = new Map();                        // handle → objeto que se queda aquí (comandos, ítems)
  let nextObj = 1;
  const keep = obj => {
    const h = nextObj++;
    handles.set(h, obj);
    if (handles.size > MAX_HANDLES) handles.delete(handles.keys().next().value);
    return h;
  };
  const R = r => (r && typeof r === 'object' && 'startLineNumber' in r ? [r.startLineNumber, r.startColumn, r.endLineNumber, r.endColumn] : undefined);
  const md = v => (typeof v === 'string' ? { text: v.slice(0, 65536) } : v && typeof v.value === 'string' ? { md: v.value.slice(0, 65536) } : undefined);
  const cmd = c => (c && typeof c.id === 'string' ? { handle: keep(c), title: str(c.title, 500) || '' } : undefined);
  const edit = e => (e && R(e.range) && typeof e.text === 'string' ? { range: R(e.range), text: e.text } : null);
  const edits = list => (Array.isArray(list) ? list.map(edit).filter(Boolean).slice(0, 100000) : []);
  const link = l => (l && l.uri && R(l.range) ? { uri: l.uri.toString(), range: R(l.range), targetSelectionRange: R(l.targetSelectionRange), originSelectionRange: R(l.originSelectionRange) } : null);
  const locations = res => (res ? [].concat(res).map(link).filter(Boolean).slice(0, 10000) : []);
  function workspaceEdit(we) {
    if (!we) return undefined;
    const out = [];
    let other = 0;
    for (const e of we.edits || []) {
      if (e && e.resource && e.textEdit) { const te = edit(e.textEdit); if (te) out.push({ uri: e.resource.toString(), range: te.range, text: te.text }); }
      else other++;
    }
    return { edits: out.slice(0, 100000), fileOps: other, rejectReason: str(we.rejectReason, 1000) };
  }
  function symbol(s, depth = 0) {
    if (!s || depth > 20) return null;
    return {
      name: str(s.name, 1000) || '', detail: str(s.detail, 1000) || '', kind: num(s.kind) ?? 0, tags: Array.isArray(s.tags) ? s.tags.filter(x => x === 1) : [],
      range: R(s.range), selectionRange: R(s.selectionRange),
      children: Array.isArray(s.children) ? s.children.map(c => symbol(c, depth + 1)).filter(Boolean).slice(0, 10000) : [],
    };
  }
  function completionItem(it) {
    const label = typeof it.label === 'string' ? it.label : it.label && typeof it.label.label === 'string' ? { label: it.label.label, detail: str(it.label.detail, 1000), description: str(it.label.description, 1000) } : '';
    let range;
    if (R(it.range)) range = R(it.range);
    else if (it.range && R(it.range.insert) && R(it.range.replace)) range = { insert: R(it.range.insert), replace: R(it.range.replace) };
    return {
      h: keep(it), label, kind: num(it.kind) ?? 0, tags: Array.isArray(it.tags) ? it.tags.filter(x => x === 1) : undefined,
      detail: str(it.detail, 4096), documentation: md(it.documentation), sortText: str(it.sortText, 1000), filterText: str(it.filterText, 1000),
      preselect: it.preselect === true, insertText: typeof it.insertText === 'string' ? it.insertText.slice(0, 100000) : '', insertTextRules: num(it.insertTextRules) ?? 0,
      range, commitCharacters: Array.isArray(it.commitCharacters) ? it.commitCharacters.filter(c => typeof c === 'string').slice(0, 20) : undefined,
      additionalTextEdits: it.additionalTextEdits ? edits(it.additionalTextEdits) : undefined, command: cmd(it.command),
    };
  }
  function codeAction(a) {
    return {
      h: keep(a), title: str(a.title, 1000) || '', kind: str(a.kind, 200), isPreferred: a.isPreferred === true,
      disabled: str(a.disabled, 1000), edit: workspaceEdit(a.edit), command: cmd(a.command), isAI: a.isAI === true,
    };
  }

  const tokens = new Map();                         // req → CancellationTokenSource
  async function invoke({ req, kind, handle, uri, v, args = {} }) {
    const p = providers.get(handle);
    const d = docs.get(uri);
    if (!p || p.kind !== kind.split('.')[0]) return { stale: true };
    // resolver un ítem ya devuelto no depende de la versión (no hay posición)
    const anyVersion = kind === 'completion.resolve' || kind === 'codeAction.resolve';
    if (!d || (!anyVersion && (d.pageV !== v || d.pending))) return { stale: true };
    const model = d.model;
    const cts = new monaco.CancellationTokenSource();
    tokens.set(req, cts);
    const token = cts.token;
    const P = a => new monaco.Position(a[0], a[1]);
    const opts = { tabSize: num(args.options && args.options.tabSize) ?? 4, insertSpaces: !!(args.options && args.options.insertSpaces) };
    const pr = p.provider;
    try {
      switch (kind) {
        case 'format': return { edits: edits(await pr.provideDocumentFormattingEdits(model, opts, token)) };
        case 'formatRange': return { edits: edits(await pr.provideDocumentRangeFormattingEdits(model, monaco.Range.lift({ startLineNumber: args.range[0], startColumn: args.range[1], endLineNumber: args.range[2], endColumn: args.range[3] }), opts, token)) };
        case 'formatOnType': return { edits: edits(await pr.provideOnTypeFormattingEdits(model, P(args.position), String(args.ch || ''), opts, token)) };
        case 'hover': {
          const h = await pr.provideHover(model, P(args.position), token, {});
          return h ? { contents: (h.contents || []).map(md).filter(Boolean).slice(0, 50), range: R(h.range) } : null;
        }
        case 'completion': {
          const list = await pr.provideCompletionItems(model, P(args.position), { triggerKind: num(args.triggerKind) ?? 0, triggerCharacter: str(args.triggerCharacter, 10) }, token);
          if (!list) return null;
          const out = { incomplete: list.incomplete === true, suggestions: (list.suggestions || []).slice(0, 5000).map(completionItem) };
          try { list.dispose && list.dispose(); } catch { /* — */ }
          return out;
        }
        case 'completion.resolve': {
          const item = handles.get(args.item);
          if (!item || typeof pr.resolveCompletionItem !== 'function') return null;
          const r = await pr.resolveCompletionItem(item, token);
          return r ? completionItem(r) : null;
        }
        case 'signature': {
          const ctx = { triggerKind: num(args.triggerKind) ?? 1, triggerCharacter: str(args.triggerCharacter, 10), isRetrigger: args.isRetrigger === true };
          const r = await pr.provideSignatureHelp(model, P(args.position), token, ctx);
          if (!r || !r.value) return null;
          const s = r.value;
          const out = {
            activeSignature: num(s.activeSignature) ?? 0, activeParameter: num(s.activeParameter) ?? 0,
            signatures: (s.signatures || []).slice(0, 100).map(sig => ({
              label: str(sig.label, 4096) || '', documentation: md(sig.documentation), activeParameter: num(sig.activeParameter),
              parameters: (sig.parameters || []).slice(0, 100).map(pa => ({ label: Array.isArray(pa.label) ? [num(pa.label[0]) ?? 0, num(pa.label[1]) ?? 0] : str(pa.label, 1000) || '', documentation: md(pa.documentation) })),
            })),
          };
          try { r.dispose && r.dispose(); } catch { /* — */ }
          return out;
        }
        case 'codeAction': {
          const range = monaco.Range.lift({ startLineNumber: args.range[0], startColumn: args.range[1], endLineNumber: args.range[2], endColumn: args.range[3] });
          const r = await pr.provideCodeActions(model, range, { trigger: args.trigger === 2 ? 2 : 1, only: str(args.only, 200) }, token);
          if (!r) return null;
          const out = { actions: (r.actions || []).slice(0, 500).map(codeAction) };
          try { r.dispose && r.dispose(); } catch { /* — */ }
          return out;
        }
        case 'codeAction.resolve': {
          const a = handles.get(args.action);
          if (!a || typeof pr.resolveCodeAction !== 'function') return null;
          const r = await pr.resolveCodeAction(a, token);
          return r ? codeAction(r) : null;
        }
        case 'symbols': return { symbols: ((await pr.provideDocumentSymbols(model, token)) || []).slice(0, 10000).map(s => symbol(s)).filter(Boolean) };
        case 'definition': return { locations: locations(await pr.provideDefinition(model, P(args.position), token)) };
        case 'declaration': return { locations: locations(await pr.provideDeclaration(model, P(args.position), token)) };
        case 'typeDefinition': return { locations: locations(await pr.provideTypeDefinition(model, P(args.position), token)) };
        case 'implementation': return { locations: locations(await pr.provideImplementation(model, P(args.position), token)) };
        case 'references': return { locations: locations(await pr.provideReferences(model, P(args.position), { includeDeclaration: args.includeDeclaration !== false }, token)) };
        case 'highlights': return { highlights: ((await pr.provideDocumentHighlights(model, P(args.position), token)) || []).slice(0, 10000).map(h => ({ range: R(h.range), kind: num(h.kind) ?? 0 })).filter(h => h.range) };
        case 'rename': return workspaceEdit(await pr.provideRenameEdits(model, P(args.position), String(args.newName || '').slice(0, 1000), token)) || null;
        case 'rename.resolve': {
          if (typeof pr.resolveRenameLocation !== 'function') return null;
          const r = await pr.resolveRenameLocation(model, P(args.position), token);
          return r ? { range: R(r.range), text: str(r.text, 1000), rejectReason: str(r.rejectReason, 1000) } : null;
        }
        default: return { error: 'unknown kind ' + kind };
      }
    } finally {
      tokens.delete(req);
      cts.dispose();
    }
  }

  async function execCommand({ id, handle, uri, selections, v, args }) {
    if (uri) {
      const d = docs.get(uri);
      if (!d || d.pageV !== v || d.pending) return { stale: true };
      setActive({ uri, selections });
    }
    if (handle != null) {
      const c = handles.get(handle);
      if (!c) return { stale: true };
      return { value: plain(await commandService.executeCommand(c.id, ...(c.arguments || []))) };
    }
    return { value: plain(await commandService.executeCommand(String(id), ...(Array.isArray(args) ? args : []))) };
  }
  const plain = v => (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'number' ? v ?? null : typeof v === 'string' ? v.slice(0, 10000) : null);

  // superficie de la API, para la foto que vigilan las pruebas
  function surface() {
    const out = {};
    for (const [name, actor] of [...actors].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const methods = new Set();
      for (let o = actor; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
        for (const k of Object.getOwnPropertyNames(o)) {
          if (!k.startsWith('$') || methods.has(k) || methods.has(k + ' (unsupported)')) continue;
          // sin leer la propiedad: los métodos sin servicio son getters que lanzan
          const d = Object.getOwnPropertyDescriptor(o, k);
          if (d && typeof d.value === 'function') methods.add(k);
          else if (d && d.get) methods.add(k + ' (unsupported)');
        }
      }
      out[name] = [...methods].sort();
    }
    return {
      actors: out,
      commands: [...m.CommandsRegistry.getCommands().keys()].sort(),
      overridden: ['IClipboardService', 'IDialogService', 'IEditorService', 'IFileDialogService', 'ILanguageStatusService', 'INotificationService', 'IOpenerService'],
    };
  }

  // ── mensajes de la página ──
  port.onmessage = async ev => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    try {
      switch (msg.t) {
        case 'ext.add': await addExt(msg); break;
        case 'ext.remove': removeExt(msg.id); break;
        case 'settings': await m.updateUserConfiguration(typeof msg.json === 'string' ? msg.json : '{}'); break;
        case 'doc.open': openDoc(msg); break;
        case 'doc.change': changeDoc(msg); break;
        case 'doc.reset': resetDoc(msg); break;
        case 'doc.lang': { const d = docs.get(msg.uri); if (d && knownLangs.has(msg.lang)) { monaco.editor.setModelLanguage(d.model, msg.lang); try { extensionService.activateByEvent('onLanguage:' + msg.lang); } catch { /* — */ } } break; }
        case 'doc.close': closeDoc(msg); break;
        case 'doc.ack': { const d = docs.get(msg.uri); if (d) { d.pageV = msg.v; d.pending = false; if (d.steps.length && !d.timer) d.timer = setTimeout(() => flushEdits(msg.uri), 0); } break; }
        case 'editor.active': setActive(msg); break;
        case 'invoke': {
          let value, ok = true;
          try { value = await invoke(msg); } catch (e) { ok = false; value = errText(e); }
          send(ok ? { t: 'result', req: msg.req, ok: true, value } : { t: 'result', req: msg.req, ok: false, error: value });
          break;
        }
        case 'cancel': { const c = tokens.get(msg.req); if (c) c.cancel(); break; }
        case 'release': for (const h of msg.handles || []) handles.delete(h); break;
        case 'cmd.exec': {
          let value, ok = true;
          try { value = await execCommand(msg); } catch (e) { ok = false; value = errText(e); }
          send(ok ? { t: 'result', req: msg.req, ok: true, value } : { t: 'result', req: msg.req, ok: false, error: value });
          break;
        }
        case 'activate': try { await extensionService.activateByEvent(String(msg.event)); } catch (e) { log('warn', 'activation event failed: ' + errText(e)); } break;
        case 'surface': {
          let value, ok = true;
          try { value = surface(); } catch (e) { ok = false; value = errText(e); }
          send(ok ? { t: 'result', req: msg.req, ok: true, value } : { t: 'result', req: msg.req, ok: false, error: value });
          break;
        }
        case 'ping': send({ t: 'pong', n: msg.n, navBlocked: sandbox.navBlocked ? sandbox.navBlocked() : 0 }); break;
        default: log('warn', 'unknown message ' + msg.t.slice(0, 40));
      }
    } catch (e) {
      log('error', msg.t + ': ' + errText(e));
    }
  };

  send({ t: 'ready', protocol: PROTOCOL, vscode: '1.138.0' });
}

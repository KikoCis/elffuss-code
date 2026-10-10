// Pruebas en Node (sin navegador) de lo que no necesita Monaco: lectura del
// .vsix, JSONC/plist, colores, mapeo de temas, lenguajes y snippets.
//   node tests/ext_unit.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseJsonc, parsePlist, hex6, isHexColor, NOMBRES_PROTO } from '../web/js/ext/formats.js';
import { openZip, crc32 } from '../web/js/ext/unzip.js';
import { readVsix, analyzeManifest, resolveNls } from '../web/js/ext/vsix.js';
import { toMonacoTheme, toTextMateTheme, monarchRules, resolveScope, themeIdFor, chromeCss, builtinTheme, joinPath } from '../web/js/ext/themes.js';
import { toLanguageConfiguration, matchLanguage, globToRegExp, nestedRepetition, unsafeConfigRegexes, firstLineCandidates, matchFirstLine, FIRST_LINE_MAX } from '../web/js/ext/languages.js';
import { normalizeSnippets, replaceStart, registerSnippets } from '../web/js/ext/snippets.js';
import { sanitizeGrammar } from '../web/js/ext/grammars.js';
import { textoError, textoAviso } from '../web/js/ext/panel.js';
import { STRINGS } from '../web/js/ext/i18n.js';
import tm from '../web/js/ext/vendor/vscode-textmate@9.3.2/main.js';
import { zip, themeVsix, elfscriptVsix, THEME_DARK, ELFS, EVIL_GRAMMAR, brokenThemeVsix, noPublisherVsix, slowRegexVsix, SLOW } from './ext_fixtures.mjs';

let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const throws = async (fn, re) => { try { await fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };
const codigo = async fn => { try { await fn(); return null; } catch (e) { return e.code ?? 'sin código: ' + e.message; } };
// En otro proceso, con tiempo tope: lo que ahí se rompa (el prototipo de todos
// los objetos) no contamina estas pruebas, y una expresión sin fin no las cuelga.
function enOtroProceso(js, timeout = 20000) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', js], { encoding: 'utf8', timeout });
  return { out: (r.stdout || '').trim(), err: (r.stderr || '').trim().split('\n').slice(-2).join(' '), colgado: r.error?.code === 'ETIMEDOUT' };
}
const VENDOR = new URL('../web/js/ext/vendor/', import.meta.url);

// ── JSONC ──
{
  const j = parseJsonc('\uFEFF{ // c\n "a": "http://x//y", /* b */ "b": [1, 2, ], "c": {"d": "\\"/*no*/\\"",}, }');
  ok('JSONC: comentarios, comas finales y // dentro de cadenas', j.a === 'http://x//y' && j.b.length === 2 && j.c.d === '"/*no*/"', JSON.stringify(j));
  ok('JSONC: lo inválido sigue fallando', await throws(() => parseJsonc('{"a": 1,, "b": 2}')));
}

// ── plist ──
{
  const p = parsePlist(`<?xml version="1.0"?><!DOCTYPE plist><plist version="1.0"><dict>
    <key>s</key><string>a &lt;b&gt; &amp; &#x41;&#66;</string><key>n</key><integer>42</integer><key>r</key><real>1.5</real>
    <key>t</key><true/><key>f</key><false/><key>e</key><string/><key>arr</key><array><string>x</string><dict/><array/></array>
    <key>cd</key><string><![CDATA[<raw & stuff>]]></string></dict></plist>`);
  ok('plist: tipos, entidades y CDATA', p.s === 'a <b> & AB' && p.n === 42 && p.r === 1.5 && p.t === true && p.f === false && p.e === '' && p.arr.length === 3 && p.cd === '<raw & stuff>', JSON.stringify(p));
  ok('plist: roto → error', await throws(() => parsePlist('<plist><dict><key>a</key></dict></plist>')));
}

// ── colores ──
ok('hex6: #abc → #AABBCC', hex6('#abc') === '#AABBCC');
ok('hex6: alfa mezclado sobre el fondo', hex6('#ffffff80', '#000000') === '#808080', hex6('#ffffff80', '#000000'));
ok('hex6: alfa sin fondo se descarta', hex6('#12345678') === '#123456');
ok('colores no hex rechazados (url(), nombres, rgb())', !isHexColor('url(x)') && !isHexColor('red') && !isHexColor('rgb(1,2,3)') && hex6('#12') === null);

// ── zip ──
{
  const z = zip([['a.txt', 'hola'], ['b/c.json', '{"x":1}', { method: 0 }], ['big.txt', 'x'.repeat(5000)]]);
  const r = openZip(z, { maxEntry: 4000 });
  ok('zip: índice del directorio central', r.names.join(',') === 'a.txt,b/c.json,big.txt', r.names.join(','));
  ok('zip: deflate y stored', new TextDecoder().decode(await r.read('a.txt')) === 'hola' && new TextDecoder().decode(await r.read('b/c.json')) === '{"x":1}');
  ok('zip: tope por entrada', await throws(() => r.read('big.txt'), /pesa demasiado/));
  const bomba = zip([['bomb.txt', 'y'.repeat(100000), { declaredSize: 10 }]]);
  ok('zip: una entrada que infla más de lo que declara se corta', await throws(() => openZip(bomba).read('bomb.txt'), /demasiado grande/));
  ok('zip: lo que no es zip se rechaza', await throws(() => openZip(new Uint8Array(100)), /no es un zip/));
  ok('crc32 conocido', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
}

// ── .vsix de tema ──
const tema = await readVsix(themeVsix(), { lang: 'es' });
ok('vsix: id y nombre traducido (package.nls.es.json)', tema.id === 'elffuss-test.elf-theme' && tema.displayName === 'Tema Elfo' && tema.description === 'Synthetic test theme', `${tema.id} · ${tema.displayName} · ${tema.description}`);
ok('vsix: dos temas, etiqueta %clave% resuelta', tema.themes.length === 2 && tema.themes[0].label === 'Elfo Oscuro', tema.themes.map(t => t.label).join(' | '));
{
  const d = tema.themes[0].data;
  ok('tema: include encadenado (colores del base + propios)', d.colors['editorCursor.foreground'] === '#FFCC00' && d.colors['editor.background'] === THEME_DARK.bg);
  ok('tema: color con url() descartado', !('sideBar.background' in d.colors));
  ok('tema: reglas del base primero y luego las propias', d.tokenColors[0].scope.join() === 'keyword,storage.type' && d.tokenColors.at(-1).scope[0] === 'source.elfs keyword', d.tokenColors.map(r => r.scope?.join('+')).join(' | '));
  const l = tema.themes[1].data;
  ok('tema .tmTheme (plist): fondo/primer plano/cursor de la regla global', l.uiTheme === 'vs' && l.colors['editor.background'] === '#FAFAF0' && l.colors['editorCursor.foreground'] === '#FF0000');
}
ok('vsix: el JS del paquete no se lee nunca (main ignorado, la entrada es ilegible y no falla)', tema.analysis.hasCode === true && !tema.warnings.length, tema.warnings.join('; '));
ok('vsix: lo que no aplica, con motivo', tema.analysis.ignored.some(i => i.key === 'commands' && i.why === 'code') && tema.analysis.ignored.some(i => i.key === 'iconThemes' && i.why === 'later'));
ok('vsix: licencia leída del paquete', /MIT License/.test(tema.licenseText));

// ── mapeo del tema a Monaco ──
{
  const d = tema.themes[0].data;
  const m = toMonacoTheme(d);
  const regla = t => m.rules.find(r => r.token === t);
  ok('Monaco: base y herencia', m.base === 'vs-dark' && m.inherit === true);
  ok('Monaco: keyword ← keyword/storage.type', regla('keyword')?.foreground === THEME_DARK.keyword.slice(1), JSON.stringify(regla('keyword')));
  ok('Monaco: keyword.flow ← keyword.control (el selector más largo gana)', regla('keyword.flow')?.foreground === THEME_DARK.control.slice(1));
  ok('Monaco: comment con cursiva', regla('comment')?.foreground === THEME_DARK.comment.slice(1) && regla('comment')?.fontStyle === 'italic');
  ok('Monaco: string y number', regla('string')?.foreground === THEME_DARK.string.slice(1) && regla('number')?.foreground === THEME_DARK.number.slice(1));
  ok('Monaco: sin regla en el tema → color por defecto del tema, no el de serie', regla('tag')?.foreground === THEME_DARK.fg.slice(1), JSON.stringify(regla('tag')));
  ok('Monaco: los colores pasan tal cual (y el url() no)', m.colors['editor.background'] === THEME_DARK.bg && m.colors['tab.activeBackground'] === THEME_DARK.tabActive && !m.colors['sideBar.background']);
  ok('Monaco: los selectores con contexto no se usan para Monarch', !m.rules.some(r => r.foreground === '123456'));
  ok('resolveScope: keyword.control.flow → control; keyword.other → keyword', resolveScope(d.tokenColors, 'keyword.control.flow').foreground === THEME_DARK.control && resolveScope(d.tokenColors, 'keyword.other').foreground === THEME_DARK.keyword);
  const tm = toTextMateTheme(d);
  ok('TextMate: primera regla = colores por defecto del editor', tm.settings[0].settings.foreground === THEME_DARK.fg && tm.settings[0].settings.background === THEME_DARK.bg);
  ok('TextMate: todos los colores en #RRGGBB', tm.settings.every(s => Object.entries(s.settings).every(([k, v]) => k === 'fontStyle' || /^#[0-9A-F]{6}$/.test(v))));
  ok('TextMate: conserva los selectores con contexto (los resuelve vscode-textmate)', tm.settings.some(s => s.scope?.[0] === 'source.elfs keyword'));
  const lt = toMonacoTheme(tema.themes[1].data);
  ok('Monaco (tmTheme claro): base vs y keyword', lt.base === 'vs' && lt.rules.find(r => r.token === 'keyword')?.foreground === 'AA0000');
  const b = builtinTheme('vs');
  ok('temas de serie con colores TextMate (Light+)', b.uiTheme === 'vs' && toTextMateTheme(b).settings.some(s => s.scope?.includes('comment') && s.settings.foreground === '#008000'));
  const css = chromeCss(d);
  ok('CSS de pestañas solo con colores hex', css.includes(THEME_DARK.tabActive) && !/url\(|example/.test(css), css.split('\n')[0]);
  const usados = new Set();
  const id1 = themeIdFor('Elffuss-Test.Elf Theme', { id: 'Elf Dark (ñ)' }, 0, usados), id2 = themeIdFor('Elffuss-Test.Elf Theme', { id: 'Elf Dark (ñ)' }, 1, usados);
  ok('ids de tema válidos para Monaco y únicos', /^[a-z0-9-]+$/.test(id1) && id1 !== id2, `${id1} · ${id2}`);
  ok('monarchRules sin tokenColors no rompe', monarchRules({ uiTheme: 'vs', colors: {}, tokenColors: [] }).every(r => /^[0-9A-F]{6}$/.test(r.foreground || '000000')));
}

// ── .vsix de lenguaje + gramática + snippets ──
const elfs = await readVsix(elfscriptVsix());
ok('vsix lenguaje: contribuciones leídas', elfs.languages.length === 1 && elfs.grammars.length === 2 && elfs.snippets.length === 2, `${elfs.languages.length}/${elfs.grammars.length}/${elfs.snippets.length} ${elfs.warnings.join(';')}`);
ok('vsix lenguaje: gramática plist (.tmLanguage)', elfs.grammars[1].scopeName === 'source.elfs.rune' && elfs.grammars[1].data.patterns.length === 1 && !elfs.grammars[1].language);
ok('vsix lenguaje: tokenTypes y licencia «SEE LICENSE IN»', elfs.grammars[0].tokenTypes['string.quoted.single.elfs'] === 'other' && /public domain/.test(elfs.licenseText));
ok('vsix lenguaje: configurationDefaults no se aplica', elfs.analysis.ignored.some(i => i.key === 'configurationDefaults' && i.why === 'later'));
{
  const IA = { None: 0, Indent: 1, IndentOutdent: 2, Outdent: 3 };
  const conf = toLanguageConfiguration(elfs.languages[0].config, { languages: { IndentAction: IA } });
  ok('config: comentarios, corchetes y pares', conf.comments.lineComment === '#' && conf.comments.blockComment[0] === '#[' && conf.brackets.length === 3 && conf.autoClosingPairs.length === 3 && conf.autoClosingPairs[2].notIn[0] === 'string');
  ok('config: expresiones → RegExp', conf.wordPattern instanceof RegExp && conf.wordPattern.test('elf-name') && conf.indentationRules.increaseIndentPattern.test('  spell x'));
  ok('config: onEnterRules con IndentAction y la regla con regex inválida fuera', conf.onEnterRules.length === 1 && conf.onEnterRules[0].action.indentAction === IA.Indent);
  ok('config: folding markers', conf.folding.markers.start.test('#region a'));
}
{
  const c = [{ id: 'a', extensions: ['.mk'], filenames: ['Makefile'] }, ...elfs.languages];
  ok('lenguaje por nombre exacto', matchLanguage(c, 'src/Elffile') === ELFS.lang && matchLanguage(c, 'Makefile') === 'a');
  ok('lenguaje por extensión (sin distinguir mayúsculas)', matchLanguage(c, 'x/Y.ELFS') === ELFS.lang && matchLanguage(c, 'a.mk') === 'a');
  const fl = firstLineCandidates(c);
  ok('lenguaje por patrón y por primera línea', matchLanguage(c, 'book/spells/fire.spell') === ELFS.lang && matchFirstLine(fl, '#!/usr/bin/env elfs') === ELFS.lang && matchFirstLine(fl, '#!/bin/sh') === null && matchLanguage(c, 'run') === null);
  ok('glob: **, * y {a,b}', globToRegExp('**/*.{js,ts}').test('a/b/c.ts') && !globToRegExp('*.js').test('a/b.js'));
}
{
  const s = elfs.snippets[0].data;
  ok('snippets: varios prefijos, cuerpo en líneas, grupo anidado, sin prefijo fuera', s.length === 3 && s[0].body === 'spell ${1:name}\n\tcast ${2:fire}\nend' && s.some(x => x.prefix === '#rune'), s.map(x => x.prefix).join(','));
  ok('snippets: rango sobre lo ya escrito (#ru → #rune)', replaceStart('  #ru', '#rune', 4) === 3 && replaceStart('x.elfl', 'elflog', 3) === 3 && replaceStart('foo', 'bar', 1) === 1);
  ok('snippets: normalize tolera basura', normalizeSnippets(null).length === 0 && normalizeSnippets({ a: 1, b: { c: 'x' } }).length === 0);
}

// ── utilidades ──
ok('joinPath no sale de la raíz', joinPath('extension/themes', './a/../b.json') === 'extension/themes/b.json' && await throws(() => joinPath('', '../x')));
ok('resolveNls: %clave% y {message}', resolveNls({ a: '%k%', b: ['%m%'], c: '%no%' }, { k: 'K', m: { message: 'M' } }).b[0] === 'M');
ok('analyzeManifest de un paquete solo con código', (() => { const a = analyzeManifest({ main: 'x.js', contributes: { commands: [{}] } }); return a.hasCode && !a.any; })());

// ── el motor TextMate va en el repo, sin cambios (y el de jsDelivr no) ──
{
  // los valores son los del paquete npm (integridad del registro comprobada)
  const esperado = { 'vscode-textmate@9.3.2': [61242, 'sha384-aJzUwh8/jeVrg5exYESASC3qwtfGKKHUgNPuT5uEM0bmJvnwLbJhuy+//+fZ+tPJ'],
    'vscode-oniguruma@2.0.1': [20469, 'sha384-KznAEs+/b3fCQKg6wXrLJQvj0dOjyZQpdCrIpt7hC03S7EovcZMXlHRHRN291Uaj'] };
  for (const [dir, [bytes, sri]] of Object.entries(esperado)) {
    const buf = readFileSync(new URL(dir + '/main.js', VENDOR));
    const l1 = buf.indexOf(10), l2 = buf.indexOf(10, l1 + 1);
    const cabecera = buf.subarray(0, l1).toString();
    const original = buf.subarray(l2 + 1, l2 + 1 + bytes);
    const hash = 'sha384-' + createHash('sha384').update(original).digest('base64');
    ok(`vendor ${dir}: el original intacto dentro del envoltorio`, hash === sri && cabecera.includes(`${bytes} bytes, ${sri}`)
      && buf.subarray(l1 + 1, l2).toString() === 'const module = { exports: {} }, exports = module.exports;'
      && buf.subarray(l2 + 1 + bytes).toString() === '\nexport default module.exports;\n', hash);
  }
  ok('vendor: el motor se importa como módulo ES', typeof tm.Registry === 'function' && typeof tm.INITIAL === 'object');
  const src = readFileSync(new URL('../web/js/ext/grammars.js', import.meta.url), 'utf8');
  ok('grammars.js no carga código de +esm ni de otro origen (solo onig.wasm, con SRI)', !/\+esm/.test(src) && !/import\(\s*['"`]https?:/.test(src) && /WASM_SRI = 'sha384-/.test(src));
}

// ── gramáticas: nada de salir del repositorio por Object.prototype ──
{
  const hostil = JSON.parse(EVIL_GRAMMAR);
  const limpia = sanitizeGrammar(hostil);
  const includes = [], claves = [];
  (function recorre(v) {
    if (Array.isArray(v)) return v.forEach(recorre);
    if (!v || typeof v !== 'object') return;
    for (const k of Object.keys(v)) { claves.push(k); if (k === 'include') includes.push(v[k]); recorre(v[k]); }
  })(limpia);
  const sinProto = inc => { const i = inc.indexOf('#'); return !NOMBRES_PROTO.has(i < 0 ? inc : inc.slice(i + 1)) && (i <= 0 || !NOMBRES_PROTO.has(inc.slice(0, i))); };
  ok('gramática: ningún include apunta a un nombre de Object.prototype', includes.length > 0 && includes.every(sinProto), includes.join(' '));
  ok('gramática: los include a una gramática llamada como Object.prototype, fuera', !includes.includes('hasOwnProperty') && !includes.some(i => i.startsWith('__proto__#')));
  ok('gramática: «constructor» legítimo renombrado a la vez en repository y en su include', '$elffuss-safe:constructor' in limpia.repository && includes.includes('#$elffuss-safe:constructor') && !Object.hasOwn(limpia.repository, 'constructor'));
  ok('gramática: sin claves «__proto__» ni «id» (la marca del motor)', !claves.includes('__proto__') && !claves.includes('id'), claves.filter(k => k === '__proto__' || k === 'id').join());
  const elfs = JSON.parse(new TextDecoder().decode(await openZip(elfscriptVsix()).read('extension/syntaxes/elfs.tmLanguage.json')));
  ok('gramática legítima: sale igual que entra', JSON.stringify(sanitizeGrammar(elfs)) === JSON.stringify(elfs));
  ok('vsix: la gramática se guarda ya saneada', (await readVsix(elfscriptVsix())).grammars.every(g => JSON.stringify(g.data) === JSON.stringify(sanitizeGrammar(g.data))));

  // con el motor de verdad, en otro proceso (Oniguruma de mentira: la escritura
  // en el prototipo ocurre al compilar las reglas, antes de buscar nada)
  const prueba = g => `
    const tm = (await import(${JSON.stringify(new URL('vscode-textmate@9.3.2/main.js', VENDOR).href)})).default;
    const g0 = ${g};
    const onigLib = Promise.resolve({ createOnigScanner() { throw new Error('stub'); }, createOnigString: s => ({ content: s, dispose() {} }) });
    const reg = new tm.Registry({ onigLib, loadGrammar: async s => (s === g0.scopeName ? g0 : null) });
    const gr = await reg.loadGrammar(g0.scopeName);
    try { gr.tokenizeLine('evil ctor (x)', tm.INITIAL); } catch {}
    console.log(JSON.stringify({ proto: ({}).id ?? null, object: Object.id ?? null, toStr: Object.prototype.toString.id ?? null, valueOf: Object.prototype.valueOf.id ?? null, propia: Object.prototype.hasOwnProperty('id') }));`;
  const antes = enOtroProceso(prueba(EVIL_GRAMMAR));
  ok('motor real SIN sanear: la gramática hostil escribe en Object.prototype (la prueba lo detecta)', /"proto":\d+/.test(antes.out) && /"propia":true/.test(antes.out), antes.out || antes.err);
  const despues = enOtroProceso(prueba(JSON.stringify(limpia)));
  ok('motor real con la gramática saneada: Object.prototype, Object y sus métodos intactos', despues.out === '{"proto":null,"object":null,"toStr":null,"valueOf":null,"propia":false}', despues.out || despues.err);
}

// ── temas: un ámbito «hasOwnProperty» tumbaba el árbol de temas del motor ──
{
  const tema = { uiTheme: 'vs-dark', colors: {}, tokenColors: [
    { scope: ['hasOwnProperty'], settings: { foreground: '#123123' } },
    { scope: ['__proto__.x', 'keyword.control'], settings: { foreground: '#DD2200' } },
    { scope: ['entity.name.function.constructor'], settings: { foreground: '#22AA44' } },
  ] };
  const reg = new tm.Registry({ onigLib: Promise.resolve({}), loadGrammar: async () => null });
  let crudo = null;
  try { reg.setTheme({ settings: [{ settings: { foreground: '#111111', background: '#EEEEEE' } }, ...tema.tokenColors] }); } catch (e) { crudo = e.message; }
  ok('motor real: el ámbito «hasOwnProperty» tal cual revienta setTheme (la prueba lo detecta)', /hasOwnProperty is not a function/.test(crudo || ''), crudo);
  const tmTema = toTextMateTheme(tema);
  let limpio = null;
  try { reg.setTheme(tmTema); } catch (e) { limpio = e.message; }
  ok('toTextMateTheme: fuera los selectores peligrosos, el resto se queda (constructor incluido)', limpio === null
    && tmTema.settings.some(s => s.scope?.join() === 'keyword.control') && tmTema.settings.some(s => s.scope?.[0] === 'entity.name.function.constructor')
    && !tmTema.settings.some(s => s.scope?.some(x => /hasOwnProperty|__proto__/.test(x))), limpio);
}

// ── plist y traducciones no cambian el prototipo de nada ──
{
  const p = parsePlist('<plist><dict><key>__proto__</key><dict><key>polluted</key><true/></dict><key>a</key><string>b</string></dict></plist>');
  ok('plist: una clave «__proto__» no cambia el prototipo', Object.getPrototypeOf(p) === Object.prototype && p.polluted === undefined && p.a === 'b');
  const r = resolveNls(JSON.parse('{"__proto__": {"contributes": {"themes": [1]}}, "a": "%k%"}'), { k: 'K' });
  ok('resolveNls: tampoco', Object.getPrototypeOf(r) === Object.prototype && r.contributes === undefined && r.a === 'K');
  ok('analyzeManifest: contribuciones que no son listas no lo rompen', analyzeManifest({ contributes: { snippets: {}, grammars: 'x', languages: null } }).any === false);
}

// ── snippets: el detalle es texto, nunca Markdown (imágenes = peticiones) ──
{
  let proveedor = null;
  const monacoFalso = { Range: class { constructor(...a) { this.a = a; } }, languages: {
    CompletionItemKind: { Snippet: 27 }, CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
    registerCompletionItemProvider: (l, p) => { proveedor = p; return { dispose() {} }; } } };
  registerSnippets(monacoFalso, 'javascript', async () => [{ prefix: 'zz', name: 'n', description: '![d](http://x.invalid/d.png)', body: 'a\n```\n![b](http://x.invalid/b.png)\n```' }], () => 'Ext');
  const { suggestions: [s] } = await proveedor.provideCompletionItems({ getLineContent: () => 'zz', getWordUntilPosition: () => ({ startColumn: 1 }) }, { lineNumber: 1, column: 3 });
  ok('snippets: detail y documentation son strings (Monaco los pinta como texto, no Markdown)', s.documentation === 'a\n```\n![b](http://x.invalid/b.png)\n```' && s.detail === '![d](http://x.invalid/d.png) (Ext)', JSON.stringify([s.detail, s.documentation]));
}

// ── expresiones de los paquetes: nada de repetición anidada ──
{
  const malas = ['^(a+)+$', '(a*)*', '(\\w+\\s?)*$', '(x|y+){2,}', '(?:a+){3}', '((a)+)*', '(?<n>b+)+', '(a{1,3})+'];
  const buenas = ['^(\\t|[ ])*[ ]\\*[^/]*\\*/\\s*$', '^(\\t|[ ])*[ ]\\*([ ]([^\\*]|\\*(?!/))*)?$', '^\\s*/\\*\\*(?!/)([^\\*]|\\*(?!/))*$',
    '^((.*=>\\s*)|((.*[^\\w]+|\\s*)(if|while|for)\\s*\\(.*\\)\\s*))$', '(-?\\d*\\.\\d\\w*)|([^\\`\\~\\!\\@\\#\\%\\^\\&\\*\\(\\)\\-\\=\\+\\[\\{\\]\\}\\\\\\|\\;\\:\\\'\\"\\,\\.\\<\\>\\/\\?\\s]+)',
    '[a+]+', '\\(a+\\)+', '(\\d{1,3}\\.)', '^#!.*\\b(bash|zsh|sh)\\b.*|^#\\s*-\\*-[^*]*mode:\\s*shell-script[^*]*-\\*-', '(a+)?b', '(?=a+)'];
  ok('repetición anidada: detectada', malas.every(nestedRepetition), malas.filter(x => !nestedRepetition(x)).join(' '));
  ok('repetición anidada: las de VS Code y las simples pasan', !buenas.some(nestedRepetition), buenas.filter(nestedRepetition).join(' '));
  const conf = toLanguageConfiguration({ wordPattern: '(a+)+$', folding: { markers: { start: '^(#+)+region', end: '#end' } }, onEnterRules: [{ beforeText: '(x*)*y', action: { indent: 'indent' } }, { beforeText: '^\\s*x', action: { indent: 'indent' } }] }, { languages: { IndentAction: { None: 0, Indent: 1 } } });
  ok('config: las peligrosas se descartan, las demás se quedan', !conf.wordPattern && !conf.folding.markers && conf.onEnterRules.length === 1, JSON.stringify(Object.keys(conf)));
  ok('config: se pueden listar para avisar', unsafeConfigRegexes({ wordPattern: '(a+)+$', onEnterRules: [{ beforeText: { pattern: '(x*)*y' } }] }).join(' ') === '(a+)+$ (x*)*y');
  const fl = firstLineCandidates([{ id: 'a', firstLine: 'elfs' }, { id: 'b', firstLine: '^(a+)+$' }, { id: 'c', firstLine: '(' }]);
  ok('firstLine: anclada al principio, sin las anidadas ni las inválidas', fl.length === 1 && fl[0].src === '^elfs' && matchFirstLine(fl, 'x elfs') === null && matchFirstLine(fl, 'elfs x') === 'a');
  ok('firstLine: solo se miran los primeros ' + FIRST_LINE_MAX + ' caracteres', matchFirstLine([{ id: 'z', src: '^a{' + (FIRST_LINE_MAX + 1) + '}' }], 'a'.repeat(FIRST_LINE_MAX + 50)) === null && matchFirstLine([{ id: 'z', src: '^a{' + FIRST_LINE_MAX + '}' }], 'a'.repeat(FIRST_LINE_MAX + 50)) === 'z');
  // el caso de la revisión: antes no terminaba nunca
  const lang = JSON.stringify(new URL('../web/js/ext/languages.js', import.meta.url).href);
  const r = enOtroProceso(`const L = await import(${lang}); const c = [{ id: 'evil', extensions: ['.evil'], firstLine: '^(a+)+$' }];
    console.log(String(L.matchLanguage(c, 'src/main.js', 'a'.repeat(40) + '!')), String(L.matchFirstLine(L.firstLineCandidates(c), 'a'.repeat(40) + '!')));`, 10000);
  ok('firstLine ^(a+)+$ con «aaaa…!»: termina (null null)', !r.colgado && r.out === 'null null', r.colgado ? 'COLGADO' : r.out || r.err);
  const v = await readVsix(slowRegexVsix());
  const regex = v.warnings.filter(w => w.kind === 'regex').map(w => w.detail);
  ok('vsix: firstLine y wordPattern anidados descartados con aviso; la otra firstLine se queda (la para el Worker)', regex.includes('^(a+)+$') && regex.includes('(a+)+$') && v.languages.find(l => l.id === SLOW.nest).firstLine === undefined && v.languages.find(l => l.id === SLOW.lang).firstLine === SLOW.firstLine, JSON.stringify(regex));
}

// ── partes rotas, errores con código y textos en los dos idiomas ──
{
  const medio = await readVsix(brokenThemeVsix());
  ok('vsix: el tema roto no tumba el bueno y queda su aviso (tipo, nombre y motivo)', medio.themes.length === 1 && medio.warnings.length === 1 && medio.warnings[0].kind === 'theme' && medio.warnings[0].name === 'Broken One' && medio.warnings[0].code === 'json', JSON.stringify(medio.warnings));
  ok('aviso legible: «Theme “Broken One”: not valid JSON (…)»', /^Theme “Broken One”: not valid JSON \(.+\)$/.test(textoAviso(medio.warnings[0])), textoAviso(medio.warnings[0]));
  const roto = await readVsix(brokenThemeVsix({ onlyBroken: true }));
  ok('vsix: si todas fallan, ningún tema y un aviso por cada una (JSON roto, fichero que falta)', roto.themes.length === 0 && roto.warnings.map(w => w.code).join() === 'json,missing', JSON.stringify(roto.warnings));
  ok('aviso legible de un fichero que falta', textoAviso(roto.warnings[1]) === 'Theme “Missing One”: the file is not in the package', textoAviso(roto.warnings[1]));
  ok('aviso de la versión anterior (texto suelto): se enseña tal cual', textoAviso('tema x: roto') === 'tema x: roto');
  ok('package.json sin publisher → código noname', await codigo(() => readVsix(noPublisherVsix())) === 'noname');
  const malo = zip([['extension/package.json', '{ "name": "x", ']]);
  ok('package.json que no es JSON → código badmanifest', await codigo(() => readVsix(malo)) === 'badmanifest');
  const dañado = themeVsix();
  const i = new TextDecoder('latin1').decode(dañado).indexOf('extension/package.json') + 'extension/package.json'.length;
  dañado[i + 5] ^= 0xff;                     // un byte de los datos comprimidos del package.json
  ok('zip dañado → código corrupt (con la entrada)', await codigo(() => readVsix(dañado)) === 'corrupt');
  const errores = [{ code: 'noname' }, { code: 'badmanifest', message: 'Unexpected end of JSON input' }, { code: 'notfound' }, { code: 'http', status: 503 },
    { code: 'big', mb: 130 }, { code: 'mismatch', got: 'a.b', want: 'c.d' }, { code: 'corrupt', entry: 'extension/x.json' }, { code: 'missing' },
    { code: 'unreadable', warning: roto.warnings[0] }, { code: 'blocked' }, { name: 'QuotaExceededError' }, { code: 'rate' }, { code: 'sha' },
    { code: 'nothing' }, { code: 'notvsix' }, { code: 'cancel' }];
  const textos = errores.map(textoError);
  const español = /\b(sin|respondió|demasiado|paquete|versión|incorrecto|soportad|fichero|está|dice ser)\b/i;
  ok('errores: todos con su texto en inglés, ninguno en español ni con «Could not do it»', textos.every(t => t && !español.test(t) && !/Could not do it/.test(t)), textos.filter(t => español.test(t) || /Could not do it/.test(t)).join(' | '));
  ok('errores: el detalle útil se conserva (estado HTTP, entrada, ids)', textos[3].includes('503') && textos[6].includes('extension/x.json') && textos[5].includes('a.b') && textos[5].includes('c.d'), textos.slice(3, 7).join(' | '));
  const faltan = l => Object.keys(STRINGS.en).filter(k => !(k in STRINGS[l])).concat(Object.keys(STRINGS[l]).filter(k => !(k in STRINGS.en)));
  ok('textos del panel: ES y EN con las mismas claves', !faltan('es').length, faltan('es').join(' '));
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ EXTENSIONES (Node): vsix, formatos, temas, lenguajes y snippets OK');
process.exit(fails ? 1 : 0);

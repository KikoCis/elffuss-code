// Pruebas en Node (sin navegador) de lo que no necesita Monaco: lectura del
// .vsix, JSONC/plist, colores, mapeo de temas, lenguajes y snippets.
//   node tests/ext_unit.mjs
import { parseJsonc, parsePlist, hex6, isHexColor } from '../web/js/ext/formats.js';
import { openZip, crc32 } from '../web/js/ext/unzip.js';
import { readVsix, analyzeManifest, resolveNls } from '../web/js/ext/vsix.js';
import { toMonacoTheme, toTextMateTheme, monarchRules, resolveScope, themeIdFor, chromeCss, builtinTheme, joinPath } from '../web/js/ext/themes.js';
import { toLanguageConfiguration, matchLanguage, globToRegExp } from '../web/js/ext/languages.js';
import { normalizeSnippets, replaceStart } from '../web/js/ext/snippets.js';
import { zip, themeVsix, elfscriptVsix, THEME_DARK, ELFS } from './ext_fixtures.mjs';

let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const throws = async (fn, re) => { try { await fn(); return false; } catch (e) { return re ? re.test(e.message) : true; } };

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
  ok('lenguaje por patrón y por primera línea', matchLanguage(c, 'book/spells/fire.spell') === ELFS.lang && matchLanguage(c, 'run', '#!/usr/bin/env elfs') === ELFS.lang && matchLanguage(c, 'run', '#!/bin/sh') === null);
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

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ EXTENSIONES (Node): vsix, formatos, temas, lenguajes y snippets OK');
process.exit(fails ? 1 : 0);

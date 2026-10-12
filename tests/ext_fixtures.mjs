// Extensiones de VS Code SINTÉTICAS para las pruebas: se construyen aquí, en
// memoria, sin red ni licencias de terceros. Un .vsix es un zip con
// extension/package.json y los ficheros que citan sus contribuciones.
import zlib from 'node:zlib';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// files: [[nombre, contenido, { method }]] — method 8 (deflate, por defecto),
// 0 (sin comprimir) o cualquier otro número para fabricar una entrada ilegible.
export function zip(files) {
  const locales = [], centrales = [];
  let off = 0;
  for (const [name, content, opts = {}] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const method = opts.method ?? 8;
    const comp = method === 8 ? zlib.deflateRawSync(data) : data;
    const nb = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nb.length, 26); lh.writeUInt16LE(0, 28);
    locales.push(lh, nb, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(opts.declaredSize ?? data.length, 24);
    ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    centrales.push(ch, nb);
    off += 30 + nb.length + comp.length;
  }
  const cd = Buffer.concat(centrales);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locales, cd, eocd]));
}

const ENVOLTORIO = [
  ['extension.vsixmanifest', '<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0"/>'],
  ['[Content_Types].xml', '<?xml version="1.0" encoding="utf-8"?><Types/>'],
];

// ── tema: JSONC con comentarios y comas finales, include encadenado, un color
// malicioso que no debe pasar, y un segundo tema en .tmTheme (plist).
export const THEME_DARK = { bg: '#102030', fg: '#E0E0E0', keyword: '#CC66FF', control: '#FF0055', comment: '#00AA44', string: '#FFAA00', number: '#33CCFF', tabActive: '#203040' };
export function themeVsix() {
  const pkg = {
    name: 'elf-theme', publisher: 'elffuss-test', version: '1.0.0', displayName: '%displayName%', description: '%description%',
    license: 'MIT', engines: { vscode: '^1.80.0' }, categories: ['Themes'],
    main: './out/extension.js',                            // código: NO se ejecuta nunca
    contributes: {
      themes: [
        { id: 'Elf Dark', label: '%darkLabel%', uiTheme: 'vs-dark', path: './themes/elf-dark.json' },
        { label: 'Elf Light (tmTheme)', uiTheme: 'vs', path: './themes/elf-light.tmTheme' },
      ],
      commands: [{ command: 'elf.hello', title: 'Hola' }],
      iconThemes: [{ id: 'elf-icons', label: 'Elf icons', path: './icons.json' }],
    },
  };
  const base = `{
    // base que incluye el tema oscuro
    "colors": { "editorCursor.foreground": "#FFCC00", "editor.background": "#000000" },
    "tokenColors": [
      { "scope": "keyword, storage.type", "settings": { "foreground": "${THEME_DARK.keyword}" } },
      { "scope": "string", "settings": { "foreground": "${THEME_DARK.string}" } },
      { "scope": "constant.numeric", "settings": { "foreground": "${THEME_DARK.number}" } },
    ],
  }`;
  const dark = `{
    "$schema": "vscode://schemas/color-theme", // comentario con "comillas" y // barras
    "name": "Elf Dark",
    "include": "./base.json",
    /* bloque
       de comentario */
    "colors": {
      "editor.background": "${THEME_DARK.bg}",
      "editor.foreground": "${THEME_DARK.fg}",
      "tab.activeBackground": "${THEME_DARK.tabActive}",
      "editor.lineHighlightBackground": "#ffffff10",
      "sideBar.background": "url(https://example.invalid/track.png)",
    },
    "tokenColors": [
      { "scope": "keyword.control", "settings": { "foreground": "${THEME_DARK.control}" } },
      { "scope": ["comment"], "settings": { "foreground": "${THEME_DARK.comment}", "fontStyle": "italic" } },
      { "scope": "source.elfs keyword", "settings": { "foreground": "#123456" } },
    ],
  }`;
  const light = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>name</key><string>Elf &amp; Light</string>
  <key>settings</key>
  <array>
    <dict><key>settings</key><dict>
      <key>background</key><string>#FAFAF0</string>
      <key>foreground</key><string>#202020</string>
      <key>caret</key><string>#FF0000</string>
    </dict></dict>
    <!-- comentario -->
    <dict><key>name</key><string>Comment</string><key>scope</key><string>comment</string>
      <key>settings</key><dict><key>foreground</key><string>#808080</string><key>fontStyle</key><string>italic</string></dict></dict>
    <dict><key>scope</key><string>keyword, storage</string>
      <key>settings</key><dict><key>foreground</key><string>#AA0000</string></dict></dict>
  </array>
  <key>uuid</key><string><![CDATA[1234-<cdata>]]></string>
  <key>count</key><integer>3</integer>
  <key>flag</key><true/>
</dict></plist>`;
  return zip([
    ...ENVOLTORIO,
    ['extension/package.json', JSON.stringify(pkg, null, 2)],
    ['extension/package.nls.json', JSON.stringify({ displayName: 'Elf Theme', description: 'Synthetic test theme', darkLabel: 'Elf Dark' })],
    ['extension/package.nls.es.json', JSON.stringify({ displayName: 'Tema Elfo', darkLabel: 'Elfo Oscuro' })],
    ['extension/LICENSE.txt', 'MIT License — test fixture'],
    ['extension/themes/base.json', base],
    ['extension/themes/elf-dark.json', dark],
    ['extension/themes/elf-light.tmTheme', light],
    ['extension/icons.json', '{}'],
    // si alguien intentara leer el JS, esta entrada lanza (compresión 99)
    ['extension/out/extension.js', 'throw new Error("must never run")', { method: 99 }],
  ]);
}

// ── lenguaje nuevo + gramática + configuración + snippets (también para JS)
export const ELFS = { lang: 'elfscript', ext: '.elfs', scope: 'source.elfs' };
export function elfscriptVsix({ version = '1.0.0' } = {}) {
  const pkg = {
    name: 'elfscript', publisher: 'elffuss-test', version, displayName: 'ElfScript', description: 'Synthetic language for tests',
    license: 'SEE LICENSE IN NOTICE.md', engines: { vscode: '^1.80.0' }, categories: ['Programming Languages', 'Snippets'],
    contributes: {
      languages: [{ id: ELFS.lang, aliases: ['ElfScript', 'elfs'], extensions: [ELFS.ext], filenames: ['Elffile'], filenamePatterns: ['**/spells/*.spell'], firstLine: '^#!.*\\belfs\\b', configuration: './language-configuration.json' }],
      grammars: [
        { language: ELFS.lang, scopeName: ELFS.scope, path: './syntaxes/elfs.tmLanguage.json', tokenTypes: { 'string.quoted.single.elfs': 'other' } },
        { scopeName: 'source.elfs.rune', path: './syntaxes/rune.tmLanguage' },
      ],
      snippets: [
        { language: ELFS.lang, path: './snippets/elfs.code-snippets' },
        { language: 'javascript', path: './snippets/js.json' },
      ],
      configurationDefaults: { '[elfscript]': { 'editor.tabSize': 2 } },
    },
  };
  const grammar = {
    name: 'ElfScript', scopeName: ELFS.scope,
    patterns: [
      { include: '#comment' }, { include: '#keywords' }, { include: '#strings' }, { include: '#numbers' }, { include: 'source.elfs.rune' },
    ],
    repository: {
      comment: { match: '#.*$', name: 'comment.line.number-sign.elfs' },
      keywords: { patterns: [{ match: '\\b(spell|cast|end)\\b', name: 'keyword.control.elfs' }, { match: '\\bwith\\b', name: 'keyword.other.elfs' }] },
      strings: { begin: '"', end: '"', name: 'string.quoted.double.elfs' },
      numbers: { match: '\\b[0-9]+\\b', name: 'constant.numeric.elfs' },
    },
  };
  const rune = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>scopeName</key><string>source.elfs.rune</string>
  <key>patterns</key><array>
    <dict><key>match</key><string>\\bᚱ\\w*</string><key>name</key><string>storage.type.rune.elfs</string></dict>
  </array>
</dict></plist>`;
  const config = `{
    "comments": { "lineComment": "#", "blockComment": ["#[", "]#"] },
    "brackets": [["{", "}"], ["[", "]"], ["(", ")"]],
    "autoClosingPairs": [["{", "}"], ["[", "]"], { "open": "\\"", "close": "\\"", "notIn": ["string", "comment"] }],
    "surroundingPairs": [["(", ")"], ["\\"", "\\""]],
    "wordPattern": "[A-Za-z_][\\\\w-]*",
    "indentationRules": { "increaseIndentPattern": "^\\\\s*spell\\\\b.*$", "decreaseIndentPattern": "^\\\\s*end\\\\b" },
    "onEnterRules": [{ "beforeText": "^\\\\s*spell\\\\b.*$", "action": { "indent": "indent" } }, { "beforeText": "(", "action": { "indent": "indent" } }],
    "folding": { "markers": { "start": "^\\\\s*#region\\\\b", "end": "^\\\\s*#endregion\\\\b" } },
  }`;
  const snippets = `{
    // un snippet con varios prefijos y cuerpo en varias líneas
    "Spell": { "prefix": ["spell", "elfspell"], "body": ["spell \${1:name}", "\\tcast \${2:fire}", "end"], "description": "A spell block" },
    "Grupo": {
      "Rune": { "prefix": "#rune", "body": "#rune \${1:ᚱ}", "description": "Rune comment" },
    },
    "Sin prefijo": { "body": "nada" },
  }`;
  return zip([
    ...ENVOLTORIO,
    ['extension/package.json', JSON.stringify(pkg, null, 2)],
    ['extension/NOTICE.md', 'Synthetic fixture, public domain.'],
    ['extension/language-configuration.json', config],
    ['extension/syntaxes/elfs.tmLanguage.json', JSON.stringify(grammar)],
    ['extension/syntaxes/rune.tmLanguage', rune],
    ['extension/snippets/elfs.code-snippets', snippets],
    ['extension/snippets/js.json', JSON.stringify({ 'Elf log': { prefix: 'elflog', body: "console.log('elf', $1);$0", description: 'Log with an elf' } })],
  ]);
}

// ── paquetes hostiles o rotos: seguridad y mensajes ──────────────────────────
const paquete = (pkg, ficheros) => zip([
  ...ENVOLTORIO,
  ['extension/package.json', JSON.stringify({ publisher: 'elffuss-test', version: '1.0.0', engines: { vscode: '^1.80.0' }, license: 'MIT', ...pkg }, null, 2)],
  ...ficheros,
]);

// Gramática que intenta sacar al motor de su repositorio con nombres de
// Object.prototype: «#__proto__» escribía Object.prototype.id para TODA la
// página. Lleva también reglas legítimas (#kw, y una que se llama
// «constructor») que tienen que seguir pintando. El texto va a mano: un objeto
// JS con clave __proto__ no la serializaría. Y un tema con un ámbito
// «hasOwnProperty», que tumbaba el árbol de temas del motor.
export const EVIL = { lang: 'evilscript', ext: '.evil', scope: 'source.evil', kw: '#DD2200', ctor: '#22AA44' };
export const EVIL_GRAMMAR = `{
  "scopeName": "source.evil",
  "patterns": [
    { "include": "#__proto__" }, { "include": "#constructor" }, { "include": "#toString" },
    { "include": "source.evil#__proto__" }, { "include": "hasOwnProperty" }, { "include": "__proto__#x" },
    { "include": "#kw" },
    { "begin": "\\\\(", "end": "\\\\)", "id": 1, "__proto__": { "match": "x" }, "patterns": [{ "include": "#valueOf" }],
      "captures": { "__proto__": { "name": "x" }, "0": { "name": "punctuation.paren.evil" } } }
  ],
  "repository": {
    "kw": { "match": "\\\\bevil\\\\b", "name": "keyword.control.evil" },
    "constructor": { "match": "\\\\bctor\\\\b", "name": "entity.name.function.ctor.evil" }
  }
}`;
export function hostileGrammarVsix() {
  const theme = {
    colors: { 'editor.background': '#101010', 'editor.foreground': '#EEEEEE' },
    tokenColors: [
      { scope: 'hasOwnProperty', settings: { foreground: '#123123' } },
      { scope: ['__proto__.x', 'keyword.control'], settings: { foreground: EVIL.kw } },
      { scope: 'entity.name.function', settings: { foreground: EVIL.ctor } },
    ],
  };
  return paquete({
    name: 'evil', displayName: 'Evil Grammar',
    contributes: {
      languages: [{ id: EVIL.lang, extensions: [EVIL.ext] }],
      grammars: [
        { language: EVIL.lang, scopeName: EVIL.scope, path: './evil.tmLanguage.json' },
        { scopeName: '__proto__', path: './evil.tmLanguage.json' },
      ],
      themes: [{ label: 'Evil Theme', uiTheme: 'vs-dark', path: './evil-theme.json' }],
    },
  }, [['extension/evil.tmLanguage.json', EVIL_GRAMMAR], ['extension/evil-theme.json', JSON.stringify(theme)]]);
}

// Snippet cuya descripción y cuerpo llevan imágenes y enlaces en Markdown: si
// el detalle se pintara como Markdown, el navegador los pediría a `base`.
export function beaconSnippetVsix(base) {
  const snippets = { Beacon: {
    prefix: 'zzbeacon',
    description: `![d](${base}/desc.png) [click](${base}/link)`,
    body: ['x', '```', `![b](${base}/body.png)`, '```'],
  } };
  return paquete({ name: 'beacon', displayName: 'Beacon Snippets', contributes: { snippets: [{ language: 'javascript', path: './s.json' }] } },
    [['extension/s.json', JSON.stringify(snippets)]]);
}

// Dos temas, uno con JSON roto; o (onlyBroken) solo temas que no se pueden leer.
export function brokenThemeVsix({ onlyBroken = false } = {}) {
  const bueno = JSON.stringify({ colors: { 'editor.background': '#0A1A2A', 'tab.activeBackground': '#0A1A2A' }, tokenColors: [] });
  const themes = onlyBroken
    ? [{ label: 'Broken One', path: './themes/broken.json' }, { label: 'Missing One', path: './themes/missing.json' }]
    : [{ label: 'Good One', uiTheme: 'vs-dark', path: './themes/good.json' }, { label: 'Broken One', path: './themes/broken.json' }];
  return paquete({ name: onlyBroken ? 'broken-only' : 'half-broken', displayName: onlyBroken ? 'Broken Only' : 'Half Broken', contributes: { themes } },
    [['extension/themes/good.json', bueno], ['extension/themes/broken.json', '{ "colors": { "editor.background": "#000000" ']]);
}

// Gramática y configuración para JSON: Monaco lo trae sin Monarch, así que ni
// la gramática ni la configuración se aplican.
export function jsonGrammarVsix() {
  return paquete({
    name: 'json-x', displayName: 'JSON X',
    contributes: {
      languages: [{ id: 'json', extensions: ['.json'], configuration: './conf.json' }],
      grammars: [{ language: 'json', scopeName: 'source.json.x', path: './json.tmLanguage.json' }],
    },
  }, [['extension/conf.json', '{ "comments": { "lineComment": "//" } }'],
    ['extension/json.tmLanguage.json', JSON.stringify({ scopeName: 'source.json.x', patterns: [{ match: '"', name: 'string.json' }] })]]);
}

// package.json sin publisher.
export function noPublisherVsix() {
  return zip([...ENVOLTORIO, ['extension/package.json', JSON.stringify({ name: 'nopub', version: '1.0.0', contributes: { themes: [] } })]]);
}

// Expresiones que pueden no terminar: una firstLine con alternativas que se
// solapan (no es repetición anidada, así que pasa la comprobación estática y
// la para el Worker), otra con repetición anidada y un wordPattern igual.
export const SLOW = { lang: 'slowlang', nest: 'nestlang', firstLine: '^(.|\\s)*z' };
export function slowRegexVsix() {
  return paquete({
    name: 'slow', displayName: 'Slow Regex',
    contributes: {
      languages: [
        { id: SLOW.lang, extensions: ['.slow'], firstLine: SLOW.firstLine },
        { id: SLOW.nest, extensions: ['.nest'], firstLine: '^(a+)+$', configuration: './conf.json' },
      ],
    },
  }, [['extension/conf.json', JSON.stringify({ wordPattern: '(a+)+$', brackets: [['(', ')']] })]]);
}

// ── lo que se ve al instalar (ext_feedback.mjs) ──────────────────────────────
// Solo código: vistas previas propias, comandos, menús y dos lenguajes SIN
// gramática ni configuración (como una extensión real de vista previa). Aquí no
// aporta nada visible: no se ofrece instalarla.
export function codeOnlyVsix() {
  return paquete({
    name: 'previewer', displayName: 'Rich Previewer', description: 'LaTeX, STL and video preview with right-click copy',
    categories: ['Visualization', 'Other'], main: './dist/extension.js',
    contributes: {
      languages: [{ id: 'csv', aliases: ['CSV'], extensions: ['.csv'] }, { id: 'tsv', aliases: ['TSV'], extensions: ['.tsv'] }],
      commands: [{ command: 'pv.copy', title: 'Copy' }], menus: { 'editor/context': [] },
      customEditors: [{ viewType: 'pv.stl', displayName: 'STL', selector: [{ filenamePattern: '*.stl' }] }],
      configuration: { properties: {} },
    },
  }, [['extension/dist/extension.js', 'throw new Error("must never run")', { method: 99 }]]);
}
// Resaltado + configuración de un lenguaje nuevo, y además código para el
// navegador (formatear, comandos): funciona en parte.
export const TOMLISH = { lang: 'tomlish', ext: '.tomlish', scope: 'source.tomlish', key: '#E06C75' };
export function partialLangVsix() {
  const g = { scopeName: TOMLISH.scope, patterns: [{ match: '^\\s*[a-z]+(?=\\s*=)', name: 'variable.other.key.tomlish' }, { match: '#.*$', name: 'comment.line.tomlish' }] };
  return paquete({
    name: 'tomlish', displayName: 'Tomlish Support', description: 'Fully-featured Tomlish support',
    categories: ['Programming Languages', 'Formatters'], main: './dist/extension.js', browser: './dist/browser.js',
    contributes: {
      languages: [{ id: TOMLISH.lang, aliases: ['Tomlish'], extensions: [TOMLISH.ext], configuration: './conf.json' }],
      grammars: [{ language: TOMLISH.lang, scopeName: TOMLISH.scope, path: './g.json' }],
      commands: [{ command: 't.fmt', title: 'Format' }], configuration: { properties: {} },
    },
  }, [['extension/g.json', JSON.stringify(g)], ['extension/conf.json', JSON.stringify({ comments: { lineComment: '#' }, brackets: [['[', ']'], ['{', '}']], autoClosingPairs: [{ open: '[', close: ']' }, { open: '"', close: '"' }] })],
    ['extension/dist/extension.js', 'throw new Error("must never run")', { method: 99 }]]);
}
// Solo temas, sin código.
export const PURE_DARK = '#2A1B3D';
export function pureThemeVsix() {
  const t = bg => JSON.stringify({ colors: { 'editor.background': bg, 'editor.foreground': '#F8F8F2' }, tokenColors: [{ scope: 'keyword', settings: { foreground: '#FF79C6' } }] });
  return paquete({ name: 'pure-theme', displayName: 'Pure Theme', categories: ['Themes'], contributes: { themes: [
    { label: 'Pure Night', uiTheme: 'vs-dark', path: './night.json' }, { label: 'Pure Dusk', uiTheme: 'vs-dark', path: './dusk.json' },
  ] } }, [['extension/night.json', t(PURE_DARK)], ['extension/dusk.json', t('#3A2B4D')]]);
}
// Snippets para JavaScript, sin código.
export function jsSnippetsVsix() {
  const s = {
    'Console log': { prefix: 'clg', body: 'console.log($1);' },
    'Import': { prefix: 'imp', body: "import $1 from '$2';" },
    'Arrow': { prefix: 'fn', body: 'const $1 = ($2) => {$0};' },
    'Group': { Inner: { prefix: 'thr', body: 'throw new Error($1);' } },
  };
  return paquete({ name: 'js-snips', displayName: 'JS Snips', categories: ['Snippets'], contributes: { snippets: [{ language: 'javascript', path: './s.json' }, { language: 'typescript', path: './s.json' }] } },
    [['extension/s.json', JSON.stringify(s)]]);
}

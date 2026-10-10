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

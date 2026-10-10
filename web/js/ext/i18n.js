// Textos del panel de extensiones (ES/EN). Van aparte de js/i18n.js para no
// tocar ese fichero; mismo idioma (uiLang) y misma sustitución {var}.
import { uiLang } from '../i18n.js';

const L = {
  es: {
    title: 'Extensiones', sub: 'Open VSX',
    intro: 'Temas de color, gramáticas, snippets y ajustes de lenguaje de extensiones de VS Code. Aquí no se ejecuta el código de ninguna extensión, y tu proyecto no sale del navegador: a Open VSX solo va lo que buscas y lo que instalas.',
    paused: 'Extensiones en pausa en esta sesión (?noext): no se aplica ninguna. Puedes desactivarlas o desinstalarlas.',
    searchPh: 'Buscar extensiones en Open VSX…',
    catAll: 'Todo', catThemes: 'Temas', catSnippets: 'Snippets', catLangs: 'Lenguajes',
    vsix: 'Instalar .vsix…', themeBtn: 'Tema de color…',
    installedH: 'Instaladas ({n})', none: 'Ninguna todavía. Busca arriba o instala un .vsix.',
    popular: 'Populares', results: '{n} resultados', noResults: 'Sin resultados.', searching: 'Buscando…', more: 'Más resultados',
    install: 'Instalar', installing: 'Instalando…', downloading: 'Descargando… {pct}%', installedOk: 'Instalada ✓', update: 'Actualizar a {v}',
    enable: 'Activar', disable: 'Desactivar', disabled: 'desactivada', uninstall: 'Desinstalar', confirmUninstall: '¿Desinstalar «{name}»?',
    details: 'Detalles', loadingDetails: 'Leyendo el manifiesto…',
    applies: 'Aplica: {list}', ignores: 'No aplica: {list}', nothing: 'Nada de esta extensión se puede aplicar aquí.',
    needsCode: 'necesita su código', notYet: 'aún no',
    hasCode: 'Trae código (main/browser): no se ejecuta — haría falta un host de extensiones.',
    pack: 'Es un paquete de {n} extensiones: instálalas una a una.',
    themes: '{n} tema|{n} temas', grammars: '{n} gramática|{n} gramáticas', snippets: 'snippets ({langs})', languages: '{n} lenguaje|{n} lenguajes',
    license: 'Licencia: {l}', viewLicense: 'ver licencia', noLicense: 'sin licencia declarada',
    verified: 'suma SHA-256 comprobada', unverified: 'Open VSX no publica suma SHA-256', fromFile: 'desde fichero',
    downloads: '{n} descargas',
    bigConfirm: 'Esta extensión pesa {mb} MB. ¿Descargarla igualmente?',
    errNet: 'No pude hablar con Open VSX: {e}', errRate: 'Open VSX está limitando peticiones: espera un momento y reintenta.',
    errSha: 'La suma SHA-256 del paquete no coincide con la publicada: no se instala.',
    errNothing: 'Esta extensión no trae nada que se pueda aplicar aquí (temas, gramáticas, snippets o lenguajes).',
    errNotVsix: 'Eso no es un .vsix de VS Code.',
    err: 'No se pudo: {e}', cancelled: 'Cancelado.',
    installedMsg: '«{name}» instalada.', grammarSkipped: 'La gramática de {lang} no se aplica: Monaco conserva su coloreado de serie.',
    pickPh: 'Tema de color (↑↓ para previsualizar, Enter para elegir)', builtinGroup: 'Integrados',
    builtinDark: 'Oscuro (por defecto)', builtinLight: 'Claro', builtinHc: 'Alto contraste oscuro', builtinHcLight: 'Alto contraste claro',
    current: 'actual', palExt: 'Extensiones…', palTheme: 'Tema de color…',
  },
  en: {
    title: 'Extensions', sub: 'Open VSX',
    intro: 'Color themes, grammars, snippets and language settings from VS Code extensions. No extension code runs here, and your project never leaves the browser: Open VSX only sees what you search for and what you install.',
    paused: 'Extensions are paused for this session (?noext): none is applied. You can still disable or uninstall them.',
    searchPh: 'Search extensions on Open VSX…',
    catAll: 'All', catThemes: 'Themes', catSnippets: 'Snippets', catLangs: 'Languages',
    vsix: 'Install .vsix…', themeBtn: 'Color Theme…',
    installedH: 'Installed ({n})', none: 'None yet. Search above or install a .vsix.',
    popular: 'Popular', results: '{n} results', noResults: 'No results.', searching: 'Searching…', more: 'More results',
    install: 'Install', installing: 'Installing…', downloading: 'Downloading… {pct}%', installedOk: 'Installed ✓', update: 'Update to {v}',
    enable: 'Enable', disable: 'Disable', disabled: 'disabled', uninstall: 'Uninstall', confirmUninstall: 'Uninstall “{name}”?',
    details: 'Details', loadingDetails: 'Reading the manifest…',
    applies: 'Applies: {list}', ignores: 'Not applied: {list}', nothing: 'Nothing in this extension can be applied here.',
    needsCode: 'needs its code', notYet: 'not yet',
    hasCode: 'Ships code (main/browser): it does not run here — that needs an extension host.',
    pack: 'This is a pack of {n} extensions: install them one by one.',
    themes: '{n} theme|{n} themes', grammars: '{n} grammar|{n} grammars', snippets: 'snippets ({langs})', languages: '{n} language|{n} languages',
    license: 'Licence: {l}', viewLicense: 'view licence', noLicense: 'no licence declared',
    verified: 'SHA-256 checked', unverified: 'Open VSX publishes no SHA-256', fromFile: 'from file',
    downloads: '{n} downloads',
    bigConfirm: 'This extension is {mb} MB. Download it anyway?',
    errNet: 'Could not reach Open VSX: {e}', errRate: 'Open VSX is rate-limiting requests: wait a moment and retry.',
    errSha: 'The package SHA-256 does not match the published one: not installed.',
    errNothing: 'This extension brings nothing that can be applied here (themes, grammars, snippets or languages).',
    errNotVsix: 'That is not a VS Code .vsix.',
    err: 'Could not do it: {e}', cancelled: 'Cancelled.',
    installedMsg: '“{name}” installed.', grammarSkipped: 'The {lang} grammar is not applied: Monaco keeps its built-in highlighting.',
    pickPh: 'Color theme (↑↓ to preview, Enter to select)', builtinGroup: 'Built-in',
    builtinDark: 'Dark (default)', builtinLight: 'Light', builtinHc: 'Dark High Contrast', builtinHcLight: 'Light High Contrast',
    current: 'current', palExt: 'Extensions…', palTheme: 'Color Theme…',
  },
};

export function tx(key, vars) {
  const tabla = L[uiLang()] || L.en;
  let s = tabla[key] ?? L.en[key] ?? key;
  if (s.includes('|') && vars && 'n' in vars) s = s.split('|')[Number(vars.n) === 1 ? 0 : 1];
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s;
}

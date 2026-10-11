// Extensiones de VS Code en Elffuss Code (nivel 1: temas, gramáticas,
// snippets y lenguajes; nada de código de extensión).
//
//   BASE=http://localhost:8999 node tests/extensions.mjs
//
// Las extensiones de prueba se fabrican aquí (ext_fixtures.mjs): sin red ni
// licencias. La parte EN VIVO instala dos extensiones reales de Open VSX
// (vscode.theme-monokai y vscode.make, de las «built-in» de VS Code, MIT); si
// no hay red, se marca NOT RUN y no cuenta como fallo.
import { chromium } from 'playwright';
import { themeVsix, elfscriptVsix, THEME_DARK, EVIL, EVIL_GRAMMAR, hostileGrammarVsix, beaconSnippetVsix, brokenThemeVsix, jsonGrammarVsix, noPublisherVsix, slowRegexVsix } from './ext_fixtures.mjs';

const OUT = (process.env.SCRATCH || '/tmp/elffuss-test');
const BASE = process.env.BASE || 'http://localhost:8999';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const notRun = (n, e) => console.log('⏭️  NOT RUN ' + n + (e ? '  — ' + e : ''));
const rgb = hex => { const h = hex.replace('#', ''); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function hasta(fn, { tiempo = 15000, cada = 150 } = {}) {
  const fin = Date.now() + tiempo;
  let v;
  while (Date.now() < fin) { try { v = await fn(); if (v) return v; } catch { /* reintenta */ } await sleep(cada); }
  return v;
}

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
const errores = [];
// «Canceled»: Monaco deja escapar esa promesa si se cambia de fichero justo
// después de aceptar una sugerencia; pasa igual SIN extensiones, no es de aquí.
p.on('pageerror', e => { if (e.message !== 'Canceled') errores.push(e.message); });
const pedidas = [];
p.on('request', r => pedidas.push(r.url()));

// ── helpers dentro de la página ──
const fondo = () => p.evaluate(() => getComputedStyle(document.querySelector('#editor .monaco-editor-background') || document.querySelector('#editor .monaco-editor')).backgroundColor);
const abre = path => p.evaluate(async path => { await (await import('/js/ide.js')).openFile(path); }, path);
const lenguaje = () => p.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getLanguageId());
// estilo del primer span pintado cuyo texto es `txt`
const estilo = txt => p.evaluate(txt => {
  for (const s of document.querySelectorAll('#editor .view-lines span span')) {
    // Monaco pinta los espacios como U+00A0
    if (s.textContent.replace(/ /g, ' ').trim() === txt) { const cs = getComputedStyle(s); return { color: cs.color, italic: cs.fontStyle === 'italic' }; }
  }
  return null;
}, txt);
const colorDe = async (txt, hex) => hasta(async () => (await estilo(txt))?.color === rgb(hex), { tiempo: 8000 });
const ponTexto = (texto) => p.evaluate(texto => { const ed = window.monaco.editor.getEditors()[0]; ed.getModel().setValue(texto); }, texto);
const instalaFichero = async (nombre, bytes) => {
  await p.evaluate(() => { const m = document.getElementById('ext-msg'); if (m) { m.hidden = true; m.textContent = ''; } });
  await p.setInputFiles('#ext-file', { name: nombre, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  return hasta(() => p.evaluate(() => { const m = document.getElementById('ext-msg'); return m && !m.hidden && m.textContent; }), { tiempo: 15000 });
};
const abrePanel = async () => {
  await p.click('#act-ext');
  await p.waitForSelector('#ext-panel', { timeout: 10000 });
};
const filaInstalada = id => p.locator(`#ext-installed .ext-row[data-id="${id}"]`);

// ── A. primer arranque: sin extensiones no se carga NADA nuevo ──
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('app.js', '// nota\nconst a = 1;\n');
  await w('notes.elfs', '# hola\nspell fire with 42\n  cast "llama"\nend\nᚱune\n');
  await w('Makefile', '# build\nall: build\n\tgcc -o app main.c\n');
  await w('a.evil', 'evil ctor (x)\n');
  await w('runme', '#!/usr/bin/env elfs\nspell x\nend\n');
  // sin extensión y con una primera línea que hace no terminar a ^(.|\s)*z
  await w('slow-input', ' '.repeat(64) + 'x\n');
});
pedidas.length = 0;
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await hasta(() => p.evaluate(() => !!window.monaco?.editor?.getEditors?.().length));
await sleep(800);
const extras = pedidas.filter(u => /\/js\/ext\/|\/css\/ext\.css|vscode-textmate|vscode-oniguruma|open-vsx|eclipsecontent/.test(u));
ok('primer arranque sin extensiones: ni host, ni panel, ni motor TextMate, ni Open VSX', extras.length === 0, extras.join(' '));
ok('tema de serie (vs-dark)', (await fondo()) === 'rgb(30, 30, 30)', await fondo());

// ── B. panel + tema desde un .vsix ──
await abrePanel();
ok('el panel abre sin pedir nada a Open VSX (solo al buscar)', !pedidas.some(u => /open-vsx/.test(u)));
await instalaFichero('elf-theme.vsix', themeVsix());
ok('tema instalado desde .vsix', await hasta(async () => (await filaInstalada('elffuss-test.elf-theme').count()) === 1), await p.locator('#ext-msg').textContent());
const textoFila = await filaInstalada('elffuss-test.elf-theme').innerText();
ok('la fila dice qué aplica y qué no (commands necesita código, main no se ejecuta)', /2 (temas|themes)/.test(textoFila) && /commands/.test(textoFila) && /(main\/browser)/.test(textoFila), textoFila.replace(/\s+/g, ' ').slice(0, 220));
const chipOscuro = filaInstalada('elffuss-test.elf-theme').locator('.ext-theme-chips .ext-chip').first();
await chipOscuro.click();
ok('tema aplicado: fondo del editor', await hasta(async () => (await fondo()) === rgb(THEME_DARK.bg)), await fondo());
ok('pestañas con los colores del tema (sin el url() malicioso)', await hasta(() => p.evaluate(() => (document.getElementById('ext-theme-chrome')?.textContent || '').includes('#203040') && !document.getElementById('ext-theme-chrome').textContent.includes('url('))));
await p.click('#settings-close');
await abre('app.js');
ok('JS (Monarch): keyword con el color del tema', await colorDe('const', THEME_DARK.keyword), JSON.stringify(await estilo('const')));
ok('JS (Monarch): comentario con color y cursiva del tema', (await colorDe('// nota', THEME_DARK.comment)) && (await estilo('// nota'))?.italic, JSON.stringify(await estilo('// nota')));

// ── C. lenguaje nuevo + gramática TextMate + snippets ──
await abrePanel();
await instalaFichero('elfscript.vsix', elfscriptVsix());
ok('extensión de lenguaje instalada', await hasta(async () => (await filaInstalada('elffuss-test.elfscript').count()) === 1));
await p.click('#settings-close');
await abre('notes.elfs');
ok('.elfs → lenguaje elfscript (de la extensión)', await hasta(async () => (await lenguaje()) === 'elfscript'), await lenguaje());
ok('motor TextMate bajado solo ahora (al abrir un fichero con gramática)', await hasta(() => pedidas.some(u => /vscode-textmate@9\.3\.2/.test(u)) && pedidas.some(u => /onig\.wasm/.test(u))));
ok('…el motor del propio sitio (vendor/) y nada generado por el CDN (+esm)', pedidas.some(u => u.startsWith(BASE + '/js/ext/vendor/vscode-textmate@9.3.2/main.js')) && pedidas.some(u => u.startsWith(BASE + '/js/ext/vendor/vscode-oniguruma@2.0.1/main.js')) && !pedidas.some(u => /\+esm/.test(u)), pedidas.filter(u => /vscode-|\+esm/.test(u)).join(' '));
ok('gramática: keyword.control con el color exacto del tema', await colorDe('spell', THEME_DARK.control), JSON.stringify(await estilo('spell')));
ok('gramática: comentario (color + cursiva) y cadena', (await colorDe('# hola', THEME_DARK.comment)) && (await estilo('# hola'))?.italic && await colorDe('"llama"', THEME_DARK.string), JSON.stringify([await estilo('# hola'), await estilo('"llama"')]));
ok('gramática: número y gramática incluida (plist .tmLanguage)', (await colorDe('42', THEME_DARK.number)) && await colorDe('ᚱune', THEME_DARK.keyword), JSON.stringify([await estilo('42'), await estilo('ᚱune')]));
ok('gramática: selector con contexto («source.elfs keyword») que Monarch no sabría aplicar', await colorDe('with', '#123456'), JSON.stringify(await estilo('with')));
const ambitos = await p.evaluate(() => window.monaco.editor.tokenize('spell x\n# c', 'elfscript').flat().map(t => t.type));
ok('tokens con los ámbitos de la gramática', ambitos.includes('keyword.control.elfs') && ambitos.includes('comment.line.number-sign.elfs'), ambitos.join(' '));
await p.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.setPosition({ lineNumber: 2, column: 1 }); ed.focus(); ed.trigger('t', 'editor.action.commentLine', {}); });
ok('configuración del lenguaje: comentar línea usa «#»', (await p.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getLineContent(2))).startsWith('# spell'));
// snippet en el lenguaje nuevo
await ponTexto('');
await p.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.setPosition({ lineNumber: 1, column: 1 }); ed.focus(); });
await p.keyboard.type('elfsp');
await p.evaluate(() => window.monaco.editor.getEditors()[0].trigger('t', 'editor.action.triggerSuggest', {}));
const visto = await hasta(() => p.evaluate(() => [...document.querySelectorAll('.suggest-widget.visible .monaco-list-row')].some(r => r.textContent.includes('elfspell'))));
ok('snippet sugerido al escribir el prefijo', visto);
await p.keyboard.press('Enter');
// el \t del snippet sale con la sangría del fichero, como en VS Code
ok('snippet expandido (cuerpo en varias líneas con sus valores)', await hasta(async () => /^spell name\n(\t| +)cast fire\nend$/.test(await p.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue()))), JSON.stringify(await p.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue())));
await p.keyboard.press('Escape');
// snippet de la misma extensión para JavaScript
await abre('app.js');
await ponTexto('');
await p.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.setPosition({ lineNumber: 1, column: 1 }); ed.focus(); });
await p.keyboard.type('elflo');
await p.evaluate(() => window.monaco.editor.getEditors()[0].trigger('t', 'editor.action.triggerSuggest', {}));
await hasta(() => p.evaluate(() => [...document.querySelectorAll('.suggest-widget.visible .monaco-list-row')].some(r => r.textContent.includes('elflog'))));
await p.keyboard.press('Enter');
ok('snippet en JavaScript (otro lenguaje de la misma extensión)', await hasta(async () => (await p.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue())) === "console.log('elf', );"), await p.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue()));
await p.keyboard.press('Escape');

// ── D. las herramientas code.* del agente siguen trabajando sobre los modelos ──
await abre('notes.elfs');
await p.evaluate(async () => { const code = await import('/js/tools/code.js'); await code.write({ path: 'notes.elfs', content: 'spell agent\n  cast 7\nend\n' }); });
ok('code.write refresca el modelo abierto', await hasta(async () => (await p.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue())) === 'spell agent\n  cast 7\nend\n'));
ok('…y la gramática sigue pintándolo', await colorDe('cast', THEME_DARK.control));
const editado = await p.evaluate(async () => { const code = await import('/js/tools/code.js'); return code.edit({ path: 'notes.elfs', search: 'cast 7', replace: 'cast 8' }); });
ok('code.edit sobre un fichero de la extensión', await hasta(async () => (await p.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue())).includes('cast 8')), String(editado).slice(0, 80));
ok('code.read devuelve el contenido', /cast 8/.test(await p.evaluate(async () => (await import('/js/tools/code.js')).read({ path: 'notes.elfs' }))));
await p.screenshot({ path: OUT + '/ext-grammar.png' });

// ── E. recargar conserva el estado ──
pedidas.length = 0;
await p.reload({ waitUntil: 'domcontentloaded' });
await hasta(() => p.evaluate(() => !!window.monaco?.editor?.getEditors?.().length));
ok('tras recargar: el host se carga al arrancar (hay extensiones)', await hasta(() => pedidas.some(u => /\/js\/ext\/host\.js/.test(u))));
ok('tras recargar: el tema sigue', await hasta(async () => (await fondo()) === rgb(THEME_DARK.bg)), await fondo());
await abre('notes.elfs');
ok('tras recargar: la gramática sigue', await colorDe('spell', THEME_DARK.control), JSON.stringify(await estilo('spell')));
await abrePanel();
ok('tras recargar: las dos extensiones siguen instaladas', (await p.locator('#ext-installed .ext-row').count()) === 2);
const espejo = await p.evaluate(async () => (await import('/js/db.js')).get('kv', 'extensions'));
ok('la lista va al inventario del espacio de trabajo (kv «extensions»)', Array.isArray(espejo) && espejo.length === 2 && espejo.every(e => e.enabled), JSON.stringify(espejo));

// ── F. selector de tema: previsualiza, Escape deshace, Enter elige ──
// lo que oye un lector de pantalla: combobox → listbox → opción activa
const combo = () => p.evaluate(() => {
  const i = document.querySelector('#ext-themepick input');
  const lista = document.getElementById(i.getAttribute('aria-controls'));
  const activa = document.getElementById(i.getAttribute('aria-activedescendant') || '-');
  return {
    foco: document.activeElement === i, role: i.getAttribute('role'), expanded: i.getAttribute('aria-expanded'), lista: lista?.getAttribute('role'),
    activa: activa && { role: activa.getAttribute('role'), sel: activa.getAttribute('aria-selected'), theme: activa.dataset.theme, marcada: activa.classList.contains('sel') },
    opciones: lista?.querySelectorAll('[role=option]').length, seleccionadas: lista?.querySelectorAll('[aria-selected=true]').length,
    grupos: [...(lista?.querySelectorAll('[role=group]') || [])].map(g => g.getAttribute('aria-label')),
  };
});
await p.click('#ext-theme-btn');
await p.waitForSelector('#ext-themepick');
const c0 = await combo();
ok('selector: combobox con su listbox, una opción activa y grupos con nombre', c0.foco && c0.role === 'combobox' && c0.expanded === 'true' && c0.lista === 'listbox' && c0.opciones >= 5 && c0.seleccionadas === 1 && c0.activa?.role === 'option' && c0.activa.sel === 'true' && c0.grupos.includes('Built-in'), JSON.stringify(c0));
await p.keyboard.press('ArrowUp');
const previa = await hasta(async () => (await fondo()) !== rgb(THEME_DARK.bg) && fondo());
ok('selector: las flechas previsualizan', !!previa, String(previa));
const c1 = await combo();
ok('selector: la opción activa cambia con las flechas y se anuncia (aria-activedescendant)', c1.activa && c1.activa.theme !== c0.activa.theme && c1.activa.sel === 'true' && c1.activa.marcada && c1.seleccionadas === 1, JSON.stringify([c0.activa, c1.activa]));
await p.keyboard.press('Escape');
ok('selector: Escape deja el tema que había', await hasta(async () => (await fondo()) === rgb(THEME_DARK.bg)));
ok('selector: al cerrarlo, el foco vuelve al botón que lo abrió', await hasta(() => p.evaluate(() => document.activeElement?.id === 'ext-theme-btn')), await p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName));
await p.click('#ext-theme-btn');
await p.waitForSelector('#ext-themepick');
await p.click('#ext-themepick .tp-item[data-theme="vs"]');
ok('selector: tema claro de serie elegido', await hasta(async () => (await fondo()) === 'rgb(255, 255, 254)'), await fondo());
ok('…y la gramática se repinta con colores de Light+', await colorDe('spell', '#AF00DB'), JSON.stringify(await estilo('spell')));
// el ● de «sin guardar» con un tema claro (era casi blanco sobre blanco, y es
// el único aviso: cerrar la pestaña no pregunta)
await abre('app.js');
await p.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.focus(); ed.trigger('t', 'type', { text: ' ' }); });
const punto = await hasta(() => p.evaluate(() => {
  const tab = document.querySelector('#tabs-bar .tab.active'), dot = tab?.querySelector('.tab-x.dirty');
  if (!dot) return null;
  const num = c => c.match(/[\d.]+/g).map(Number);
  const [r, g, b, a = 1] = num(getComputedStyle(dot).color), fondo = num(getComputedStyle(tab).backgroundColor);
  const L = c => { const [x, y, z] = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * x + 0.7152 * y + 0.0722 * z; };
  const l1 = L([r, g, b].map((v, k) => v * a + fondo[k] * (1 - a))), l2 = L(fondo.slice(0, 3));
  return { punto: getComputedStyle(dot).color, pestaña: getComputedStyle(tab).backgroundColor, opacidad: getComputedStyle(dot).opacity, contraste: Math.round((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) * 100) / 100 };
}));
ok('tema claro: el ● de cambios sin guardar se ve (contraste ≥ 4.5:1 con su pestaña)', punto && punto.contraste >= 4.5 && +punto.opacidad === 1, JSON.stringify(punto));
await p.reload({ waitUntil: 'domcontentloaded' });
await hasta(() => p.evaluate(() => !!window.monaco?.editor?.getEditors?.().length));
ok('el tema elegido sobrevive a la recarga', await hasta(async () => (await fondo()) === 'rgb(255, 255, 254)'), await fondo());
// por la paleta de comandos
await abre('app.js');
await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
await p.fill('#pal-input', '>tema de color');
let filas = await p.locator('#pal-list .pal-item').count();
if (!filas) { await p.fill('#pal-input', '>color theme'); filas = await p.locator('#pal-list .pal-item').count(); }
ok('comando «Tema de color…» en la paleta', filas === 1);
await p.keyboard.press('Enter');
await p.waitForSelector('#ext-themepick');
await p.click(`#ext-themepick .tp-item[data-theme^="x-elffuss-test-elf-theme-elf-dark"]`);
ok('tema de la extensión elegido desde la paleta', await hasta(async () => (await fondo()) === rgb(THEME_DARK.bg)));
ok('…y el foco vuelve al editor (la paleta ya no está)', await hasta(() => p.evaluate(() => !!document.activeElement?.closest('#editor'))), await p.evaluate(() => document.activeElement?.className || document.activeElement?.tagName));

// ── G. ?noext: todo en pausa ──
await p.goto(BASE + '/?test-opfs&noext', { waitUntil: 'domcontentloaded' });
await hasta(() => p.evaluate(() => !!window.monaco?.editor?.getEditors?.().length));
await sleep(600);
ok('?noext: se arranca sin aplicar extensiones', (await fondo()) === 'rgb(30, 30, 30)', await fondo());
await abre('notes.elfs');
ok('?noext: el .elfs queda en texto plano', (await lenguaje()) === 'plaintext');
await abrePanel();
ok('?noext: el panel lo avisa', await p.locator('.ext-paused').count() === 1);
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await hasta(() => p.evaluate(() => !!window.monaco?.editor?.getEditors?.().length));

// ── H. desactivar y desinstalar lo deshacen todo ──
await abre('notes.elfs');
await colorDe('spell', THEME_DARK.control);
await abrePanel();
await filaInstalada('elffuss-test.elf-theme').locator('.ext-toggle').click();
ok('desactivar el tema → vuelve el oscuro de serie y las pestañas de siempre', await hasta(async () => (await fondo()) === 'rgb(30, 30, 30)' && !(await p.evaluate(() => document.getElementById('ext-theme-chrome')?.textContent))), await fondo());
ok('…y la gramática se repinta con Dark+', await colorDe('spell', '#C586C0'), JSON.stringify(await estilo('spell')));
await filaInstalada('elffuss-test.elfscript').locator('.ext-toggle').click();
ok('desactivar el lenguaje → el .elfs vuelve a texto plano', await hasta(async () => (await lenguaje()) === 'plaintext'), await lenguaje());
await p.click('#settings-close');
await abre('app.js');
await ponTexto('');
await p.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.setPosition({ lineNumber: 1, column: 1 }); ed.focus(); });
await p.keyboard.type('elflo');
await p.evaluate(() => window.monaco.editor.getEditors()[0].trigger('t', 'editor.action.triggerSuggest', {}));
await sleep(1200);
ok('…y sus snippets ya no se ofrecen', !(await p.evaluate(() => [...document.querySelectorAll('.suggest-widget.visible .monaco-list-row')].some(r => r.textContent.includes('elflog')))));
await p.keyboard.press('Escape');
await abrePanel();
await filaInstalada('elffuss-test.elfscript').locator('.ext-toggle').click();
await abre('notes.elfs');
ok('reactivar el lenguaje lo devuelve', await hasta(async () => (await lenguaje()) === 'elfscript') && await colorDe('spell', '#C586C0'));
p.once('dialog', d => d.accept());
await filaInstalada('elffuss-test.elfscript').locator('.ext-uninstall').click();
ok('desinstalar el lenguaje', await hasta(async () => (await filaInstalada('elffuss-test.elfscript').count()) === 0 && (await lenguaje()) === 'plaintext'));
p.once('dialog', d => d.accept());
await filaInstalada('elffuss-test.elf-theme').locator('.ext-uninstall').click();
ok('desinstalar el tema', await hasta(async () => (await p.locator('#ext-installed .ext-row').count()) === 0));
const restos = await p.evaluate(() => new Promise(res => {
  const r = indexedDB.open('elffuss-code-ext');
  r.onsuccess = () => { const q = r.result.transaction('files').objectStore('files').getAllKeys(); q.onsuccess = () => { res(q.result.length); r.result.close(); }; };
  r.onerror = () => res(-1);
}));
ok('sin restos en IndexedDB tras desinstalar', restos === 0, String(restos));
ok('kv «extensions» vacía', JSON.stringify(await p.evaluate(async () => (await import('/js/db.js')).get('kv', 'extensions'))) === '[]');

// ── J. paquetes hostiles o rotos, mensajes, teclado y lector de pantalla ──
const activo = () => p.evaluate(() => { const a = document.activeElement; return { id: a?.id, cls: a?.className, k: a?.dataset?.k, theme: a?.dataset?.theme, fila: a?.closest?.('.ext-row')?.dataset.id, label: a?.getAttribute?.('aria-label'), pressed: a?.getAttribute?.('aria-pressed') }; });
// J1. cerrar el panel: la X tiene nombre, Escape lo cierra y el foco vuelve
await p.click('#settings-close');
await abrePanel();
ok('panel: la X de cerrar tiene nombre («Close»), no solo «✕»', (await p.getAttribute('#settings-close', 'aria-label')) === 'Close');
await p.focus('#ext-q');
await p.keyboard.press('Escape');
ok('panel: Escape lo cierra y el foco vuelve al botón de Extensiones', await hasta(() => p.evaluate(() => document.getElementById('settings-panel').hidden && document.activeElement?.id === 'act-ext')), JSON.stringify(await activo()));

// J2. errores en el idioma de la interfaz, como alerta
await abrePanel();
const msgNoPub = await instalaFichero('nopub.vsix', noPublisherVsix());
ok('error de un .vsix sin publisher: en inglés, nada de «sin name/publisher»', msgNoPub === 'The package.json does not give its name and publisher.', msgNoPub);
ok('…y se anuncia como alerta (role=alert)', (await p.getAttribute('#ext-msg', 'role')) === 'alert');

// J3. lo que no se pudo leer se dice, en la fila y al instalar
const msgMedio = await instalaFichero('half.vsix', brokenThemeVsix());
ok('instalada, y el mensaje avisa de lo que no se pudo usar', msgMedio === '“Half Broken” installed. 1 part could not be used.', msgMedio);
ok('…anunciado (role=status)', (await p.getAttribute('#ext-msg', 'role')) === 'status');
const filaMedio = filaInstalada('elffuss-test.half-broken');
ok('la fila: «Applies: 1 theme» y el aviso plegado', /Applies: 1 theme\b/.test(await filaMedio.innerText()) && (await filaMedio.locator('details.ext-warn summary').innerText()) === '1 part could not be used', (await filaMedio.innerText()).replace(/\s+/g, ' '));
await filaMedio.locator('details.ext-warn summary').focus();
await p.keyboard.press('Enter');
const desplegado = await filaMedio.locator('details.ext-warn').evaluate(d => ({ open: d.open, li: d.querySelector('li')?.getClientRects().length > 0, texto: d.querySelector('li')?.textContent }));
ok('…se despliega con el teclado y dice cuál y por qué', desplegado.open && desplegado.li && /^Theme “Broken One”: not valid JSON \(/.test(desplegado.texto), JSON.stringify(desplegado));
const msgRoto = await instalaFichero('broken.vsix', brokenThemeVsix({ onlyBroken: true }));
ok('si no se puede leer nada: lo dice y por qué (no «no trae nada aplicable»)', /^None of the parts of this extension could be read\. Theme “Broken One”: not valid JSON/.test(msgRoto), msgRoto);

// J4. lo que no se aplica no se cuenta como aplicado
await instalaFichero('json.vsix', jsonGrammarVsix());
const textoJson = (await filaInstalada('elffuss-test.json-x').innerText()).replace(/\s+/g, ' ');
ok('gramática y configuración de JSON: «nada aplicable» y las dos en «Not applied»', textoJson.includes('Nothing in this extension can be applied here.') && textoJson.includes('Not applied: json grammar (Monaco keeps its built-in highlighting) · json settings (Monaco keeps its own)') && !/\b1 (grammar|language)\b/.test(textoJson), textoJson);

// J5. el foco no se pierde al repintar la lista de instaladas
await filaMedio.locator('.ext-theme-chips .ext-chip').first().focus();
await p.keyboard.press('Enter');
ok('elegir tema con el teclado: el foco sigue en su ficha, ahora pulsada', await hasta(async () => { const a = await activo(); return a.fila === 'elffuss-test.half-broken' && a.theme?.startsWith('x-elffuss-test-half-broken') && a.pressed === 'true'; }), JSON.stringify(await activo()));
await filaMedio.locator('.ext-toggle').focus();
await p.keyboard.press('Enter');
ok('Desactivar con el teclado: el foco queda en el mismo botón, ahora «Enable Half Broken»', await hasta(async () => { const a = await activo(); return a.k === 'toggle' && a.fila === 'elffuss-test.half-broken' && a.label === 'Enable Half Broken'; }), JSON.stringify(await activo()));
await p.keyboard.press('Enter');
ok('…y el aviso que estaba desplegado sigue desplegado tras repintar', await filaMedio.locator('details.ext-warn').evaluate(d => d.open));
ok('Activar: igual («Disable Half Broken»)', await hasta(async () => { const a = await activo(); return a.k === 'toggle' && a.label === 'Disable Half Broken'; }), JSON.stringify(await activo()));
await filaMedio.locator('.ext-theme-chips .ext-chip').first().click();       // al desactivar se quitó su tema
p.once('dialog', d => d.accept());
await filaInstalada('elffuss-test.json-x').locator('.ext-uninstall').focus();
await p.keyboard.press('Enter');
ok('Desinstalar con el teclado: el foco pasa a la fila siguiente', await hasta(async () => { const a = await activo(); return a.k === 'toggle' && a.fila === 'elffuss-test.half-broken'; }), JSON.stringify(await activo()));

// J6. búsqueda (Open VSX simulado): detalle con teclado, nombres accesibles,
// estado anunciado, y las fichas de tema no pierden su «on»
const FALSA = { namespace: 'elffuss-test', name: 'fake', version: '1.0.0', displayName: 'Fake JSON', description: 'Grammar for JSON', downloadCount: 5, files: {} };
await ctx.route('https://open-vsx.org/api/**', route => {
  const u = new URL(route.request().url());
  const json = (cuerpo, status = 200) => route.fulfill({ status, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) });
  if (u.pathname === '/api/-/search') return json({ totalSize: 1, offset: 0, extensions: [FALSA] });
  if (u.pathname === '/api/elffuss-test/fake/1.0.0') return json({ ...FALSA, license: 'MIT', files: { manifest: 'https://open-vsx.org/api/elffuss-test/fake/1.0.0/file/package.json' } });
  if (u.pathname.endsWith('/file/package.json')) return json({ name: 'fake', publisher: 'elffuss-test', contributes: { grammars: [{ language: 'json', scopeName: 'source.json.f', path: './j.json' }], languages: [{ id: 'json', configuration: './c.json' }] } });
  return json({ error: 'not found' }, 404);
});
await p.fill('#ext-q', 'fake');
await p.press('#ext-q', 'Enter');
const filaFalsa = p.locator('#ext-results .ext-row[data-id="elffuss-test.fake"]');
ok('búsqueda: el resultado llega y se anuncia («1 result»)', await hasta(async () => (await filaFalsa.count()) === 1 && (await p.textContent('#ext-status')) === '1 result'), await p.textContent('#ext-status'));
ok('Install con nombre propio para el lector («Install Fake JSON»)', (await filaFalsa.locator('.ext-install').getAttribute('aria-label')) === 'Install Fake JSON');
await filaFalsa.locator('.ext-install').focus();
await p.keyboard.press('Shift+Tab');
const nombreBtn = await activo();
ok('Shift+Tab desde Install: el nombre, que es un botón de detalle plegado', nombreBtn.cls === 'ext-name' && (await p.evaluate(() => document.activeElement.getAttribute('aria-expanded'))) === 'false', JSON.stringify(nombreBtn));
await p.keyboard.press('Enter');
const detalleAbierto = await hasta(() => p.evaluate(() => { const b = document.activeElement, d = document.getElementById(b.getAttribute('aria-controls')); return b.getAttribute('aria-expanded') === 'true' && d && !d.hidden && /Nothing in this extension/.test(d.textContent) && d.textContent; }));
ok('Enter: el detalle se despliega (aria-expanded) y dice qué aplicaría, también lo de JSON', !!detalleAbierto && /Not applied: json grammar/.test(detalleAbierto), String(detalleAbierto));
// (isDisabled() de Playwright cuenta aria-disabled como deshabilitado: aquí se
// mira la propiedad del DOM, que es la que le quitaría el foco)
const inst = await filaFalsa.locator('.ext-install').evaluate(b => { b.focus(); return { aria: b.getAttribute('aria-disabled'), disabled: b.disabled, foco: document.activeElement === b }; });
ok('…y como no aplicaría nada, Install queda inerte pero enfocable (aria-disabled, no disabled)', inst.aria === 'true' && !inst.disabled && inst.foco, JSON.stringify(inst));
const fichaTema = filaMedio.locator('.ext-theme-chips .ext-chip').first();
await hasta(async () => (await fichaTema.getAttribute('aria-pressed')) === 'true');
await p.click('#ext-panel .ext-search .ext-chip[data-cat="Themes"]');
await hasta(async () => (await p.getAttribute('#ext-panel .ext-search .ext-chip[data-cat="Themes"]', 'aria-pressed')) === 'true');
await hasta(async () => (await filaFalsa.count()) === 1);
ok('pulsar una categoría no le quita el «on» a la ficha del tema actual', (await fichaTema.getAttribute('class')).includes(' on') && (await fichaTema.getAttribute('aria-pressed')) === 'true', await fichaTema.getAttribute('class'));
await p.click('#ext-panel .ext-search .ext-chip[data-cat="Themes"]');      // fuera la categoría (la búsqueda en vivo va sin ella)
await hasta(async () => (await p.getAttribute('#ext-panel .ext-search .ext-chip[data-cat="Themes"]', 'aria-pressed')) === 'false');
await ctx.unroute('https://open-vsx.org/api/**');

// J7. gramática hostil: Object.prototype intacto, y las demás gramáticas bien
await instalaFichero('elfscript.vsix', elfscriptVsix());
const msgEvil = await instalaFichero('evil.vsix', hostileGrammarVsix());
ok('gramática hostil instalada (avisa del scopeName «__proto__» rechazado)', msgEvil === '“Evil Grammar” installed. 1 part could not be used.', msgEvil);
await p.click('#settings-close');
const prototipo = () => p.evaluate(() => JSON.stringify({ proto: ({}).id ?? null, propia: Object.prototype.hasOwnProperty('id'), object: Object.id ?? null, toStr: Object.prototype.toString.id ?? null, enumerables: (() => { const k = []; for (const x in {}) k.push(x); return k; })() }));
const INTACTO = '{"proto":null,"propia":false,"object":null,"toStr":null,"enumerables":[]}';
await abre('a.evil');
ok('a.evil → evilscript', await hasta(async () => (await lenguaje()) === EVIL.lang), await lenguaje());
const tiposEvil = () => p.evaluate(() => window.monaco.editor.tokenize('evil ctor (x)', 'evilscript')[0].map(t => t.type));
ok('la gramática hostil pinta lo legítimo (#kw y la regla llamada «constructor»)', await hasta(async () => { const t = await tiposEvil(); return t.includes('keyword.control.evil') && t.includes('entity.name.function.ctor.evil'); }), JSON.stringify(await tiposEvil()));
ok('tras abrirlo: Object.prototype intacto ({}.id undefined, nada enumerable)', (await prototipo()) === INTACTO, await prototipo());
await abre('notes.elfs');
ok('…y las otras gramáticas compilan bien después («spell» → keyword.control.elfs)', await hasta(async () => (await p.evaluate(() => window.monaco.editor.tokenize('spell fire', 'elfscript')[0].map(t => t.type))).includes('keyword.control.elfs')));
// el tema con un ámbito «hasOwnProperty» ya no tumba el motor
await abrePanel();
await filaInstalada('elffuss-test.evil').locator('.ext-theme-chips .ext-chip').first().click();
await p.click('#settings-close');
await abre('a.evil');
ok('tema con ámbito «hasOwnProperty»: se aplica y la gramática sigue con sus colores', await colorDe('evil', EVIL.kw) && await colorDe('ctor', EVIL.ctor), JSON.stringify([await estilo('evil'), await estilo('ctor')]));
// lo guardado ANTES de sanear al instalar: se sanea también al cargar
await p.evaluate(async raw => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open('elffuss-code-ext'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const rec = await new Promise(res => { const q = db.transaction('ext').objectStore('ext').get('elffuss-test.evil'); q.onsuccess = () => res(q.result); });
  const key = rec.grammars.find(g => g.scopeName === 'source.evil').key;
  await new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(JSON.parse(raw), key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
}, EVIL_GRAMMAR);
await p.reload({ waitUntil: 'domcontentloaded' });
await hasta(() => p.evaluate(() => !!window.monaco?.editor?.getEditors?.().length));
await abre('a.evil');
ok('gramática hostil guardada sin sanear: al cargarla, Object.prototype sigue intacto', await hasta(async () => (await tiposEvil()).includes('keyword.control.evil')) && (await prototipo()) === INTACTO, await prototipo());

// J8. snippets: el detalle no pide nada a ningún servidor
const BALIZA = 'http://127.0.0.1:8993';          // nadie escucha: basta con ver si el navegador lo pide
await abrePanel();
await instalaFichero('beacon.vsix', beaconSnippetVsix(BALIZA));
await p.click('#settings-close');
await abre('app.js');
await ponTexto('');
pedidas.length = 0;
await p.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.setPosition({ lineNumber: 1, column: 1 }); ed.focus(); });
await p.keyboard.type('zzbea');
await p.evaluate(() => window.monaco.editor.getEditors()[0].trigger('t', 'editor.action.triggerSuggest', {}));
await hasta(() => p.evaluate(() => [...document.querySelectorAll('.suggest-widget.visible .monaco-list-row')].some(r => r.textContent.includes('zzbeacon'))));
const detalleSnip = () => p.evaluate(() => { const d = document.querySelector('.suggest-details'); return d && d.getClientRects().length && d.textContent.includes('body.png') ? { imgs: d.querySelectorAll('img').length, enlaces: d.querySelectorAll('a').length, texto: d.textContent } : null; });
if (!(await hasta(detalleSnip, { tiempo: 2000 }))) await p.evaluate(() => window.monaco.editor.getEditors()[0].trigger('t', 'toggleSuggestionDetails', {}));
const snip = await hasta(detalleSnip);
ok('snippet: el detalle enseña descripción y cuerpo como texto', !!snip && snip.texto.includes(`![d](${BALIZA}/desc.png)`) && snip.texto.includes('```'), JSON.stringify(snip));
ok('…sin imágenes ni enlaces', !!snip && snip.imgs === 0 && snip.enlaces === 0, JSON.stringify(snip && { imgs: snip.imgs, enlaces: snip.enlaces }));
await sleep(600);
ok('…y el navegador no pidió nada al servidor de la extensión', !pedidas.some(u => u.startsWith(BALIZA)), pedidas.filter(u => u.startsWith(BALIZA)).join(' '));
await p.keyboard.press('Escape');

// J9. expresiones que no terminan: la pestaña sigue viva
await abrePanel();
await instalaFichero('slow.vsix', slowRegexVsix());
const filaSlow = filaInstalada('elffuss-test.slow');
await filaSlow.locator('details.ext-warn summary').click();
const avisosSlow = await filaSlow.locator('details.ext-warn').innerText();
ok('expresiones con repetición anidada: descartadas y avisadas', /2 parts could not be used/.test(avisosSlow) && avisosSlow.includes('Expression discarded in nestlang, it could freeze the tab: ^(a+)+$') && avisosSlow.includes('(a+)+$'), avisosSlow.replace(/\s+/g, ' '));
await p.click('#settings-close');
const abierto = await Promise.race([abre('slow-input').then(() => 'ok'), sleep(20000).then(() => 'COLGADO')]);
const vivo = abierto === 'ok' && await Promise.race([p.evaluate(() => 1), sleep(5000).then(() => 0)]) === 1;
ok('firstLine que no termina (^(.|\\s)*z con 64 espacios): el fichero se abre y la pestaña responde', vivo, abierto);
if (!vivo) { console.log('\n❌ la página se quedó colgada: no se puede seguir'); await b.close(); process.exit(1); }
ok('…como texto plano', (await lenguaje()) === 'plaintext', await lenguaje());
await abre('runme');
ok('…y las otras firstLine siguen funcionando (#!/usr/bin/env elfs → elfscript)', await hasta(async () => (await lenguaje()) === 'elfscript'), await lenguaje());

// J10. menús: View en escritorio y «/» en pantalla estrecha
await p.click('#menubar button[data-menu="view"]');
const menuView = await p.locator('#topmenu .menu-item b').allInnerTexts();
ok('menú View: «Extensions…» y «Color Theme…»', menuView.includes('Extensions…') && menuView.includes('Color Theme…'), menuView.join(' | '));
await p.locator('#topmenu .menu-item', { hasText: 'Extensions…' }).click();
ok('…y «Extensions…» abre el panel', await hasta(() => p.evaluate(() => !!document.getElementById('ext-panel')?.isConnected && !document.getElementById('settings-panel').hidden)));
await p.click('#settings-close');
const tamaño = p.viewportSize();
await p.setViewportSize({ width: 700, height: 800 });
ok('a 700 px no se ven ni la barra de actividad ni el menú', await p.evaluate(() => !document.getElementById('act-ext').getClientRects().length && !document.getElementById('menubar').getClientRects().length));
await p.click('#btn-slash');
const menuSlash = await p.locator('#menu .menu-item b').allInnerTexts();
ok('…pero el menú «/» del chat trae /extensions y /theme', menuSlash.includes('/extensions') && menuSlash.includes('/theme'), menuSlash.join(' '));
await p.locator('#menu .menu-item', { hasText: '/extensions' }).click();
ok('…y /extensions abre el panel', await hasta(() => p.evaluate(() => !!document.getElementById('ext-panel')?.isConnected && !document.getElementById('settings-panel').hidden)));
await p.keyboard.press('Escape');
await p.setViewportSize(tamaño);

// J11. fuera todo lo de esta sección
await p.evaluate(async () => { const host = await (await import('/js/ide.js')).loadExt(); for (const e of host.list()) await host.uninstall(e.id); await host.setTheme('vs-dark'); });
await abrePanel();
ok('J: todo desinstalado', (await p.locator('#ext-installed .ext-row').count()) === 0);

// ── I. EN VIVO contra Open VSX ──
const red = await p.evaluate(async () => { try { return (await fetch('https://open-vsx.org/api/vscode/theme-monokai', { credentials: 'omit' })).ok; } catch { return false; } });
if (!red) {
  notRun('instalación en vivo desde Open VSX', 'sin acceso a open-vsx.org');
} else {
  await p.fill('#ext-q', 'monokai');
  const fila = p.locator('#ext-results .ext-row[data-id="vscode.theme-monokai"]');
  ok('Open VSX: búsqueda con resultados', await hasta(async () => (await fila.count()) === 1, { tiempo: 20000 }));
  await fila.locator('.ext-main').click();
  ok('Open VSX: el detalle dice qué aplicaría (sin bajar el .vsix)', await hasta(async () => /1 (tema|theme)/.test(await fila.locator('.ext-detail').innerText()), { tiempo: 20000 }), await fila.locator('.ext-detail').innerText());
  await fila.locator('.ext-install').click();
  ok('Open VSX: vscode.theme-monokai instalada (SHA-256 comprobada)', await hasta(async () => (await filaInstalada('vscode.theme-monokai').count()) === 1, { tiempo: 30000 }) && /SHA-256/.test(await filaInstalada('vscode.theme-monokai').innerText()));
  await filaInstalada('vscode.theme-monokai').locator('.ext-theme-chips .ext-chip').first().click();
  ok('Monokai aplicado', await hasta(async () => (await fondo()) === 'rgb(39, 40, 34)'), await fondo());
  const r = await p.evaluate(async () => {
    const host = await (await import('/js/ide.js')).loadExt();
    try { const rec = await host.install({ namespace: 'vscode', name: 'make', version: '1.95.3' }); return rec.id; } catch (e) { return 'ERR ' + e.message; }
  });
  ok('Open VSX: vscode.make instalada', r === 'vscode.make', r);
  await p.click('#settings-close').catch(() => {});
  await abre('Makefile');
  ok('Makefile → lenguaje makefile', await hasta(async () => (await lenguaje()) === 'makefile'), await lenguaje());
  const tipos = await p.evaluate(() => window.monaco.editor.tokenize('all: build\n# c', 'makefile').flat().map(t => t.type));
  ok('Makefile: ámbitos de la gramática real', tipos.some(t => /entity\.name\.function\.target\.makefile/.test(t)) && tipos.some(t => /comment/.test(t)), tipos.join(' '));
  ok('Makefile: el objetivo con el color de función de Monokai', await colorDe('all', '#A6E22E'), JSON.stringify(await estilo('all')));
  await p.screenshot({ path: OUT + '/ext-monokai-make.png' });
  // una gramática para un lenguaje que Monaco YA tiene (JavaScript): la
  // sustituye, y al desactivarla vuelve el coloreado de serie (Monarch)
  const js = await p.evaluate(async () => {
    const host = await (await import('/js/ide.js')).loadExt();
    try { await host.install({ namespace: 'vscode', name: 'javascript', version: '1.95.3' }); return 'ok'; } catch (e) { return 'ERR ' + e.message; }
  });
  ok('Open VSX: vscode.javascript instalada', js === 'ok', js);
  await abre('app.js');
  await ponTexto('const a = 1; // x\n');
  ok('JS con la gramática TextMate de VS Code (storage.type.js)', await hasta(async () => (await p.evaluate(() => window.monaco.editor.tokenize('const a = 1;', 'javascript')[0].map(t => t.type))).includes('storage.type.js')));
  await p.evaluate(async () => { const host = await (await import('/js/ide.js')).loadExt(); await host.setEnabled('vscode.javascript', false); });
  ok('desactivarla devuelve el Monarch de serie de Monaco (keyword.js)', await hasta(async () => (await p.evaluate(() => window.monaco.editor.tokenize('const a = 1;', 'javascript')[0].map(t => t.type))).includes('keyword.js')));
  ok('…y el fichero abierto se repinta con Monokai vía Monarch', await colorDe('const', '#F92672'), JSON.stringify(await estilo('const')));
}

ok('sin errores de página', !errores.length, errores.slice(0, 3).join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ EXTENSIONES DE VS CODE (nivel 1) OK');
await b.close();
process.exit(fails ? 1 : 0);

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
import { themeVsix, elfscriptVsix, THEME_DARK } from './ext_fixtures.mjs';

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
await p.click('#ext-theme-btn');
await p.waitForSelector('#ext-themepick');
await p.keyboard.press('ArrowUp');
const previa = await hasta(async () => (await fondo()) !== rgb(THEME_DARK.bg) && fondo());
ok('selector: las flechas previsualizan', !!previa, String(previa));
await p.keyboard.press('Escape');
ok('selector: Escape deja el tema que había', await hasta(async () => (await fondo()) === rgb(THEME_DARK.bg)));
await p.click('#ext-theme-btn');
await p.waitForSelector('#ext-themepick');
await p.click('#ext-themepick .tp-item[data-theme="vs"]');
ok('selector: tema claro de serie elegido', await hasta(async () => (await fondo()) === 'rgb(255, 255, 254)'), await fondo());
ok('…y la gramática se repinta con colores de Light+', await colorDe('spell', '#AF00DB'), JSON.stringify(await estilo('spell')));
await p.reload({ waitUntil: 'domcontentloaded' });
await hasta(() => p.evaluate(() => !!window.monaco?.editor?.getEditors?.().length));
ok('el tema elegido sobrevive a la recarga', await hasta(async () => (await fondo()) === 'rgb(255, 255, 254)'), await fondo());
// por la paleta de comandos
await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
await p.fill('#pal-input', '>tema de color');
let filas = await p.locator('#pal-list .pal-item').count();
if (!filas) { await p.fill('#pal-input', '>color theme'); filas = await p.locator('#pal-list .pal-item').count(); }
ok('comando «Tema de color…» en la paleta', filas === 1);
await p.keyboard.press('Enter');
await p.waitForSelector('#ext-themepick');
await p.click(`#ext-themepick .tp-item[data-theme^="x-elffuss-test-elf-theme-elf-dark"]`);
ok('tema de la extensión elegido desde la paleta', await hasta(async () => (await fondo()) === rgb(THEME_DARK.bg)));

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

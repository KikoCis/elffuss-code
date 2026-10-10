// Enlaces del chat a ficheros, y el botón de la propuesta que sobrevive.
//
//   1. `ruta:línea` en una respuesta es un enlace de verdad (<a>, con Tab y
//      Enter) que abre el fichero EN esa línea. Antes era un <code> con un
//      onclick: solo ratón y sin línea.
//   2. La ruta de una fila de herramienta («● code.read src/app.js») y cada
//      acierto de una búsqueda («src/app.js:2: …») también se abren.
//   3. #/file/ruta:línea en la URL abre ese fichero al cargar.
//   4. «▶ Ejecutar esta propuesta» del informe del cerebro sigue ahí tras
//      recargar (antes solo vivía en el DOM del momento), y su _cursiva_ se
//      pinta como cursiva (salían los guiones bajos).
//
//   BASE=http://127.0.0.1:8898 node tests/chatlinks.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1500, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));

await p.goto(BASE + '/manifest.json');
await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const escribe = async (path, txt) => {
    const parts = path.split('/'); const name = parts.pop(); let d = root;
    for (const x of parts) d = await d.getDirectoryHandle(x, { create: true });
    const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(txt); await w.close();
  };
  await escribe('src/app.js', 'linea 1\nlinea 2 con unaPalabraRara\nlinea 3\nlinea 4\n');
});
const arranca = async (hash = '') => {
  await p.goto(BASE + '/?test-opfs' + hash, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.monaco && window.elffussClaw?.conv?.getActive?.(), null, { timeout: 30000 });
  await p.waitForTimeout(300);
};
const posicion = () => p.evaluate(() => ({ activa: document.querySelector('#tabs-bar .tab.active')?.dataset.path, linea: window.monaco?.editor?.getEditors?.()[0]?.getPosition()?.lineNumber }));
const libre = () => p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 10000 });

await arranca();

// 1 · ruta:línea en una respuesta
await p.evaluate(async () => {
  const conv = window.elffussClaw.conv;
  conv.setProvider({ chat: async () => 'Mira `src/app.js:3` y también `README.md`.' });
  window.elffussClaw.send('¿dónde está?');
});
await libre();
await p.waitForTimeout(200);
const enlace = await p.evaluate(() => { const a = [...document.querySelectorAll('#chat-log a.file-link')].find(x => x.textContent === 'src/app.js:3'); return a ? { href: a.getAttribute('href'), tab: a.tabIndex } : null; });
ok('1 · `src/app.js:3` es un enlace (<a href="#/file/…:3">)', enlace?.href === '#/file/src/app.js:3' && enlace.tab === 0, JSON.stringify(enlace));
await p.locator('#chat-log a.file-link', { hasText: 'src/app.js:3' }).focus();
await p.keyboard.press('Enter');
await p.waitForTimeout(500);
ok('1 · Enter en el enlace abre el fichero en la línea 3', JSON.stringify(await posicion()) === '{"activa":"src/app.js","linea":3}', JSON.stringify(await posicion()));

// 2 · fila de herramienta y aciertos de búsqueda (modo básico: reglas)
const reglas = await p.evaluate(async () => { const r = await import('/js/providers/rules.js'); window.elffussClaw.conv.setProvider(r); });
await p.fill('#prompt', 'busca unaPalabraRara');
await p.press('#prompt', 'Enter');
await libre();
await p.waitForTimeout(300);
const busqueda = await p.evaluate(() => [...document.querySelectorAll('#chat-log .tool-result pre a.file-link')].map(a => a.textContent));
ok('2 · cada acierto de la búsqueda es un enlace fichero:línea', busqueda.includes('src/app.js:2'), JSON.stringify(busqueda));
await p.evaluate(() => document.querySelector('#chat-log .tool-result')?.setAttribute('open', ''));
await p.locator('#chat-log .tool-result pre a.file-link', { hasText: 'src/app.js:2' }).first().click();
await p.waitForTimeout(500);
ok('2 · …y abre el fichero en esa línea', JSON.stringify(await posicion()) === '{"activa":"src/app.js","linea":2}', JSON.stringify(await posicion()));
await p.fill('#prompt', 'lee src/app.js');
await p.press('#prompt', 'Enter');
await libre();
await p.waitForTimeout(200);
const fila = await p.evaluate(() => [...document.querySelectorAll('#chat-log .msg.tool .targ a.file-link')].map(a => a.textContent));
ok('2 · la ruta de la fila de herramienta es un enlace', fila.includes('src/app.js'), JSON.stringify(fila));

// 4 · informe del cerebro con su botón, también tras recargar
await p.evaluate(async () => {
  const m = await import('/js/main.js');
  m.reportImprovements({ path: '.elffuss/soul/x.md', md: '# Propuesta\nhaz algo', proposals: [{ dept: 'Calidad', text: 'Añadir validación a la entrada del formulario.' }] });
});
await p.waitForTimeout(300);
const informe = await p.evaluate(() => { const ms = [...document.querySelectorAll('#chat-log .msg.assistant')]; const u = ms.at(-1); return { boton: !!u?.querySelector('.proposal-exec-btn'), cursiva: !!u?.querySelector('i'), crudo: /_Guardado/.test(u?.textContent || '') }; });
ok('4 · el informe trae su botón «▶ Ejecutar esta propuesta»', informe.boton, JSON.stringify(informe));
ok('4 · su _cursiva_ se pinta como cursiva (sin guiones bajos sueltos)', informe.cursiva && !informe.crudo, JSON.stringify(informe));
await arranca();
const trasRecargar = await p.evaluate(() => [...document.querySelectorAll('#chat-log .msg.assistant')].some(m => m.querySelector('.proposal-exec-btn') && /Calidad/.test(m.textContent)));
ok('4 · tras recargar, el botón sigue ahí', trasRecargar);

// 3 · #/file/ruta:línea
await arranca('#/file/src/app.js:4');
await p.waitForTimeout(600);
ok('3 · #/file/src/app.js:4 abre el fichero en la línea 4 al cargar', JSON.stringify(await posicion()) === '{"activa":"src/app.js","linea":4}', JSON.stringify(await posicion()));

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ ENLACES DEL CHAT Y BOTÓN DE PROPUESTA OK');
await b.close();
process.exit(fails ? 1 : 0);

// Teclado, Escape, menús y búsqueda: lo que antes solo iba con ratón o no iba.
//
//   1. Escape cierra la capa de arriba (menú de la barra, Modos, Historial,
//      Ajustes, vista 3D) y el foco vuelve a quien la abrió.
//   2. Barra de menús con teclado (↓ abre, →/← cambian de menú) y en el idioma
//      de la interfaz.
//   3. Git: «Último» enseña el SHA corto y enlaza el commit en el remoto (sin
//      credenciales); la rama enlaza su árbol; `git log` del terminal da el SHA.
//   4. Historial: filas que son botones, la activa marcada.
//   5. Pestañas de conversación: ←/→ cambian, Supr cierra, el menú renombra.
//   6. Modos: el botón dice qué está encendido, el menú no se cierra al tocar un
//      modo, y el texto del prompt avisa en modo Objetivo.
//   7. Paleta «#»: Edit › Buscar en el código busca DENTRO de los ficheros y
//      abre el resultado en su línea; la lupa de la barra abre la paleta.
//   8. Detalles: el medidor de contexto no promete un 🧹 que no existe, ↑ en
//      un borrador de varias líneas no lo pisa con el historial, «/new» en vez
//      de «/clear», y el terminal se redimensiona con ↑/↓.
//
//   BASE=http://127.0.0.1:8898 node tests/keyboard-ux.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1500, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));

const SHA = '3f9c2a17b04e5d6c8a9b0c1d2e3f405162738495';
await p.goto(BASE + '/manifest.json');
await p.evaluate(async (SHA) => {
  const root = await navigator.storage.getDirectory();
  const escribe = async (path, txt) => {
    const parts = path.split('/'); const name = parts.pop(); let d = root;
    for (const x of parts) d = await d.getDirectoryHandle(x, { create: true });
    const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(txt); await w.close();
  };
  await escribe('src/app.js', 'export const a = 1;\n// aquí está la palabraSecretaDePrueba\nexport const b = 2;\n');
  await escribe('README.md', '# Demo\n');
  await escribe('.git/HEAD', 'ref: refs/heads/main\n');
  await escribe('.git/logs/HEAD', `0000000000000000000000000000000000000000 ${SHA} Ana Prueba <ana@example.com> 1760000000 +0200\tcommit: arregla el login\n`);
  await escribe('.git/config', '[core]\n\tbare = false\n[remote "origin"]\n\turl = https://usuario:token123@github.com/demo-org/demo-repo.git\n');
}, SHA);
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.monaco && document.querySelector('#tree [data-path]') && window.elffussClaw?.conv?.getActive?.(), null, { timeout: 30000 });
await p.evaluate(() => { window.__abiertas = []; window.open = (u) => { window.__abiertas.push(String(u)); return null; }; });
const foco = () => p.evaluate(() => document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName);

// 2 · barra de menús
const nombres = await p.evaluate(() => [...document.querySelectorAll('#menubar button')].map(b => b.textContent));
ok('2 · la barra de menús habla el idioma de la interfaz', JSON.stringify(nombres) === '["Archivo","Editar","Ver","Git"]', JSON.stringify(nombres));
await p.locator('#menubar button[data-menu="file"]').focus();
await p.keyboard.press('ArrowDown');
await p.waitForTimeout(150);
const enMenu = await p.evaluate(() => ({ abierto: !document.getElementById('topmenu').hidden, dentro: document.getElementById('topmenu').contains(document.activeElement), expanded: document.querySelector('#menubar button[data-menu="file"]').getAttribute('aria-expanded') }));
ok('2 · ↓ en «Archivo» abre el menú con el foco en su primera opción', enMenu.abierto && enMenu.dentro && enMenu.expanded === 'true', JSON.stringify(enMenu));
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(150);
const editar = await p.evaluate(() => document.querySelector('#menubar button.open')?.dataset.menu);
ok('2 · → pasa al menú «Editar»', editar === 'edit', editar);
await p.keyboard.press('Escape');
await p.waitForTimeout(100);
const trasEsc = await p.evaluate(() => ({ cerrado: document.getElementById('topmenu').hidden, foco: document.activeElement?.dataset?.menu }));
ok('1 · Escape cierra el menú y devuelve el foco a «Editar»', trasEsc.cerrado && trasEsc.foco === 'edit', JSON.stringify(trasEsc));

// 3 · Git
await p.click('#menubar button[data-menu="git"]');
await p.waitForTimeout(250);
const git = await p.evaluate(() => [...document.querySelectorAll('#topmenu .menu-item')].map(r => ({ txt: r.textContent, title: r.title, off: r.getAttribute('aria-disabled') })));
const ultimo = git.find(g => /Último/.test(g.txt));
ok('3 · «Último» enseña el SHA corto', /3f9c2a1 · commit: arregla el login/.test(ultimo?.txt || ''), JSON.stringify(git));
ok('3 · …y enlaza el commit en el remoto, sin credenciales ni correo', ultimo?.title === `https://github.com/demo-org/demo-repo/commit/${SHA}` && !/token123|usuario|ana@/.test(JSON.stringify(git)), JSON.stringify(ultimo));
await p.locator('#topmenu .menu-item', { hasText: 'Rama: main' }).click();
ok('3 · la rama abre su árbol en el remoto', (await p.evaluate(() => window.__abiertas.at(-1))) === 'https://github.com/demo-org/demo-repo/tree/main');
ok('3 · «Redactar el mensaje de commit» en vez de prometer un commit', git.some(g => /Redactar el mensaje de commit/.test(g.txt)) && !git.some(g => /commitee/.test(g.txt)));
const logTxt = await p.evaluate(async () => { const sh = await import('/js/shell.js'); return sh.stripAnsi(await sh.exec('git log', { record: false })); });
ok('3 · `git log` del terminal da el SHA, no la rama', logTxt.includes('commit ' + SHA) && !/correo|@example/.test(logTxt), logTxt.slice(0, 120));

// 4 · Historial
await p.fill('#prompt', 'hola');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(400);
await p.click('#btn-history');
await p.waitForTimeout(300);
const hist = await p.evaluate(() => ({ botones: document.querySelectorAll('#history-panel button.hp-open').length, actual: document.querySelectorAll('#history-panel .hp-open[aria-current="true"]').length, foco: document.activeElement?.className, dialog: document.getElementById('history-panel').getAttribute('role') }));
ok('4 · el Historial es un diálogo con filas-botón y la conversación activa marcada', hist.botones >= 1 && hist.actual === 1 && hist.dialog === 'dialog' && /hp-open/.test(hist.foco || ''), JSON.stringify(hist));
await p.keyboard.press('Escape');
await p.waitForTimeout(100);
ok('1 · Escape cierra el Historial y vuelve al botón', await p.evaluate(() => document.getElementById('history-panel').hidden && document.activeElement?.id === 'btn-history'));

// 1 · Ajustes
await p.click('#btn-settings');
await p.waitForTimeout(300);
ok('1 · Ajustes es un diálogo y el foco entra en él', await p.evaluate(() => document.getElementById('settings-panel').getAttribute('role') === 'dialog' && document.getElementById('settings-panel').contains(document.activeElement)));
await p.keyboard.press('Escape');
await p.waitForTimeout(100);
ok('1 · Escape cierra Ajustes y el foco vuelve al engranaje', await p.evaluate(() => document.getElementById('settings-panel').hidden && document.activeElement?.id === 'btn-settings'));

// 1 · vista 3D (arquitectura)
await p.click('#act-arch');
await p.waitForTimeout(800);
await p.keyboard.press('Escape');
await p.waitForTimeout(150);
ok('1 · Escape cierra la vista de Arquitectura', await p.evaluate(() => document.getElementById('view-overlay').hidden));

// 6 · Modos
await p.click('#btn-modos');
await p.waitForTimeout(100);
await p.click('#btn-goal');
await p.waitForTimeout(100);
const modos = await p.evaluate(() => ({ abierto: !document.getElementById('modos-menu').hidden, boton: document.getElementById('btn-modos').textContent, aria: document.getElementById('btn-goal').getAttribute('aria-checked'), ph: document.getElementById('prompt').placeholder }));
ok('6 · tocar un modo no cierra el menú y marca aria-checked', modos.abierto && modos.aria === 'true', JSON.stringify(modos));
ok('6 · el botón «Modos» enseña 🎯 y el prompt avisa del modo Objetivo', /🎯/.test(modos.boton) && /objetivo/i.test(modos.ph), JSON.stringify(modos));
await p.keyboard.press('Escape');
await p.waitForTimeout(100);
ok('1 · Escape cierra Modos', await p.evaluate(() => document.getElementById('modos-menu').hidden));
await p.click('#btn-modos'); await p.click('#btn-goal'); await p.keyboard.press('Escape');

// 5 · pestañas de conversación
await p.locator('#conv-tabs .tab-add').dispatchEvent('click');
await p.waitForTimeout(200);
const antes = await p.evaluate(() => window.elffussClaw.conv.getActive().id);
await p.locator('#conv-tabs .tab.active').focus();
await p.keyboard.press('ArrowLeft');
await p.waitForTimeout(150);
const tras = await p.evaluate(() => ({ activa: window.elffussClaw.conv.getActive().id, role: document.querySelector('#conv-tabs .tab').getAttribute('role'), foco: document.activeElement?.getAttribute('role') }));
ok('5 · ← cambia de conversación y las pestañas son role=tab', tras.activa !== antes && tras.role === 'tab' && tras.foco === 'tab', JSON.stringify(tras));
await p.evaluate(() => { window.prompt = () => 'Mi conversación'; });
await p.keyboard.press('Shift+F10');
await p.waitForTimeout(100);
await p.locator('#conv-menu .tm-item', { hasText: 'Renombrar' }).click();
await p.waitForTimeout(250);
ok('5 · el menú de la pestaña la renombra', await p.evaluate(() => document.querySelector('#conv-tabs .tab.active .tab-name')?.textContent === 'Mi conversación'));

// 7 · paleta «#»
await p.click('#menubar button[data-menu="edit"]');
await p.locator('#topmenu .menu-item', { hasText: 'Buscar en el código' }).click();
await p.waitForTimeout(150);
const pal = await p.evaluate(() => ({ abierta: !document.getElementById('palette').hidden, valor: document.getElementById('pal-input').value, rol: document.getElementById('pal-input').getAttribute('role') }));
ok('7 · Edit › Buscar en el código abre la paleta en modo «#» (y no se cierra sola)', pal.abierta && pal.valor === '#' && pal.rol === 'combobox', JSON.stringify(pal));
await p.fill('#pal-input', '#palabraSecreta');
await p.waitForSelector('#pal-list .pal-item', { timeout: 5000 }).catch(() => {});
const hits = await p.evaluate(() => [...document.querySelectorAll('#pal-list .pal-item')].map(r => r.querySelector('.pi-hint').textContent));
ok('7 · encuentra la palabra dentro de los ficheros, como fichero:línea', hits.includes('src/app.js:2'), JSON.stringify(hits));
await p.press('#pal-input', 'Enter');
await p.waitForTimeout(500);
const abierto = await p.evaluate(() => ({ activa: document.querySelector('#tabs-bar .tab.active')?.dataset.path, linea: window.monaco?.editor?.getEditors?.()[0]?.getPosition()?.lineNumber }));
ok('7 · Enter abre el fichero en esa línea', abierto.activa === 'src/app.js' && abierto.linea === 2, JSON.stringify(abierto));
await p.click('#act-search');
await p.waitForTimeout(200);
ok('7 · la lupa de la barra abre la paleta (y se queda abierta)', await p.evaluate(() => !document.getElementById('palette').hidden));
await p.keyboard.press('Escape');

// 8 · detalles
const ctxTitulo = await p.evaluate(async () => {
  const m = await import('/js/main.js');
  m.setCtxBudget(4100);                       // 100 tokens: casi lleno
  window.elffussClaw.send('x'.repeat(600));
  await new Promise(r => setTimeout(r, 400));
  return document.getElementById('ctx-meter').title;
});
ok('8 · el medidor de contexto lleno manda a «+» y no a un 🧹 que no existe', !/🧹/.test(ctxTitulo) && /«\+»/.test(ctxTitulo), ctxTitulo);
await p.click('#prompt');
await p.fill('#prompt', '');
await p.keyboard.type('linea uno');
await p.keyboard.press('Shift+Enter');
await p.keyboard.type('linea dos');
await p.keyboard.press('ArrowUp');
ok('8 · ↑ en un borrador de varias líneas no lo cambia por el historial', (await p.inputValue('#prompt')) === 'linea uno\nlinea dos');
await p.fill('#prompt', '');
await p.click('#btn-slash');
await p.waitForTimeout(200);
const slash = await p.evaluate(() => ({ items: [...document.querySelectorAll('#menu .menu-item b')].map(b => b.textContent), foco: document.activeElement?.classList.contains('menu-item') }));
ok('8 · «/new» en vez de «/clear», y el foco entra en el menú', slash.items.includes('/new') && !slash.items.includes('/clear') && slash.foco, JSON.stringify(slash));
await p.keyboard.press('ArrowDown');
ok('8 · ↓ recorre el menú de comandos', await p.evaluate(() => document.activeElement?.textContent.startsWith('/search')));
await p.keyboard.press('Escape');
await p.waitForTimeout(100);
ok('1 · Escape cierra el menú de comandos y vuelve a la caja de texto', await p.evaluate(() => document.getElementById('menu').hidden && document.activeElement?.id === 'prompt'));
await p.click('#act-term');
await p.waitForTimeout(400);
const alto0 = await p.evaluate(() => document.getElementById('terminal-panel').offsetHeight);
await p.locator('#term-resize').focus();
await p.keyboard.press('ArrowUp');
const alto1 = await p.evaluate(() => document.getElementById('terminal-panel').offsetHeight);
ok('8 · el terminal se redimensiona con ↑ desde su separador', alto1 > alto0, `${alto0} → ${alto1}`);

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ TECLADO, ESCAPE, MENÚS Y BÚSQUEDA OK');
await b.close();
process.exit(fails ? 1 : 0);

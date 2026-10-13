// La vista (ciudad o arquitectura) tapa el editor. Si con ella abierta el
// usuario abre OTRA cosa, la vista se cierra: antes esa otra cosa se abría
// debajo, inerte, y parecía rota. La CONSOLA es la excepción: si está abierta
// nada se le pone encima, así que convive con la vista, que termina sobre ella.
//
// Control: sin hacer nada, la ciudad sigue abierta. Sin él, un test que la
// cerrara siempre pasaría igual.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(BASE + '/?test-opfs');
await p.waitForFunction(() => !!document.querySelector('#editor .monaco-editor'), null, { timeout: 30000 });
await p.evaluate(async () => {
  const r = await navigator.storage.getDirectory();
  const f = await r.getFileHandle('a.js', { create: true }); const w = await f.createWritable(); await w.write('x'); await w.close();
  const c = await import('/js/tools/code.js'); await c.openProject(r);
  await (await import('/js/ide.js')).refreshTree();
});
await p.waitForTimeout(500);

const estado = () => p.evaluate(() => {
  const t = document.getElementById('terminal-panel'), r = t.getBoundingClientRect();
  let tapada = null;
  if (r.height) { let e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); tapada = true; while (e) { if (e === t) { tapada = false; break; } e = e.parentElement; } }
  return { ciudad: !document.getElementById('view-overlay').hidden, consola: !t.hidden, consolaInerte: t.inert, consolaTapada: tapada, editorInerte: document.getElementById('editor').inert };
});
const abreCiudad = async () => { await p.click('#act-city'); await p.waitForFunction(() => !document.getElementById('view-overlay').hidden, null, { timeout: 10000 }); await p.waitForTimeout(600); };
const limpia = () => p.evaluate(() => {
  if (!document.getElementById('view-overlay').hidden) document.getElementById('view-close').click();
  if (!document.getElementById('terminal-panel').hidden) document.getElementById('term-close').click();
  document.getElementById('settings-panel').hidden = true;
  document.getElementById('palette')?.setAttribute('hidden', '');
});

// control: sin tocar nada, la ciudad no se cierra sola
await abreCiudad();
await p.waitForTimeout(1500);
ok('⊕ control: sin hacer nada, la ciudad sigue abierta', (await estado()).ciudad);
await limpia(); await p.waitForTimeout(300);

// la consola convive con la vista y NADA la tapa
for (const [nombre, accion] of [
  ['el botón', () => p.click('#act-term')],
  ['Ctrl+`', () => p.keyboard.press('Control+`')],
]) {
  await abreCiudad();
  await accion();
  await p.waitForTimeout(700);
  const e = await estado();
  ok(`con la ciudad abierta, la consola (${nombre}) se ve entera y usable, y la ciudad sigue`, e.ciudad && e.consola && !e.consolaInerte && e.consolaTapada === false, JSON.stringify(e));
  await limpia(); await p.waitForTimeout(300);
}
// y al revés: con la consola abierta, abrir la ciudad tampoco la tapa
await p.click('#act-term'); await p.waitForTimeout(600);
await abreCiudad();
{ const e = await estado(); ok('con la consola abierta, abrir la ciudad no la tapa', e.ciudad && e.consola && !e.consolaInerte && e.consolaTapada === false, JSON.stringify(e)); }
await limpia(); await p.waitForTimeout(300);

for (const [nombre, accion] of [
  ['la paleta de búsqueda', () => p.keyboard.press(process.platform === 'darwin' ? 'Meta+p' : 'Control+p')],
  ['los ajustes', () => p.click('#act-settings')],
  ['las extensiones', () => p.click('#act-ext')],
  ['un fichero del árbol', async () => {
    // el explorador alterna: se abre solo si está cerrado
    await p.evaluate(() => { const sb = document.getElementById('sidebar'); if (getComputedStyle(sb).display === 'none') document.getElementById('act-files').click(); });
    await p.locator('#tree .file').first().click();
  }],
]) {
  await abreCiudad();
  await accion();
  await p.waitForTimeout(700);
  const e = await estado();
  ok(`con la ciudad abierta, abrir ${nombre} la cierra`, !e.ciudad, JSON.stringify(e));
  await limpia(); await p.waitForTimeout(300);
}

ok('sin errores de página', !errs.length, errs.join(' | '));
await b.close();
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\nTodo en verde');
process.exit(fails ? 1 : 0);

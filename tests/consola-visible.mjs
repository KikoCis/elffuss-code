// La consola no puede quedar tapada por las capas del editor. El aviso de «sin
// ficheros» y la vista previa de Markdown se estiraban hasta la barra de estado
// y, con la consola abierta, el clic en la consola caía en el aviso.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
p.on('pageerror', e => { console.log('❌ pageerror: ' + e.message); fails++; });
await p.goto(BASE + '/?test-opfs');
await p.waitForFunction(() => !!document.querySelector('#editor .monaco-editor'), null, { timeout: 30000 });
await p.waitForTimeout(500);

const aviso = () => p.evaluate(() => {
  const e = document.getElementById('editor-empty'), w = document.getElementById('editor-wrap');
  return { visible: getComputedStyle(e).display !== 'none', fondo: Math.round(w.getBoundingClientRect().bottom - e.getBoundingClientRect().bottom) };
});
const a0 = await aviso();
ok('⊕ control: el aviso vacío está a la vista (es la capa que tapaba)', a0.visible);

await p.click('#act-term');
await p.waitForTimeout(800);
const r = await p.evaluate(() => {
  const t = document.getElementById('terminal-panel').getBoundingClientRect();
  const quien = (x, y) => { let el = document.elementFromPoint(x, y); while (el) { if (el.id === 'terminal-panel') return true; el = el.parentElement; } return false; };
  return {
    alto: Math.round(t.height),
    centro: quien(t.left + t.width / 2, t.top + t.height / 2),
    arriba: quien(t.left + t.width / 2, t.top + 12),
  };
});
ok('⊕ control: la consola se ha abierto con altura', r.alto > 50, `${r.alto}px`);
ok('el centro de la consola es la consola, no una capa encima', r.centro);
ok('su cabecera también', r.arriba);

await p.click('#term-close');
await p.waitForTimeout(400);
const a1 = await aviso();
ok('al cerrarla, el aviso vuelve a llegar hasta la barra de estado', a1.visible && a1.fondo <= 23, `deja ${a1.fondo}px abajo`);

await b.close();
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\nTodo en verde');
process.exit(fails ? 1 : 0);

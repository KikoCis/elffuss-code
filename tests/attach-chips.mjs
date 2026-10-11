// Lo adjuntado con @ se ve como fichas encima de la caja, cada una con su ×.
// Antes el adjunto era solo texto dentro del mensaje: para saber qué iba
// adjunto había que leerlo, y para quitarlo, encontrarlo y borrarlo a mano.
//
//   BASE=http://localhost:8799 node tests/attach-chips.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await p.goto(BASE + '/manifest.json');
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (path, txt) => { const parts = path.split('/'); const name = parts.pop(); let d = o; for (const x of parts) d = await d.getDirectoryHandle(x, { create: true }); const f = await d.getFileHandle(name, { create: true }); const s = await f.createWritable(); await s.write(txt); await s.close(); };
  await w('README.md', '# demo');
  await w('src/app.js', 'export const app = 1;');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 20000 });
const fichas = () => p.evaluate(() => ({
  oculto: document.getElementById('attach-chips').hidden,
  fichas: [...document.querySelectorAll('#attach-chips .attach-chip')].map(c => c.firstChild.textContent),
  quitar: [...document.querySelectorAll('#attach-chips .attach-chip button')].map(b => b.getAttribute('aria-label')),
  texto: document.getElementById('prompt').value,
}));
const elige = async (frag, ruta) => {
  await p.focus('#prompt');
  await p.keyboard.type(frag);
  await p.locator('#menu .menu-item', { hasText: '@' + ruta }).first().click();
};

ok('sin adjuntos no hay fichas', (await fichas()).oculto);
await p.focus('#prompt'); await p.keyboard.type('mira ');
await elige('@app', 'src/app.js');
let f = await fichas();
ok('adjuntar con @ pone una ficha con la ruta', !f.oculto && JSON.stringify(f.fichas) === '["@src/app.js"]' && /@src\/app\.js/.test(f.texto), JSON.stringify(f));
ok('  …y su × dice qué quita', f.quitar[0] === 'Quitar @src/app.js del mensaje', JSON.stringify(f.quitar));
await p.keyboard.type('y ');
await elige('@READ', 'README.md');
f = await fichas();
ok('dos adjuntos, dos fichas', JSON.stringify(f.fichas) === '["@src/app.js","@README.md"]', JSON.stringify(f));
await p.locator('#attach-chips .attach-chip button').first().click();
f = await fichas();
ok('× quita la ficha Y la @ruta del mensaje', JSON.stringify(f.fichas) === '["@README.md"]' && !/@src\/app\.js/.test(f.texto) && /@README\.md/.test(f.texto), JSON.stringify(f));
ok('  …y el foco vuelve a la caja', await p.evaluate(() => document.activeElement?.id) === 'prompt');
// borrar la @ruta a mano también se lleva su ficha
await p.evaluate(() => { const t = document.getElementById('prompt'); t.value = t.value.replace('@README.md', ''); t.dispatchEvent(new Event('input')); });
f = await fichas();
ok('borrar la @ruta a mano también quita su ficha', f.oculto && f.fichas.length === 0, JSON.stringify(f));
// al enviar, las fichas se van con el mensaje
await elige('@app', 'src/app.js');
await p.keyboard.press('Enter');
await p.waitForTimeout(400);
f = await fichas();
ok('al enviar, las fichas se van con el mensaje', f.oculto && f.texto === '', JSON.stringify(f));

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ ADJUNTOS COMO FICHAS QUE SE QUITAN');
await b.close();
process.exit(fails ? 1 : 0);

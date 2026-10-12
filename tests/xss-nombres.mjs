// Un nombre de fichero HOSTIL no puede convertirse en HTML en el menú del «@».
//
// Por qué un directorio falso y no OPFS: OPFS no admite nombres con «<», «>» ni
// «=» («Name is not allowed»), pero un proyecto real se abre desde el disco con
// el selector de carpetas, y ahí sí pueden existir. El recorrido del proyecto
// solo usa `values()` con `kind` y `name`, así que un directorio falso con esos
// nombres ejercita exactamente el mismo camino que un disco real.
//
// Controles: el nombre hostil tiene que estar en el proyecto (si no, el test no
// prueba nada) y el menú tiene que abrirse con filas.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
p.on('pageerror', e => { console.log('❌ pageerror: ' + e.message); fails++; });

const ejecutado = [];
await p.exposeFunction('__xss', d => { ejecutado.push(d); });
await p.addInitScript(() => { window.__marcaXss = () => window.__xss('onerror'); });

const HOSTIL = '<img src=x onerror=window.__marcaXss()>.js';
const OTRO = '<b onmouseover=window.__marcaXss()>negrita</b>.txt';

await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);

// Directorio falso con nombres hostiles. Solo implementa lo que recorre el código.
const abierto = await p.evaluate(async ({ a, c }) => {
  const fichero = n => ({ kind: 'file', name: n, async getFile() { return new File(['// x'], n); } });
  const raiz = {
    kind: 'directory', name: 'proyecto',
    async *values() { for (const n of [a, c, 'normal.js']) yield fichero(n); },
    async getDirectoryHandle() { throw new Error('no hace falta'); },
    async getFileHandle(n) { return fichero(n); },
  };
  const code = await import('/js/tools/code.js');
  return await code.openProject(raiz);
}, { a: HOSTIL, c: OTRO });
ok('⊕ control: el proyecto con nombres hostiles se ha abierto', abierto === 'proyecto', `devuelto: ${abierto}`);

await p.click('#prompt');
await p.keyboard.type('@');
await p.waitForTimeout(900);

const m = await p.evaluate(() => {
  const menu = document.getElementById('menu');
  return {
    oculto: menu.hidden,
    textos: [...menu.querySelectorAll('.menu-item')].map(x => x.textContent),
    etiquetasInyectadas: menu.querySelectorAll('.menu-item img, .menu-item b b, .menu-item [onerror], .menu-item [onmouseover]').length,
  };
});

ok('⊕ control: el menú del «@» está abierto y con filas', !m.oculto && m.textos.length > 0, `${m.textos.length} filas`);
ok('el nombre hostil aparece como TEXTO, con sus caracteres intactos',
   m.textos.some(x => x.includes('<img src=x onerror=')), (m.textos.find(x => x.includes('img')) || m.textos[0] || '').slice(0, 70));
ok('no se ha inyectado NINGUNA etiqueta en la fila', m.etiquetasInyectadas === 0, `${m.etiquetasInyectadas} etiqueta(s)`);

await p.hover('.menu-item').catch(() => {});
await p.waitForTimeout(500);
ok('NADA se ha ejecutado', ejecutado.length === 0, ejecutado.join(', ') || 'ninguna llamada');

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ un nombre de fichero hostil se queda en texto');
await b.close();
process.exit(fails ? 1 : 0);

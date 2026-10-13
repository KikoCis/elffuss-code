// Al arrancar sin ficheros abiertos, el editor muestra el aviso de «sin
// ficheros» y no el documento vacío de Monaco con un «1». Al abrir un fichero
// el aviso desaparece, y al cerrar la última pestaña vuelve.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
p.on('pageerror', e => { console.log('❌ pageerror: ' + e.message); fails++; });
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });

// Esperar a que Monaco exista: si no, «no hay aviso» no prueba nada.
const listo = await p.waitForFunction(() => !!document.querySelector('#editor .monaco-editor'), null, { timeout: 30000 }).then(() => true, () => false);
ok('⊕ control: Monaco se ha montado', listo);

const visible = () => p.evaluate(() => {
  const el = document.getElementById('editor-empty');
  return !!el && getComputedStyle(el).display !== 'none' && el.offsetHeight > 0;
});
ok('al arrancar sin ficheros se ve el aviso, no el documento en blanco', await visible());

// Abrir un fichero lo quita.
await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const fh = await root.getFileHandle('hola.js', { create: true });
  const w = await fh.createWritable(); await w.write('export const a = 1;\n'); await w.close();
  const code = await import('/js/tools/code.js');
  await code.openProject(root);
  const ide = await import('/js/ide.js');
  await ide.openFile('hola.js');
});
await p.waitForTimeout(300);
ok('al abrir un fichero el aviso desaparece', !(await visible()));

await b.close();
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\nTodo en verde');
process.exit(fails ? 1 : 0);

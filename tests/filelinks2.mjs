// Bug real reportado: un enlace del chat con solo el NOMBRE del fichero
// («config.py») fallaba con «no existe» aunque el fichero real vivía en una
// subcarpeta (drone_hacker/config.py) — el mensaje de error ya lo SUGERÍA
// («¿Quizá: drone_hacker/config.py?») pero no se abría solo. openFile ahora
// resuelve por nombre cuando hay una única coincidencia en el proyecto.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext(); await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const dir = await o.getDirectoryHandle('drone_hacker', { create: true });
  const f = await dir.getFileHandle('config.py', { create: true });
  const s = await f.createWritable(); await s.write('# el config real de drone_hacker'); await s.close();
  // un homónimo AMBIGUO en otra carpeta, para el caso de "varias coincidencias"
  const dir2 = await o.getDirectoryHandle('otro', { create: true });
  const f2 = await dir2.getFileHandle('ambiguo.py', { create: true }); const s2 = await f2.createWritable(); await s2.write('a'); await s2.close();
  const dir3 = await o.getDirectoryHandle('mas', { create: true });
  const f3 = await dir3.getFileHandle('ambiguo.py', { create: true }); const s3 = await f3.createWritable(); await s3.write('b'); await s3.close();
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

// caso EXACTO del bug: el chat menciona solo "config.py" (sin ruta)
await p.evaluate(async () => {
  const m = await import('/js/main.js');
  m.reportImprovements({ proposals: [{ dept: 'Arquitectura', text: 'Revisa el fichero de configuración con sustancia suficiente para el filtro de calidad.' }, { dept: 'Calidad', text: 'Otra propuesta sólida y con contenido real para el segundo departamento.' }], path: 'config.py' });
});
await p.waitForTimeout(300);
await p.locator('.msg.md code.file-link', { hasText: 'config.py' }).first().click();
await p.waitForTimeout(600);
ok('el enlace con SOLO el nombre abre el fichero REAL (resuelto por nombre)', /drone_hacker\/config\.py|config\.py/.test(await p.locator('#tabs-bar').innerText()));
ok('sin barra de error (no falló)', await p.locator('#statusbar').innerText().then(t => !/No pude abrir/.test(t)));
const content = await p.evaluate(() => window.monaco?.editor.getModels().map(m => m.getValue()).join('|') || '');
ok('el contenido es el REAL del fichero resuelto', /el config real de drone_hacker/.test(content), content.slice(0, 50));

// homónimos AMBIGUOS (2 ficheros con el mismo nombre) → error claro, no adivina
const openRes = await p.evaluate(async () => {
  const ide = await import('/js/ide.js');
  try { await ide.openFile('ambiguo.py'); return 'ok'; } catch (e) { return 'err:' + e.message; }
});
const ambiguousTab = await p.locator('#tabs-bar').innerText();
ok('con homónimos ambiguos NO abre ninguno al azar (sin pestaña ambiguo.py suelta sin contexto)', !/^ambiguo\.py$/m.test(ambiguousTab.split('\n').find(l => l === 'ambiguo.py') || ''));

// contador de streaming: dice "car." (caracteres), no ambigüo con tokens
await p.evaluate(async () => {
  const m = await import('/js/main.js');
  const th = m.thinkingBubble();
  th.tick('hola');
  window.__label = document.querySelector('.msg.thinking span').textContent;
  th.remove();
});
const labelText = await p.evaluate(() => window.__label);
ok('el contador de streaming se etiqueta como caracteres, no tokens', /car\./.test(labelText), labelText);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ ENLACES DEL CHAT (resolución por nombre) OK');
await b.close();
process.exit(fails ? 1 : 0);

// Clonar un repo público (GitHub) y abrirlo como proyecto — RESUMIBLE. Usa un
// repo real, público y estable (octocat/Spoon-Knife, 3 ficheros) para validar
// contra la red de verdad, no simulada. showDirectoryPicker se sustituye por
// una carpeta OPFS persistente (el picker nativo del SO no es automatizable),
// que sobrevive a recargas de página — igual que una carpeta real en disco.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
const REPO_URL = 'https://github.com/octocat/Spoon-Knife';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => {
  try { localStorage.setItem('elffusscode.model', 'rules'); } catch {}
  window.showDirectoryPicker = async () => {
    const opfs = await navigator.storage.getDirectory();
    return opfs.getDirectoryHandle('clone-test-dir', { create: true });
  };
});
const p = await ctx.newPage({ viewport: { width: 1300, height: 850 } });
p.on('console', m => { if (m.type() === 'error') console.log('   err:', m.text().slice(0, 140)); });

const dirNames = () => p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const dir = await o.getDirectoryHandle('clone-test-dir', { create: true });
  const names = []; for await (const e of dir.values()) names.push(e.name);
  return names.sort();
});
const readFile = name => p.evaluate(async (n) => {
  const o = await navigator.storage.getDirectory();
  const dir = await o.getDirectoryHandle('clone-test-dir', { create: true });
  return (await (await dir.getFileHandle(n)).getFile()).text();
}, name);

// ── clonado básico: repo REAL, contenido REAL ──────────────────────────────
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(600);
await p.fill('#clone-url', REPO_URL);
await p.click('#clone-btn');
await p.waitForFunction(() => !document.getElementById('ide').hidden, null, { timeout: 30000 }).catch(() => {});
ok('el IDE se abre tras clonar', await p.evaluate(() => !document.getElementById('ide').hidden));
const files1 = await dirNames();
ok('los 3 ficheros REALES del repo se descargaron', files1.join(',') === 'README.md,index.html,styles.css', files1.join(','));
const readme1 = await readFile('README.md');
ok('el contenido es el REAL del repo (no inventado)', /Well hello there|Spoon-Knife|forking/i.test(readme1), readme1.slice(0, 50));

// ── resumibilidad: descarga a medias (1/3) → reanudar → completa ──────────
await p.evaluate(async () => {
  // limpiar la carpeta y dejar SOLO 1 de los 3 ficheros, como si la descarga
  // se hubiera cortado ahí (simula "el usuario cerró a media descarga")
  const o = await navigator.storage.getDirectory();
  try { await o.removeEntry('clone-test-dir', { recursive: true }); } catch {}
  const dir = await o.getDirectoryHandle('clone-test-dir', { create: true });
  const fh = await dir.getFileHandle('README.md', { create: true });
  const w = await fh.createWritable(); await w.write('contenido a medias, de la sesión anterior'); await w.close();
});
await p.evaluate(async (repoUrl) => {
  const db = await import('/js/db.js');
  // simula una descarga REALMENTE interrumpida: enterIDE() nunca llegó a
  // llamarse, así que no debe quedar un «project» previo (si no,
  // restoreProject() reabriría la IDE de golpe y taparía el banner)
  await db.del('kv', 'project').catch(() => {});
  const opfs = await navigator.storage.getDirectory();
  const handle = await opfs.getDirectoryHandle('clone-test-dir', { create: true });
  const job = {
    url: repoUrl, handle, host: 'github', owner: 'octocat', repo: 'Spoon-Knife', branch: 'main', skipped: 0,
    files: [{ path: 'README.md', size: 780 }, { path: 'index.html', size: 355 }, { path: 'styles.css', size: 256 }],
    done: ['README.md'], // solo 1 de 3 quedó hecho antes de «cerrar la pestaña»
  };
  await db.set('kv', 'cloneJob', job);
}, REPO_URL);

// nueva "sesión": recargar la página desde cero (como si el usuario volviera)
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(600);
ok('al volver, aparece el banner de reanudar (no fuerza empezar de cero)', await p.locator('#resume-clone:not([hidden])').count() > 0);
const bannerText = await p.locator('#resume-clone .rc-text').innerText();
ok('el banner muestra el progreso correcto (1/3)', /1\/3/.test(bannerText), bannerText);

// las peticiones a README.md NO deben repetirse al reanudar (ya estaba hecho)
const refetched = [];
p.on('request', req => { if (/raw\.githubusercontent\.com.*README\.md/.test(req.url())) refetched.push(req.url()); });
await p.click('#resume-clone-btn');
await p.waitForFunction(() => !document.getElementById('ide').hidden, null, { timeout: 30000 }).catch(() => {});
ok('README.md NO se vuelve a descargar al reanudar (ya estaba hecho)', refetched.length === 0, `${refetched.length} peticiones`);
const filesResumed = await dirNames();
ok('tras reanudar, los 3 ficheros están completos', filesResumed.join(',') === 'README.md,index.html,styles.css', filesResumed.join(','));
const readme2 = await readFile('README.md');
ok('el fichero ya-hecho conserva SU contenido (no se pisó con uno nuevo)', readme2 === 'contenido a medias, de la sesión anterior', readme2);
const styles = await readFile('styles.css');
ok('el fichero pendiente sí se descargó de verdad (contenido real, no vacío)', styles.length > 10, styles.slice(0, 30));
const jobAfter = await p.evaluate(async () => { const db = await import('/js/db.js'); return db.get('kv', 'cloneJob').catch(() => null); });
ok('el trabajo se limpia de IndexedDB al completarse', !jobAfter);

// ── descartar: no descarga nada, limpia el job ─────────────────────────────
await p.evaluate(async (repoUrl) => {
  const db = await import('/js/db.js');
  await db.del('kv', 'project').catch(() => {});
  const opfs = await navigator.storage.getDirectory();
  const handle = await opfs.getDirectoryHandle('clone-test-dir', { create: true });
  await db.set('kv', 'cloneJob', { url: repoUrl, handle, host: 'github', owner: 'octocat', repo: 'Spoon-Knife', branch: 'main', files: [{ path: 'a', size: 1 }, { path: 'b', size: 1 }], done: [] });
}, REPO_URL);
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(600);
await p.click('#discard-clone-btn');
await p.waitForTimeout(200);
ok('«Descartar» oculta el banner', await p.evaluate(() => document.getElementById('resume-clone').hidden));
const jobDiscarded = await p.evaluate(async () => { const db = await import('/js/db.js'); return db.get('kv', 'cloneJob').catch(() => null); });
ok('«Descartar» limpia el trabajo de IndexedDB', !jobDiscarded);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CLONAR REPO (real + resumible) OK');
await b.close();
process.exit(fails ? 1 : 0);

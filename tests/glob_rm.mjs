// Bug real visto en producción: `rm mejoras-*.md` decía «no existe» aunque
// había decenas de ficheros coincidentes, porque rm buscaba el nombre LITERAL
// con el asterisco en vez de expandir el comodín. La elfa concluía (mal) que
// los ficheros no existían y no los borraba.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext(); await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const dir = await o.getDirectoryHandle('.elffuss', { create: true });
  const w = async (n, t) => { const f = await dir.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  for (let i = 1; i <= 5; i++) await w(`mejoras-${String(i).padStart(3, '0')}.md`, '# propuesta ' + i);
  await w('archivo.md', '# no debe borrarse'); // no matchea el patrón
  await w('README.md', '# tampoco');
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

const sh = cmd => p.evaluate(async (c) => { const s = await import('/js/shell.js'); const raw = await s.exec(c); return s.stripAnsi(raw); }, cmd);

const before = await sh('ls .elffuss');
ok('los 5 ficheros mejoras-*.md existen antes de borrar', (before.match(/mejoras-/g) || []).length === 5, before);

const out = await sh('rm .elffuss/mejoras-*.md');
ok('rm con comodín NO da "no existe" (el bug real)', !/no existe/.test(out), out);
ok('rm con comodín confirma cuántos borró', /Eliminados 5/.test(out), out);

const after = await sh('ls .elffuss');
ok('los 5 mejoras-*.md YA NO están', !/mejoras-/.test(after), after);
ok('archivo.md (no coincide el patrón) SIGUE ahí', /archivo\.md/.test(after), after);
ok('README.md (no coincide el patrón) SIGUE ahí', /README\.md/.test(after), after);

// rm sin comodín (exacto) sigue funcionando igual que antes
await sh('echo x > .elffuss/solo.txt');
const outExact = await sh('rm .elffuss/solo.txt');
ok('rm exacto (sin comodín) sigue funcionando', !/no existe/.test(outExact), outExact);
ok('rm exacto de verdad borró el fichero', !/solo\.txt/.test(await sh('ls .elffuss')));

// glob sin coincidencias → error claro (no un "éxito" silencioso)
let errCaught = '';
try { await p.evaluate(() => { const shp = import('/js/shell.js'); return shp.then(s => s.exec('rm .elffuss/no-existe-*.md')); }); }
catch { /* el evaluate puede tragarse el rechazo si no hacemos throw */ }
const errMsg = await p.evaluate(async () => { const s = await import('/js/shell.js'); try { await s.exec('rm .elffuss/no-existe-*.md'); return null; } catch (e) { return e.message; } });
ok('glob sin coincidencias da error claro (no silencioso)', /sin coincidencias/.test(errMsg || ''), errMsg);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ RM CON COMODINES OK — el bug real queda arreglado');
await b.close();
process.exit(fails ? 1 : 0);

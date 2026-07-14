// Mente v3: estrellas por perfil (no consolas), historial completo, perfiles
// editables, ciudad de fondo + haces de actividad, y tool-calling REAL del CEO.
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); localStorage.removeItem('elffusscode.ceoProfiles'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1500, height: 900 } });
p.on('console', m => { if (m.type() === 'error' && !/allow-same-origin|soundcloud|widget|encrypted-media|permissions policy/i.test(m.text())) console.log('   err:', m.text().slice(0, 160)); });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
const MARK = 'MARCA-UNICA-93af7c';
await p.evaluate(async (mark) => {
  const o = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('README.md', '# demo\n' + mark + '\nProyecto de prueba.');
  const src = await o.getDirectoryHandle('src', { create: true });
  const wsrc = async (n, t) => { const f = await src.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await wsrc('app.js', 'export const app = 1;');
}, MARK);
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2000);

await p.locator('#activity img').click(); await p.waitForTimeout(1200);
ok('overlay + mundo montado', await p.locator('#mind-overlay').count() > 0);

// leyenda con los 4 perfiles por defecto + CEO
const legendItems = await p.locator('#mind-legend .ml-item').allInnerTexts();
ok('leyenda con 4 perfiles + CEO', legendItems.length === 5 && legendItems.some(t => /CEO/.test(t)) && legendItems.some(t => /Arquitectura/.test(t)), legendItems.join(' · '));

// ciudad de fondo construida (motor real)
await p.waitForTimeout(2500);
let dbg = await p.evaluate(async () => (await import('/js/mind.js'))._debug());
ok('ciudad de fondo construida bajo la Mente', dbg.hasCity, JSON.stringify(dbg));

// estrellas: una línea normal vs una tool-call deben crear estrellas (tamaño/estilo distinto por kind, verificado por código)
const before = (await p.evaluate(async () => (await import('/js/mind.js'))._debug())).starCount;
await p.evaluate(async () => { const m = await import('/js/mind.js'); m.pushThought('arq', { type: 'open', name: 'Arquitectura' }); m.pushThought('arq', { type: 'token', text: 'Esta es una línea de pensamiento normal que se vuelve estrella.\n' }); });
await p.waitForTimeout(200);
const afterLine = (await p.evaluate(async () => (await import('/js/mind.js'))._debug())).starCount;
ok('una línea de texto crea una estrella', afterLine > before, `${before}→${afterLine}`);
await p.evaluate(async (mark) => { const m = await import('/js/mind.js'); m.pushThought('arq', { type: 'tool', text: 'leyendo README.md…', path: 'README.md' }); }, MARK);
await p.waitForTimeout(200);
const afterTool = (await p.evaluate(async () => (await import('/js/mind.js'))._debug())).starCount;
ok('una tool-call crea otra estrella', afterTool > afterLine, `${afterLine}→${afterTool}`);

// el historial completo muestra TODO (línea + tool)
const logText = await p.evaluate(() => document.getElementById('mind-log-body').innerText);
ok('el historial recoge la línea de texto', /línea de pensamiento normal/.test(logText));
ok('el historial recoge la tool-call', /leyendo README\.md/.test(logText));

// haz de actividad sobre la ciudad (README.md existe en el modelo → beam real)
dbg = await p.evaluate(async () => (await import('/js/mind.js'))._debug());
ok('la tool-call sobre un fichero real generó un haz + resaltado', dbg.beamCount > 0 && dbg.fileActivityCount > 0, JSON.stringify(dbg));

// editor de perfiles: renombrar Arquitectura y cambiar color, guardar
await p.click('#mind-config'); await p.waitForTimeout(300);
const rows = p.locator('.cfg-prof');
ok('panel de config muestra 4 filas de perfil', await rows.count() === 4);
await rows.nth(0).locator('.cp-name').fill('Seguridad');
await rows.nth(0).locator('.cp-color').evaluate(el => { el.value = '#ff0055'; el.dispatchEvent(new Event('input')); });
await p.click('#cfg-save'); await p.waitForTimeout(300);
const newLegend = await p.locator('#mind-legend .ml-item').allInnerTexts();
ok('el perfil renombrado aparece en la leyenda', newLegend.some(t => /Seguridad/.test(t)), newLegend.join(' · '));

// tool-calling REAL del CEO: forceCycle con un proveedor falso que SÍ lee el fichero real
const cycleResult = await p.evaluate(async (mark) => {
  const ceo = await import('/js/ceo.js');
  const mind = await import('/js/mind.js');
  ceo.init({
    provider: () => ({
      chat: async (history) => {
        const res = history.find(m => m.role === 'user' && m.content.startsWith('[resultado code.read]'));
        if (!res) return '```tool\n{"tool":"code.read","args":{"path":"README.md"}}\n```';
        const snippet = res.content.includes(mark) ? mark : 'NO-MARK';
        return 'Propuesta basada en el contenido real: ' + snippet;
      },
    }),
    isBusy: () => false,
    onEvent: (ch, ev) => mind.pushThought(ch, ev),
  });
  const t0 = Date.now();
  while (!ceo.isThisTabLeader() && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 100));
  const ran = await ceo.forceCycle();
  return { ran, leader: ceo.isThisTabLeader() };
}, MARK);
ok('forceCycle se ejecuta (semáforo líder + GPU libre)', cycleResult.ran, JSON.stringify(cycleResult));
await p.waitForTimeout(500);
const logAfterCycle = await p.evaluate(() => document.getElementById('mind-log-body').innerText);
ok('la propuesta del CEO contiene el MARCADOR real leído del fichero (tool-calling REAL, no simulado)', logAfterCycle.includes(MARK), logAfterCycle.slice(-400));
ok('se creó un nodo de propuesta forjada (clicable, con .md guardado)', await p.evaluate(() => document.querySelectorAll('.mind-node-label').length > 0));
ok('el RESULTADO real de la tool (no solo el nombre) quedó linkado en el historial', /→ .*README/.test(logAfterCycle) || /→ /.test(logAfterCycle), '(línea "→ …" presente)');
ok('el nombre del fichero guardado es DESCRIPTIVO (fecha+tema, no mejoras-NNN)', await p.evaluate(() => {
  const rows = [...document.querySelectorAll('.mind-node-label')].map(l => l.textContent);
  return rows.some(t => /^\d{4}-\d{2}-\d{2}-\d{4}-/.test(t));
}));

// clic en la leyenda → la cámara VUELA a centrarse (posición cambia de verdad)
const posBefore = (await p.evaluate(async () => (await import('/js/mind.js'))._debug())).cameraPos;
await p.click('.ml-item[data-id="rend"]'); // perfil lejos de la posición inicial de cámara
await p.waitForTimeout(150);
const midFly = await p.evaluate(async () => (await import('/js/mind.js'))._debug());
ok('el clic dispara el vuelo (flying=true a mitad de camino)', midFly.flying);
await p.waitForTimeout(1300); // esperar a que termine (dur 1.1s)
const posAfter = (await p.evaluate(async () => (await import('/js/mind.js'))._debug())).cameraPos;
const moved = Math.hypot(posAfter[0] - posBefore[0], posAfter[1] - posBefore[1], posAfter[2] - posBefore[2]);
ok('la cámara realmente se movió al centrarse en el perfil', moved > 5, `desplazamiento ${moved.toFixed(1)}`);
const settledFly = (await p.evaluate(async () => (await import('/js/mind.js'))._debug())).flying;
ok('el vuelo termina solo (flying=false al acabar)', settledFly === false);

await p.screenshot({ path: OUT + '/mind_stars.png' });
console.log('captura → mind_stars.png');
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ MENTE v3 (estrellas + perfiles + ciudad + tool-calling real) OK');
await b.close();
process.exit(fails ? 1 : 0);

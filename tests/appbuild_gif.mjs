// Crea una app de complejidad media (varios ficheros, varias funciones) con
// el modelo REAL (Gemma-4, no el modo básico), sacando una captura cada
// pocos segundos mientras trabaja — abriendo distintos ficheros conforme van
// apareciendo, para que se vea tanto el chat como el código real. Al final
// monta esas capturas en un GIF animado del proceso completo (ffmpeg).
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';

const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad/appbuild';
const FRAMES = OUT + '/frames';
mkdirSync(FRAMES, { recursive: true });
const BASE = process.env.BASE || 'https://elffuss-code.utopiaia.com';
const INTERVAL_MS = 3000;

let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

async function waitIdle(p, maxMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const sending = await p.locator('#btn-send.sending').count().catch(() => 0);
    if (!sending) return true;
    await p.waitForTimeout(500);
  }
  return false;
}

const PROFILE = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad/profile-code-gemma';
const ctx = await chromium.launchPersistentContext(PROFILE, {
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu', '--use-angle=metal'],
  viewport: { width: 1440, height: 900 },
});
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'litert:gemma-e2b'); } catch {} });
const p = ctx.pages()[0] || await ctx.newPage();
p.on('pageerror', e => console.log('   pageerror:', e.message.slice(0, 160)));

await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2000);
await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  for await (const name of root.keys()) await root.removeEntry(name, { recursive: true }).catch(() => {});
  const ide = await import('/js/ide.js');
  await ide.refreshTree(root);
});
// el perfil persistente (para no re-descargar el modelo) también acumula el
// HISTORIAL DE CHAT de ejecuciones anteriores en IndexedDB — sin limpiarlo,
// el modelo hereda contexto viejo (ficheros/rutas de otras pruebas) y se
// confunde. Se limpia aparte del árbol de ficheros y se recarga.
await p.evaluate(async () => {
  const db = await import('/js/db.js');
  await db.del('kv', 'conversations').catch(() => {});
  try { localStorage.removeItem('elffusscode.openTabs'); localStorage.removeItem('elffusscode.activeConv'); } catch {}
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
console.log('1) proyecto vacío + conversación limpia');

console.log('2) cargando Gemma-4 E2B real…');
let loaded = false;
{
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const cls = await p.locator('#model-dot').getAttribute('class').catch(() => '');
    if (cls && /\bon\b/.test(cls)) { loaded = true; break; }
    await p.waitForTimeout(1000);
  }
}
if (!loaded) throw new Error('Gemma NO cargó a tiempo');
console.log('3) Gemma-4 cargado');

// --- captura periódica EN PARALELO: cada INTERVAL_MS, si hay un fichero
// nuevo en el árbol que aún no se ha enseñado, lo abre antes de capturar —
// así el GIF va alternando chat + ficheros reales conforme se crean.
let frameN = 0, capturing = true;
const shown = new Set();
async function captureLoop() {
  while (capturing) {
    try {
      const files = await p.locator('#tree .file').allTextContents();
      const fresh = files.find(f => !shown.has(f));
      if (fresh) {
        await p.locator('#tree .file', { hasText: fresh }).first().click({ force: true }).catch(() => {});
        shown.add(fresh);
        await p.waitForTimeout(200);
      }
    } catch { /* árbol repintándose, sigue */ }
    frameN++;
    await p.screenshot({ path: `${FRAMES}/f${String(frameN).padStart(3, '0')}.png` }).catch(() => {});
    await new Promise(r => setTimeout(r, INTERVAL_MS));
  }
}
const loopDone = captureLoop();

// Se pide en VARIOS turnos (uno por fichero) en vez de todo de golpe: un
// modelo pequeño local corta el JSON a mitad de generación si le pides los
// 3 ficheros en una sola respuesta (límite de tokens), y el parser no puede
// rescatar nada de un tool-call incompleto — no escribe NADA. Por turnos,
// cada respuesta es corta y cabe entera; además da más momentos distintos
// para las capturas (más realista: así se construye una app de verdad).
// MUY conciso a propósito: el modelo local corta la generación si el
// contenido de un fichero es largo (HTML/CSS/JS "normales" ya bastan para
// truncar el JSON del tool-call a medio camino) — pidiendo código mínimo,
// sin comentarios, cabe entero en una generación.
const PROMPTS = [
  'Crea index.html mínimo (15 líneas máx, sin comentarios) para una lista de tareas: input#nueva, botón#add, <ul id="lista">. Enlaza style.css y app.js.',
  'Ahora style.css mínimo (15 líneas máx, sin comentarios): tema oscuro simple, .done con text-decoration:line-through.',
  'Ahora app.js mínimo (20 líneas máx, sin comentarios): al pulsar #add, añade un <li> a #lista con el texto de #nueva y un botón «x» para borrarlo; click en el <li> alterna la clase done. Guarda y carga el array en localStorage.',
];
let allIdle = true;
for (let i = 0; i < PROMPTS.length; i++) {
  await p.click('#prompt');
  await p.type('#prompt', PROMPTS[i], { delay: 15 });
  await p.press('#prompt', 'Enter');
  console.log(`4.${i + 1}) turno ${i + 1}/${PROMPTS.length} — ${PROMPTS[i].slice(0, 40)}…`);
  const idle = await waitIdle(p, 120000);
  if (!idle) allIdle = false;
  await p.waitForTimeout(1000);
}
ok('la elfa terminó los 3 turnos sin quedarse colgada', allIdle);

// unos frames finales mostrando cada fichero creado, uno a uno
const finalFiles = await p.locator('#tree .file').allTextContents();
for (const f of finalFiles) {
  await p.locator('#tree .file', { hasText: f }).first().click({ force: true }).catch(() => {});
  await p.waitForTimeout(500);
  frameN++;
  await p.screenshot({ path: `${FRAMES}/f${String(frameN).padStart(3, '0')}.png` }).catch(() => {});
}

capturing = false;
await loopDone;
console.log(`5) captura terminada — ${frameN} frames`);

// --- diagnóstico: verdad de OPFS + historial real del agente, sin fiarse
// solo del DOM del árbol (por si acaso no se ha refrescado) ---
const opfsFiles = await p.evaluate(async () => (await (await import('/js/tools/code.js')).fileList()));
console.log('DIAG opfsFiles:', JSON.stringify(opfsFiles));
const histTail = await p.evaluate(async () => {
  const conv = await import('/js/conversations.js');
  const active = conv.getActive();
  return (active?.agent?.history || []).slice(-6).map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
});
console.log('DIAG historyTail:', JSON.stringify(histTail, null, 2));

// --- comprobaciones sobre lo construido de verdad ---
ok('creó VARIOS ficheros (complejidad media, no uno solo)', finalFiles.length >= 3, finalFiles.join(', '));
ok('index.html está entre los creados', finalFiles.some(f => /index\.html/i.test(f)));
ok('hay CSS y JS reales (no solo el HTML)', finalFiles.some(f => /\.css$/i.test(f)) && finalFiles.some(f => /\.js$/i.test(f)));

const jsFile = finalFiles.find(f => /\.js$/i.test(f));
if (jsFile) {
  const jsContent = await p.evaluate(async f => (await (await import('/js/tools/code.js')).read({ path: f })), jsFile);
  ok('el JS real menciona localStorage (persistencia pedida)', /localStorage/.test(jsContent), jsFile);
}

const toolCalls = await p.locator('#chat-log .msg.tool').count();
ok('el chat muestra tool-calls reales de code.write', toolCalls >= 3, String(toolCalls));

await ctx.close();

// --- monta el GIF con ffmpeg (paleta optimizada, más ligero que un GIF ingenuo) ---
const frameFiles = readdirSync(FRAMES).filter(f => f.endsWith('.png')).sort();
ok(`hay frames capturados de verdad (${frameFiles.length})`, frameFiles.length >= 3);

const gifPath = OUT + '/proceso.gif';
try {
  execFileSync('ffmpeg', ['-y', '-framerate', '1.2', '-i', `${FRAMES}/f%03d.png`,
    '-vf', 'scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
    gifPath], { stdio: 'pipe' });
  ok('el GIF del proceso se generó', true);
} catch (e) {
  ok('el GIF del proceso se generó', false, e.message.slice(0, 200));
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ APP DE COMPLEJIDAD MEDIA + CAPTURAS PERIÓDICAS + GIF OK');
console.log('GIF en:', gifPath);
process.exit(fails ? 1 : 0);

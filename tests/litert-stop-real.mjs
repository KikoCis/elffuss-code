// PARAR con el modelo REAL (Gemma-4 E4B por LiteRT-LM, WebGPU).
//
// tests/litert-stop.mjs fija la lógica con un motor de mentira. Lo que solo se
// sabe con el de verdad: que salir del streaming a mitad (break) y TIRAR la
// conversación deja el motor usable — que el turno siguiente crea otra y
// contesta, sin un «ocupado» del motor a medio generar y sin heredar el trozo
// de respuesta parada.
//
// Mismos requisitos que e4b_live.mjs (prueba de GPU: no va en run-tools.sh):
//   · adaptador WebGPU real y el Chrome instalado (el Chromium de Playwright
//     muere cargando E4B)
//   · perfil PERSISTENTE
//   · el .litertlm servido en local (E4B_URL)
//
//   E4B_URL=http://localhost:8790/__e4b.litertlm PROFILE=/tmp/elf-e4b node litert-stop-real.mjs
import { chromium } from 'playwright';
import { CHROME_ARGS } from './chrome-args.mjs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8790';
const E4B_URL = process.env.E4B_URL || (BASE + '/__e4b.litertlm');
const PROFILE = process.env.PROFILE || join(tmpdir(), 'elffuss-e4b-prof');
mkdirSync(PROFILE, { recursive: true });

let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const log = (...a) => console.log('· ' + a.join(' '));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: process.env.CHANNEL || 'chrome',
  args: ['--enable-unsafe-webgpu', ...CHROME_ARGS],
  timeout: 120000,
});
const p = await ctx.newPage();
p.on('pageerror', e => log('PAGEERROR:', e.message.slice(0, 160)));
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

log('cargando E4B…');
const load = await p.evaluate(async (url) => {
  const m = await import('/js/providers/litert.js');
  m.MODELS['gemma-e4b'].url = url;
  m.configure('gemma-e4b');
  let err = null;
  try { await m.load(() => {}); } catch (e) { err = e.message; }
  return { err };
}, E4B_URL);
ok('E4B carga sin error', !load.err, load.err || '');
if (load.err) { console.log('\n❌ sin modelo no se puede seguir'); await ctx.close(); process.exit(1); }

const r = await p.evaluate(async () => {
  const m = await import('/js/providers/litert.js');
  const SYS = 'Eres un asistente conciso. Responde en español.';
  // 1. Una respuesta larga, parada tras unos pocos trozos.
  const h = [{ role: 'user', content: 'Escribe los números del 1 al 300 separados por comas, sin nada más.' }];
  const ac = new AbortController();
  const trozos = []; let trasParar = 0, err1 = null, parcial = '';
  try {
    parcial = await m.chat(h, SYS, t => { if (ac.signal.aborted) trasParar++; trozos.push(t); if (trozos.length === 6) ac.abort(); }, ac.signal);
  } catch (e) { err1 = e.name + ': ' + e.message; }
  // 2. El turno siguiente (el agente no apunta la respuesta parada).
  h.push({ role: 'user', content: 'Olvida lo anterior. Responde solo con la palabra: ADIOS' });
  let err2 = null, out2 = '';
  try { out2 = await m.chat(h, SYS, () => {}); } catch (e) { err2 = e.name + ': ' + e.message; }
  // 3. Lo que el modelo YA contestó sobrevive a una parada: la conversación se
  // rehace con los turnos de antes en el prefacio. El número solo está en su
  // respuesta, no en ningún mensaje del usuario: si se rehiciera solo con los
  // mensajes del usuario, no podría repetirlo.
  const h3 = [{ role: 'user', content: 'Inventa un número de cuatro cifras al azar. Responde SOLO con el número.' }];
  let num = '', err3 = null, out3 = '';
  try {
    num = await m.chat(h3, SYS, () => {});
    h3.push({ role: 'assistant', content: num });
    h3.push({ role: 'user', content: 'Escribe los números del 1 al 300 separados por comas, sin nada más.' });
    const ac3 = new AbortController(); let k3 = 0;
    await m.chat(h3, SYS, () => { if (++k3 === 6) ac3.abort(); }, ac3.signal);
    h3.push({ role: 'user', content: '¿Qué número de cuatro cifras inventaste al principio? Responde SOLO con ese número.' });
    out3 = await m.chat(h3, SYS, () => {});
  } catch (e) { err3 = e.name + ': ' + e.message; }
  return { trozos: trozos.length, trasParar, err1, parcial: String(parcial || '').slice(0, 80), err2, out2: String(out2 || '').slice(0, 200),
    num: String(num || '').slice(0, 40), out3: String(out3 || '').slice(0, 80), err3 };
});
ok('parar a mitad no lanza (devuelve lo generado)', !r.err1, r.err1 || `«${r.parcial}»`);
ok('  …y no entrega trozos tras parar', r.trasParar === 0, `${r.trozos} trozos, ${r.trasParar} tras parar`);
ok('el turno siguiente funciona (el motor no se queda ocupado)', !r.err2 && r.out2.length > 0, r.err2 || `«${r.out2}»`);
ok('  …y contesta a lo nuevo, sin seguir la lista parada', /adi[oó]s/i.test(r.out2) && !/\d+\s*,\s*\d+\s*,\s*\d+/.test(r.out2), `«${r.out2}»`);
const n4 = (r.num.match(/\d{4}/) || [''])[0];
ok('lo que el modelo contestó ANTES de la parada sigue en la conversación rehecha', !r.err3 && !!n4 && r.out3.includes(n4),
  r.err3 || `inventó «${r.num}» · después de parar repite «${r.out3}»`);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ LITERT REAL: parar a mitad y seguir funciona');
await ctx.close();
process.exit(fails ? 1 : 0);

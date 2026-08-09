// VALIDACIÓN DE PUNTA A PUNTA con el modelo REAL (Gemma-4 E4B, ~3 GB, WebGPU).
// Las rondas anteriores validaron la CAPA DE HERRAMIENTAS de forma determinista;
// esto valida la capa de arriba: que el modelo CARGA, GENERA y ELIGE bien entre
// editar (code.edit) y reescribir entero (code.write).
//
// Requisitos (por eso no está en run-tools.sh, que es determinista y rápido):
//   · adaptador WebGPU real
//   · perfil PERSISTENTE — en el contexto efímero de Playwright, Cache Storage
//     es de memoria y no traga GB (verificado: 1 GB ya falla ahí)
//   · el .litertlm servido en local (E4B_URL) para no bajar 3 GB en cada corrida
//
//   E4B_URL=http://localhost:8790/__e4b.litertlm PROFILE=/tmp/elf-e4b node e4b_live.mjs
import { chromium } from 'playwright';
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

// OJO: el Chromium que trae Playwright MUERE cargando E4B (2,97 GB) — medido:
// 3 intentos, 3 muertes del navegador, >18 min cada una. Con el Chrome REAL
// instalado, lo mismo tarda ~90 s y funciona. Por eso el canal es 'chrome'.
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: process.env.CHANNEL || 'chrome',
  args: ['--enable-unsafe-webgpu', '--use-angle=metal'],
  timeout: 120000,
});
const p = await ctx.newPage();
p.on('pageerror', e => log('PAGEERROR:', e.message.slice(0, 160)));
// ?test-opfs abre OPFS como proyecto: no hace falta el picker nativo
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// ---------- 1 · carga real del modelo ----------
log('cargando E4B (~3 GB a la GPU), puede tardar varios minutos…');
const load = await p.evaluate(async (url) => {
  const m = await import('/js/providers/litert.js');
  m.MODELS['gemma-e4b'].url = url;             // apuntamos a la copia local
  m.configure('gemma-e4b');
  const msgs = [];
  const t0 = performance.now();
  let err = null;
  try { await m.load(s => msgs.push(s)); } catch (e) { err = e.message; }
  return {
    err, secs: Math.round((performance.now() - t0) / 1000), ctx: m.ctxTokens,
    cacheFail: msgs.some(s => /No se pudo guardar/.test(s)), last: msgs.at(-1) || '',
  };
}, E4B_URL);
ok('1 · E4B carga sin error', !load.err, load.err || `${load.secs}s · ctx=${load.ctx}`);
ok('1 · el contexto queda fijado por la escalera', load.ctx >= 4096, `ctx=${load.ctx}`);
ok('1 · el modelo QUEDA CACHEADO (no se re-descarga cada sesión)', !load.cacheFail, load.last.slice(0, 120));
if (load.err) { console.log('\n❌ sin modelo no se puede seguir'); await ctx.close(); process.exit(1); }

// ---------- 2 · genera texto NO VACÍO ----------
// El fallo que dejé apuntado: E4B decía «cargado» y devolvía respuesta vacía.
const gen = await p.evaluate(async () => {
  const m = await import('/js/providers/litert.js');
  const toks = [];
  const t0 = performance.now();
  let err = null, out = '';
  try { out = await m.chat([{ role: 'user', content: 'Responde solo con la palabra: HOLA' }], 'Eres un asistente conciso.', t => toks.push(t)); }
  catch (e) { err = e.message; }
  return { err, out: (out || '').slice(0, 200), len: (out || '').length, toks: toks.length, secs: Math.round((performance.now() - t0) / 1000) };
});
ok('2 · la generación devuelve texto NO VACÍO', gen.len > 0 && !gen.err, gen.err || `${gen.len} chars en ${gen.secs}s · «${gen.out.slice(0, 60)}»`);
ok('2 · llegan tokens por streaming', gen.toks > 0, `${gen.toks} trozos`);

// ---------- 3 · ¿ELIGE code.edit para MODIFICAR, en vez de reescribir? ----------
// Es lo que las rondas de herramientas daban por supuesto y nunca se comprobó
// con el modelo de verdad. El fichero es largo a propósito: reescribirlo entero
// sería carísimo y arriesgado, que es justo lo que code.edit evita.
const decide = await p.evaluate(async () => {
  const m = await import('/js/providers/litert.js');
  const agent = await import('/js/agent.js');
  const code = await import('/js/tools/code.js');

  let s = 'export const CONFIG = {\n  titulo: "Mi App",\n  color: "azul",\n  version: "1.0.0",\n';
  for (let i = 0; i < 60; i++) s += `  opcion${i}: ${i},\n`;
  s += '};\n';
  await code.write({ path: 'config.js', content: s });

  const actual = await code.read({ path: 'config.js' });
  const sys = agent.systemPrompt('');
  const msg = `En config.js cambia el color "azul" por "rojo". El fichero es:\n\n${actual}`;
  let out = '', err = null;
  try { out = await m.chat([{ role: 'user', content: msg }], sys); } catch (e) { err = e.message; }
  const calls = agent.parseToolCalls(out) || [];
  return {
    err, out: (out || '').slice(0, 500),
    // OJO: parseToolCalls devuelve {tool, args}, no {name, args}
    calls: calls.map(c => ({
      name: c.tool, path: c.args?.path,
      searchLen: (c.args?.search || '').length,
      contentLen: (c.args?.content || '').length,
    })),
  };
});
const names = (decide.calls || []).map(c => c.name);
ok('3 · el modelo emite alguna llamada a herramienta', names.length > 0,
   decide.err || `out=«${(decide.out || '').replace(/\n/g, ' ').slice(0, 150)}»`);
ok('3 · usa code.edit (parcial) y NO code.write (reescribir entero)',
   names.includes('code.edit') && !names.includes('code.write'),
   `calls=${JSON.stringify(decide.calls)}`);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ E4B REAL: carga, genera y edita parcialmente');
await ctx.close();
process.exit(fails ? 1 : 0);

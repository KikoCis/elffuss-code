// El ciclo del cerebro CEO (web/js/ceo.js) en Node, sin navegador ni modelo:
// cuándo arranca, cuándo NO arranca y qué hace al cortarse.
//
//   1. Pausar mientras tick() espera a isReady() (asíncrona en Claw): antes el
//      ciclo arrancaba igual y escribía una propuesta justo después de pausar.
//   2. Lo mismo con actividad del usuario en ese hueco.
//   3. Un agente SIN stop() (el de Claw antes de su stop-fix) se corta en
//      cuanto vuelve el usuario: antes seguía llamando al modelo y ejecutando
//      herramientas hasta el final.
//   4. Un agente con stop() (el de Code) se corta sin excepciones, y no se
//      escribe nada.
//   5. El texto del corte distingue «vuelves tú» (actividad) de «en pausa»
//      (pausado a propósito desde la Mente).
//
// ceo.js se copia a una carpeta temporal junto a un agent.js y un humanize.js
// de mentira (los de verdad necesitan el navegador).
//
//   node tests/ceo-cycle.mjs
//   CEO_JS=<ruta a otra copia de ceo.js> node tests/ceo-cycle.mjs   (p. ej. la del core)
import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CEO = resolve(process.env.CEO_JS || join(AQUI, '..', 'web', 'js', 'ceo.js'));
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const dormir = ms => new Promise(r => setTimeout(r, ms));
async function hasta(cond, max = 8000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > max) return false; await dormir(10); } return true; }

// Lo mínimo del navegador que usa ceo.js: localStorage, y sin Web Locks ni
// BroadcastChannel (así esta pestaña es la líder y no queda nada abierto).
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: k => { mem.delete(k); },
} });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: undefined });

// Agente con stop() y señal, como el de Code.
const AGENTE_CON_PARADA = `export class Agent {
  constructor(p) { this.p = p; this.parado = false; }
  stop() { this.parado = true; }
  async handle(task, onEvent, { signal } = {}) {
    for (let i = 0; i < 4; i++) {
      if (this.parado || signal?.aborted) return 'aborted';
      await this.p.chat([{ role: 'user', content: task }], '', t => onEvent({ type: 'token', text: t }), signal);
      if (this.parado || signal?.aborted) return 'aborted';
      onEvent({ type: 'tool', call: { tool: 'code.read', args: { path: 'a.js' } } });
      globalThis.__herramientas++;
      onEvent({ type: 'tool_result', tool: 'code.read', result: 'contenido' });
    }
    onEvent({ type: 'text', text: 'Propuesta: añadir pruebas al módulo a.js' });
    return 'ok';
  }
}`;
// Agente SIN stop() ni señal, como el de Claw antes de su stop-fix.
const AGENTE_SIN_PARADA = `export class Agent {
  constructor(p) { this.p = p; }
  async handle(task, onEvent) {
    for (let i = 0; i < 4; i++) {
      await this.p.chat([{ role: 'user', content: task }], '', t => onEvent({ type: 'token', text: t }));
      onEvent({ type: 'tool', call: { tool: 'fs.read', args: { path: 'a.txt' } } });
      globalThis.__herramientas++;
      onEvent({ type: 'tool_result', tool: 'fs.read', result: 'contenido' });
    }
    onEvent({ type: 'text', text: 'Propuesta: ordenar la carpeta de documentos' });
  }
}`;

function preparar(agente) {
  const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'ceo-cycle-'));
  copyFileSync(CEO, join(dir, 'ceo.js'));
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dir, 'agent.js'), agente);
  writeFileSync(join(dir, 'humanize.js'), 'export const humanizeTool = (t, a) => t + " " + (a?.path || "");');
  return dir;
}
let version = 0;
const cargar = dir => import(pathToFileURL(join(dir, 'ceo.js')).href + '?v=' + (++version));

function proveedor() {
  const p = { llamadas: 0, trasCorte: 0, cortado: false,
    async chat(h, s, cb) {
      p.llamadas++; if (p.cortado) p.trasCorte++;
      await dormir(30);
      cb('·');
      return 'una propuesta concreta y accionable';
    } };
  return p;
}
function espacio(espera = 0) {
  const w = { escritos: [], preguntas: 0, alPreguntar: null,
    async isReady() { w.preguntas++; const f = w.alPreguntar; w.alPreguntar = null; f?.(); await dormir(espera); return true; },
    async tree() { return 'a.js\nb.js'; },
    async write({ path }) { w.escritos.push(path); },
    async list() { return []; }, async read() { return ''; }, async remove() {},
  };
  return w;
}
function montar(ceo, w, p, ns) {
  const eventos = [];
  ceo.init({ workspace: w, provider: () => p, isBusy: () => false, namespace: ns, onEvent: (canal, ev) => eventos.push({ canal, ev }) });
  return eventos;
}
const ultimoCorte = eventos => eventos.filter(e => e.canal === 'ceo' && e.ev.type === 'paused').at(-1)?.ev.text || '';

// 1 · pausar mientras tick() espera isReady()
{
  const ceo = await cargar(preparar(AGENTE_CON_PARADA));
  const w = espacio(200), p = proveedor();
  montar(ceo, w, p, 't1');
  ceo.enable();
  ceo.setMission('revisar el proyecto');   // así el próximo tick no espera a estar ocioso
  w.alPreguntar = () => ceo.disable();       // la pausa cae justo en la espera
  await hasta(() => w.preguntas >= 1, 8000);
  await dormir(700);
  ok('1 · pausar mientras tick() espera isReady(): ningún ciclo arranca', w.preguntas === 1 && p.llamadas === 0 && w.escritos.length === 0, JSON.stringify({ preguntas: w.preguntas, llamadas: p.llamadas, escritos: w.escritos }));
  ok('1 · …y el cerebro queda en pausa', !ceo.isEnabled() && !ceo.isRunning());
}

// 2 · volver a usar la app en ese mismo hueco
{
  const ceo = await cargar(preparar(AGENTE_CON_PARADA));
  const w = espacio(200), p = proveedor();
  montar(ceo, w, p, 't2');
  ceo.enable();
  ceo.setMission('revisar el proyecto');
  w.alPreguntar = () => ceo.noteActivity();
  await hasta(() => w.preguntas >= 1, 8000);
  await dormir(700);
  ok('2 · actividad mientras tick() espera isReady(): ningún ciclo arranca', p.llamadas === 0 && w.escritos.length === 0, JSON.stringify({ llamadas: p.llamadas, escritos: w.escritos }));
  ceo.disable();
}

// 3 · agente sin stop(): cortarlo es lanzar desde su callback
{
  const ceo = await cargar(preparar(AGENTE_SIN_PARADA));
  const w = espacio(0), p = proveedor();
  const eventos = montar(ceo, w, p, 't3');
  globalThis.__herramientas = 0;
  const ciclo = ceo.forceCycle();
  await hasta(() => p.llamadas >= 1);
  ceo.noteActivity(); p.cortado = true;
  const herramientasAlCortar = globalThis.__herramientas;
  await ciclo;
  await dormir(200);
  ok('3 · agente sin stop(): tras volver el usuario nadie llama más al modelo', p.trasCorte === 0, `${p.trasCorte} llamadas después del corte`);
  ok('3 · …ni ejecuta más herramientas', globalThis.__herramientas === herramientasAlCortar, `${globalThis.__herramientas - herramientasAlCortar} después del corte`);
  ok('3 · …ni se escribe la propuesta', w.escritos.length === 0 && !ceo.isRunning(), JSON.stringify(w.escritos));
  ok('3 · …y se dice «vuelves tú»', /^Vuelves tú/.test(ultimoCorte(eventos)), ultimoCorte(eventos));
}

// 4 · agente con stop(): se corta sin excepciones
{
  const ceo = await cargar(preparar(AGENTE_CON_PARADA));
  const w = espacio(0), p = proveedor();
  const eventos = montar(ceo, w, p, 't4');
  globalThis.__herramientas = 0;
  let error = null;
  const ciclo = ceo.forceCycle().catch(e => { error = e; });
  await hasta(() => p.llamadas >= 1);
  ceo.noteActivity(); p.cortado = true;
  const nAlCortar = eventos.length;
  await ciclo;
  const tokensTrasCorte = eventos.slice(nAlCortar).filter(e => e.canal !== 'ceo' && e.ev.type === 'token').length;
  ok('4 · agente con stop(): el ciclo se corta sin excepción y sin escribir', !error && w.escritos.length === 0 && !ceo.isRunning(), JSON.stringify({ error: error?.message, escritos: w.escritos }));
  ok('4 · …el agente no vuelve a llamar al modelo y lo que aún llega no se pinta', p.trasCorte === 0 && tokensTrasCorte === 0, JSON.stringify({ llamadas: p.trasCorte, tokens: tokensTrasCorte }));
}

// 5 · el texto del corte: pausa a propósito frente a actividad
{
  const ceo = await cargar(preparar(AGENTE_CON_PARADA));
  const w = espacio(0), p = proveedor();
  const eventos = montar(ceo, w, p, 't5');
  ceo.enable();
  const ciclo = ceo.forceCycle();
  await hasta(() => p.llamadas >= 1);
  ceo.disable();
  await ciclo;
  ok('5 · pausar desde la Mente a mitad de ciclo dice «en pausa», no «vuelves tú»', /^En pausa/.test(ultimoCorte(eventos)) && w.escritos.length === 0, ultimoCorte(eventos));
  // y un ciclo que nadie corta sí escribe su propuesta (el resto no es trivial)
  const p2 = proveedor(), w2 = espacio(0);
  const ceo2 = await cargar(preparar(AGENTE_CON_PARADA));
  montar(ceo2, w2, p2, 't5b');
  await ceo2.forceCycle();
  ok('5 · un ciclo sin cortes sí deja su propuesta escrita', w2.escritos.length === 1 && /\.md$/.test(w2.escritos[0]), JSON.stringify(w2.escritos));
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ CICLO DEL CEO OK — no arranca tras pausar, y se corta con cualquier agente');
process.exit(fails ? 1 : 0);

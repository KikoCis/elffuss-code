// Cerebro CEO autónomo: cuando el usuario NO está pidiendo nada (ocioso) y hay
// un modelo local cargado, la elfa «trabaja por su cuenta» — revisa el proyecto,
// reparte el trabajo en varios departamentos que piensan EN PARALELO (cada uno
// una consola flotante en la vista Mente) y sintetiza propuestas de mejora.
//
// Seguridad: NO modifica tus ficheros. Deja las propuestas en `elffuss-mind/`
// (artefactos aditivos) y las hace «flotar» en la visualización. Se PARA en
// cuanto detecta actividad del usuario y reanuda al volver a estar ocioso.
import { Agent } from './agent.js';
import * as code from './tools/code.js';

const IDLE_MS = 18000;       // 18 s sin actividad → el CEO se pone a trabajar
const TICK_MS = 3000;        // frecuencia de comprobación
const COOLDOWN_MS = 45000;   // descanso entre ciclos (no quemar la GPU)

// «departamentos»: cada uno es una línea de pensamiento paralela con su foco
const DEPARTMENTS = [
  { id: 'arq', name: 'Arquitectura', focus: 'estructura, acoplamiento y dependencias; qué módulo conviene dividir o unificar' },
  { id: 'cal', name: 'Calidad', focus: 'bugs latentes, casos borde sin cubrir, validaciones que faltan' },
  { id: 'rend', name: 'Rendimiento', focus: 'cuellos de botella, trabajo repetido, estructuras de datos mejorables' },
  { id: 'dx', name: 'Producto/DX', focus: 'legibilidad, nombres, documentación y ergonomía para quien lo usa' },
];

let enabled = false, running = false, lastActivity = Date.now(), timer = null, lastCycleEnd = 0, cycleN = 0;
let getProvider = () => null;
let emit = () => {};         // (channel, event) → visualización de la Mente

export function init({ provider, onEvent } = {}) {
  if (provider) getProvider = provider;
  if (onEvent) emit = onEvent;
}
export function noteActivity() { lastActivity = Date.now(); if (running) running = 'interrupt'; }
export function isEnabled() { return enabled; }
export function isRunning() { return !!running; }
export function enable() { if (enabled) return; enabled = true; lastActivity = Date.now(); schedule(); emit('sys', { type: 'status', text: 'CEO en guardia — trabajaré cuando estés ocioso' }); }
export function disable() { enabled = false; running = false; if (timer) clearTimeout(timer); emit('sys', { type: 'status', text: 'CEO en pausa' }); }

function schedule() { if (timer) clearTimeout(timer); timer = setTimeout(tick, TICK_MS); }

async function tick() {
  if (!enabled) return;
  const idle = Date.now() - lastActivity;
  const rested = Date.now() - lastCycleEnd > COOLDOWN_MS;
  if (!running && idle >= IDLE_MS && rested && code.handle() && getProvider()) {
    try { await runCycle(); } catch { /* siguiente ciclo */ }
    lastCycleEnd = Date.now();
  }
  schedule();
}

// helper: corre el agente con el proveedor actual sobre un prompt, emitiendo
// tokens/herramientas a un canal. Devuelve el texto final.
async function think(channel, task) {
  const prov = getProvider();
  if (!prov) return '';
  const a = new Agent({ chat: (h, s, cb) => prov.chat(h, s, cb) });
  let out = '';
  await a.handle(task, ev => {
    if (running === 'interrupt') throw new Error('interrumpido');
    if (ev.type === 'token') { out += ev.text; emit(channel, { type: 'token', text: ev.text }); }
    else if (ev.type === 'tool') emit(channel, { type: 'tool', text: ev.call.tool + ' ' + (ev.call.args?.path || ev.call.args?.query || '') });
    else if (ev.type === 'text') { out = ev.text; }
  });
  return out;
}

async function runCycle() {
  running = true;
  cycleN++;
  emit('ceo', { type: 'cycle', n: cycleN, text: 'Nuevo ciclo: reviso el proyecto y reparto el trabajo…' });

  // 1) el CEO observa el terreno (árbol + un fichero clave) para orientar
  let tree = '';
  try { tree = await code.tree({ depth: 2 }); } catch { /* sin proyecto */ }
  emit('ceo', { type: 'survey', text: 'Panorama del proyecto captado (' + tree.split('\n').length + ' entradas). Delegando a los departamentos…' });

  // 2) departamentos EN PARALELO: cada uno propone UNA mejora concreta
  const brief = (d) => `Eres el jefe de ${d.name} de un equipo que mejora este proyecto. Céntrate en: ${d.focus}. ` +
    `Explora con code.tree/code.read lo mínimo y propón UNA mejora CONCRETA y accionable (qué fichero, qué cambio, por qué). ` +
    `Sé breve. No modifiques nada: solo la propuesta.`;
  const proposals = await Promise.all(DEPARTMENTS.map(async d => {
    emit(d.id, { type: 'open', name: d.name, focus: d.focus });
    try { const p = await think(d.id, brief(d)); emit(d.id, { type: 'done', text: p }); return { dept: d.name, text: p }; }
    catch { emit(d.id, { type: 'done', text: '(interrumpido)' }); return null; }
  }));
  if (running === 'interrupt') { running = false; emit('ceo', { type: 'paused', text: 'Vuelves tú — dejo lo mío y te cedo el mando.' }); return; }

  // 3) el CEO sintetiza y GUARDA la propuesta (artefacto aditivo, no toca tu código)
  const valid = proposals.filter(Boolean).filter(p => p.text && p.text.length > 8);
  const md = `# Propuestas de mejora — ciclo ${cycleN}\n\n` +
    valid.map(p => `## ${p.dept}\n${p.text}\n`).join('\n') +
    `\n_— generado por el cerebro CEO de Elffuss mientras estabas ocioso._\n`;
  try {
    await code.write({ path: `elffuss-mind/mejoras-${String(cycleN).padStart(3, '0')}.md`, content: md });
    emit('ceo', { type: 'built', text: `Propuesta guardada en elffuss-mind/mejoras-${String(cycleN).padStart(3, '0')}.md`, md, proposals: valid });
  } catch (e) {
    emit('ceo', { type: 'built', text: 'Propuesta lista (no pude escribir el fichero)', md, proposals: valid });
  }
  running = false;
}

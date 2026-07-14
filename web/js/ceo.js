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
let isBusy = () => false;    // ¿el usuario tiene trabajo en cola/procesándose? → prioridad

// MISIÓN reprogramable: el usuario puede reorientar el cerebro desde la Mente
// («céntrate en seguridad», «optimiza mis Excel», «documenta todo»…). Se
// guarda como una «skill de cerebro» y se inyecta en cada ciclo.
const DEFAULT_MISSION = 'Revisar el proyecto y proponer mejoras concretas y accionables (código, procesos, datos o docs).';
let mission = DEFAULT_MISSION;
try { mission = localStorage.getItem('elffusscode.ceoMission') || DEFAULT_MISSION; } catch { /* */ }
export function getMission() { return mission; }
export function setMission(text) {
  mission = (text || '').trim() || DEFAULT_MISSION;
  try { localStorage.setItem('elffusscode.ceoMission', mission); } catch { /* */ }
  emit('ceo', { type: 'reprogram', text: 'Nueva misión recibida: ' + mission });
  lastCycleEnd = 0; lastActivity = Date.now() - IDLE_MS; // que arranque un ciclo pronto con la nueva misión
  return mission;
}

// Carpeta-«alma» donde el cerebro crea y guarda TODO (configurable).
const DEFAULT_SOUL = '.elffuss/soul';
let soulDir = DEFAULT_SOUL;
try { soulDir = localStorage.getItem('elffusscode.ceoDir') || DEFAULT_SOUL; } catch { /* */ }
export function getSoulDir() { return soulDir; }
export function setSoulDir(dir) {
  soulDir = (dir || '').trim().replace(/^\/+|\/+$/g, '') || DEFAULT_SOUL;
  try { localStorage.setItem('elffusscode.ceoDir', soulDir); } catch { /* */ }
  emit('ceo', { type: 'reprogram', text: 'Nueva carpeta-alma: ' + soulDir + '/' });
  return soulDir;
}

// ── semáforo cross-pestaña: UN SOLO cerebro ejecuta, TODAS visualizan ───────
// El líder tiene un Web Lock exclusivo (se libera solo al cerrar la pestaña);
// difunde sus pensamientos por BroadcastChannel para que el resto los vea.
let isLeader = false, bc = null, realEmit = () => {};
function initCrossTab() {
  if (bc) return;
  try {
    bc = new BroadcastChannel('elffuss-ceo');
    bc.onmessage = e => { if (e.data && e.data.kind === 'thought') realEmit(e.data.channel, e.data.ev); };
  } catch { /* sin BroadcastChannel */ }
  if (navigator.locks && navigator.locks.request) {
    // mantener el lock hasta que la pestaña se cierre → esta pestaña es la que ejecuta
    navigator.locks.request('elffuss-ceo-leader', { mode: 'exclusive' }, () => new Promise(() => { isLeader = true; }))
      .catch(() => { isLeader = true; });
  } else { isLeader = true; } // sin Web Locks: degradar a que cada pestaña actúe
}
// emisión que usa el ciclo (solo corre en el líder): local + difusión al resto
function emit(channel, ev) {
  realEmit(channel, ev);
  try { bc && bc.postMessage({ kind: 'thought', channel, ev }); } catch { /* ev no serializable */ }
}

export function init({ provider, onEvent, isBusy: busy } = {}) {
  if (provider) getProvider = provider;
  if (onEvent) realEmit = onEvent;
  if (busy) isBusy = busy;
  initCrossTab();
}
export function isThisTabLeader() { return isLeader; }
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
  // solo el LÍDER ejecuta (semáforo cross-pestaña), y solo si el usuario NO
  // tiene trabajo en cola/procesándose (prioridad del usuario y del scheduler).
  if (isLeader && !running && !isBusy() && idle >= IDLE_MS && rested && code.handle() && getProvider()) {
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

  // 2) departamentos EN PARALELO: cada uno propone UNA mejora concreta,
  //    alineados con la MISIÓN reprogramable por el usuario.
  const brief = (d) => `MISIÓN del equipo (fijada por el usuario): ${mission}\n` +
    `Eres el jefe de ${d.name}. Dentro de esa misión, céntrate en: ${d.focus}. ` +
    `Explora con code.tree/code.read lo mínimo y propón UNA mejora CONCRETA y accionable (qué fichero, qué cambio, por qué), ` +
    `entendible por un humano. Sé breve. No modifiques nada del proyecto: solo la propuesta.`;
  const proposals = await Promise.all(DEPARTMENTS.map(async d => {
    emit(d.id, { type: 'open', name: d.name, focus: d.focus });
    try { const p = await think(d.id, brief(d)); emit(d.id, { type: 'done', text: p }); return { dept: d.name, text: p }; }
    catch { emit(d.id, { type: 'done', text: '(interrumpido)' }); return null; }
  }));
  if (running === 'interrupt') { running = false; emit('ceo', { type: 'paused', text: 'Vuelves tú — dejo lo mío y te cedo el mando.' }); return; }

  // 3) el CEO sintetiza y GUARDA la propuesta (artefacto aditivo, no toca tu código)
  const valid = proposals.filter(Boolean).filter(p => p.text && p.text.length > 8);
  const md = `# Propuestas de mejora — ciclo ${cycleN}\n\n**Misión:** ${mission}\n\n` +
    valid.map(p => `## ${p.dept}\n${p.text}\n`).join('\n') +
    `\n_— generado por el cerebro CEO de Elffuss mientras estabas ocioso._\n`;
  const path = `${soulDir}/mejoras-${String(cycleN).padStart(3, '0')}.md`;
  try {
    await code.write({ path, content: md });
    emit('ceo', { type: 'built', text: `Propuesta guardada en ${path}`, path, md, proposals: valid });
  } catch (e) {
    emit('ceo', { type: 'built', text: 'Propuesta lista (no pude escribir el fichero)', md, proposals: valid });
  }
  running = false;
}

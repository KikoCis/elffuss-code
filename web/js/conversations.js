// Conversaciones: varias a la vez, como pestañas — cada una con su propio
// historial (su propio Agent) y su propia cola de mensajes pendientes.
// Cerrar una pestaña NO borra la conversación (solo la Historial sí). Todo
// persiste en IndexedDB, sobrevive a recargar.
//
// Procesado: cada conversación acepta y encola mensajes de forma totalmente
// independiente (mandar en la pestaña B mientras la A está pensando no
// bloquea nada). La generación en sí (la llamada real al modelo) se
// serializa con un cerrojo global — solo hay UN modelo cargado en el
// navegador y una sesión de inferencia no admite dos generate() a la vez sin
// corromperse — así que las conversaciones se turnan para «hablar» con el
// modelo, pero cada una sigue funcionando y aceptando mensajes de forma
// independiente mientras espera su turno.
import { Agent } from './agent.js';
import { runGoal, TASK_PREFIX } from './goal.js';
import * as db from './db.js';

const NS = 'elffusscode';
const TABS_KEY = NS + '.openTabs';
const ACTIVE_KEY = NS + '.activeConv';
const HIST_CAP = 80; // mensajes por conversación que se persisten

let providerRef = null;
const convs = new Map();     // id -> { id, title, agent, queue, pumping, createdAt, updatedAt }
let openTabIds = [];
let activeId = null;
let onChange = () => {};

const genId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cleanTitle = s => String(s).replace(/\s+/g, ' ').trim();

const GOAL_PREFIX = TASK_PREFIX + 'Objetivo: ';
export function titleFor(conv) {
  if (conv.title) return conv.title;
  const firstUser = conv.agent.history.find(m =>
    m.role === 'user' && !m.content.startsWith('[resultado') &&
    (!m.content.startsWith(TASK_PREFIX) || m.content.startsWith(GOAL_PREFIX)));
  if (!firstUser) return 'Nueva conversación';
  // el objetivo lleva un prefijo interno ([tarea-objetivo] Objetivo: …) que
  // no debe filtrarse al título de la pestaña — se muestra el texto limpio.
  const raw = firstUser.content.startsWith(GOAL_PREFIX) ? firstUser.content.slice(GOAL_PREFIX.length) : firstUser.content;
  const t = cleanTitle(raw);
  return t.length > 40 ? t.slice(0, 40) + '…' : t || 'Nueva conversación';
}

export function setProvider(mod) {
  providerRef = mod;
  for (const c of convs.values()) c.agent.setProvider(mod);
}
export function getProvider() { return providerRef; }

export function isBusy() {
  for (const c of convs.values()) if (c.pumping || c.queue.length) return true;
  return false;
}

export function getActive() { return activeId ? convs.get(activeId) : null; }
export function getOpenTabs() { return openTabIds.map(id => convs.get(id)).filter(Boolean); }

async function persistConv(conv) {
  const all = await db.get('kv', 'conversations').catch(() => null) || [];
  const i = all.findIndex(c => c.id === conv.id);
  const rec = {
    id: conv.id, title: titleFor(conv), history: conv.agent.history.slice(-HIST_CAP),
    queue: conv.queue, plan: conv.plan || null, createdAt: conv.createdAt, updatedAt: conv.updatedAt,
  };
  if (i >= 0) all[i] = rec; else all.push(rec);
  await db.set('kv', 'conversations', all).catch(() => {});
}
function persistMeta() {
  try { localStorage.setItem(TABS_KEY, JSON.stringify(openTabIds)); } catch { /* lleno */ }
  try { localStorage.setItem(ACTIVE_KEY, activeId || ''); } catch { /* lleno */ }
}

function makeConv(id, saved) {
  const conv = {
    id, title: saved?.title || null, agent: new Agent(providerRef),
    queue: saved?.queue ? [...saved.queue] : [], pumping: false, plan: saved?.plan || null,
    createdAt: saved?.createdAt || Date.now(), updatedAt: saved?.updatedAt || Date.now(),
  };
  if (saved?.history) conv.agent.history = saved.history;
  convs.set(id, conv);
  return conv;
}

export function create() {
  const conv = makeConv(genId());
  openTabIds.push(conv.id);
  activeId = conv.id;
  persistMeta();
  onChange('switch', conv.id);
  return conv;
}

// reabre una conversación guardada (de la Historial) como pestaña, o activa
// la pestaña si ya estaba abierta
export async function open(id) {
  if (!convs.has(id)) {
    const saved = (await db.get('kv', 'conversations').catch(() => null) || []).find(c => c.id === id);
    if (!saved) return null;
    makeConv(id, saved);
  }
  if (!openTabIds.includes(id)) openTabIds.push(id);
  activeId = id;
  persistMeta();
  onChange('switch', id);
  return convs.get(id);
}

export function switchTo(id) {
  if (!convs.has(id) || activeId === id) return;
  activeId = id;
  persistMeta();
  onChange('switch', id);
}

// añade un mensaje fuera del ciclo normal de envío (p.ej. el informe
// autónomo del cerebro CEO) al historial REAL de una conversación — si no,
// solo viviría en el DOM y desaparecería al cambiar de pestaña o recargar.
export async function appendMessage(id, role, content) {
  const c = convs.get(id);
  if (!c) return;
  c.agent.history.push({ role, content });
  c.updatedAt = Date.now();
  await persistConv(c);
}

// quita la pestaña de la vista — la conversación sigue viva en la Historial
export function closeTab(id) {
  openTabIds = openTabIds.filter(x => x !== id);
  if (activeId === id) activeId = openTabIds[openTabIds.length - 1] || null;
  persistMeta();
  if (!openTabIds.length) create(); else onChange('tabs');
}

// borra la conversación de verdad (desde la Historial)
export async function remove(id) {
  convs.delete(id);
  openTabIds = openTabIds.filter(x => x !== id);
  if (activeId === id) activeId = openTabIds[openTabIds.length - 1] || null;
  const all = (await db.get('kv', 'conversations').catch(() => null) || []).filter(c => c.id !== id);
  await db.set('kv', 'conversations', all).catch(() => {});
  persistMeta();
  if (!openTabIds.length) create(); else onChange('tabs');
}

export async function listAll() {
  const all = await db.get('kv', 'conversations').catch(() => null) || [];
  return all.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---- envío / procesado ----
// items de la cola: {kind:'chat'|'goal', text} — 'chat' es un turno normal
// (agent.handle), 'goal' dispara el planificador/ejecutor de goal.js. Las
// colas persistidas ANTES de que existiera el modo Objetivo guardaban texto
// suelto (strings) — normalizeItem() los sigue aceptando como 'chat'.
let inferenceLock = Promise.resolve();
const normalizeItem = it => (typeof it === 'string' ? { kind: 'chat', text: it } : it);

export function send(id, text) {
  const conv = convs.get(id);
  if (!conv) return;
  conv.queue.push({ kind: 'chat', text });
  persistConv(conv);
  pump(conv);
}

// 🎯 Modo Objetivo: en vez de un turno de chat normal, el mensaje se trata
// como un objetivo — se planifica en tareas y se ejecutan una a una (ver
// goal.js, mismo patrón planificador/ejecutor de clonagent).
export function startGoal(id, text) {
  const conv = convs.get(id);
  if (!conv) return;
  conv.queue.push({ kind: 'goal', text });
  persistConv(conv);
  pump(conv);
}

async function pump(conv) {
  if (conv.pumping) return;
  conv.pumping = true;
  onChange('pumping', conv.id, true);
  while (conv.queue.length) {
    const item = normalizeItem(conv.queue[0]);
    const myTurn = inferenceLock;
    let release;
    inferenceLock = new Promise(r => { release = r; });
    await myTurn; // espera su turno de inferencia (un solo modelo cargado, no admite 2 generate() a la vez)
    try {
      // un fallo aquí (del modelo, de una tool, o del propio repintado en
      // main.js) NUNCA debe dejar la conversación "pumping" para siempre —
      // eso bloquearía sus futuros mensajes Y al cerebro CEO (isBusy()).
      const onEvent = ev => {
        try { onChange('event', conv.id, ev); } catch (e) { console.error('[elffuss] fallo pintando un evento de chat', e); }
      };
      if (item.kind === 'goal') await runGoal(conv, item.text, onEvent);
      else await conv.agent.handle(item.text, onEvent);
    } catch (e) {
      console.error('[elffuss] fallo procesando el turno', e);
      try { onChange('event', conv.id, { type: 'error', text: 'Error interno: ' + (e?.message || e) }); } catch { /* ya está registrado arriba */ }
    } finally { release(); }
    conv.queue.shift();
    conv.updatedAt = Date.now();
    await persistConv(conv);
  }
  conv.pumping = false;
  onChange('pumping', conv.id, false);
}

export async function init({ onEvent }) {
  onChange = onEvent;

  // migración única: el esquema viejo era UNA sola conversación (kv/history + kv/queue)
  const already = await db.get('kv', 'conversations').catch(() => null);
  if (!already) {
    const oldHistory = await db.get('kv', 'history').catch(() => null);
    if (oldHistory?.length) {
      const oldQueue = await db.get('kv', 'queue').catch(() => null);
      await db.set('kv', 'conversations', [{
        id: genId(), title: null, history: oldHistory, queue: oldQueue || [],
        createdAt: Date.now(), updatedAt: Date.now(),
      }]).catch(() => {});
    }
  }

  let tabIds = [], active = null;
  try { tabIds = JSON.parse(localStorage.getItem(TABS_KEY) || '[]'); } catch { /* corrupto */ }
  try { active = localStorage.getItem(ACTIVE_KEY) || null; } catch { /* */ }
  const all = await db.get('kv', 'conversations').catch(() => null) || [];

  for (const id of tabIds) {
    const saved = all.find(c => c.id === id);
    if (saved) { makeConv(id, saved); openTabIds.push(id); }
  }
  if (active && convs.has(active)) activeId = active;
  else if (openTabIds.length) activeId = openTabIds[0];

  if (!openTabIds.length) {
    // nada abierto (primera vez, o se perdió el estado de pestañas): retoma
    // la conversación más reciente si hay alguna, si no, una nueva vacía
    const mostRecent = all.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (mostRecent) { makeConv(mostRecent.id, mostRecent); openTabIds.push(mostRecent.id); activeId = mostRecent.id; }
    else create();
  }
  for (const conv of convs.values()) if (conv.queue.length) pump(conv);
  persistMeta();
}

// Elffuss Code: landing («abre tu carpeta») → IDE con la elfa integrada.
import { parseToolCall } from './agent.js';
import * as rules from './providers/rules.js';
import * as codeTools from './tools/code.js';
import * as db from './db.js';
import * as settings from './settings.js';
import { initEditor, refreshTree, openFile, gotoLine, triggerEditor, hasEditor, saveActive, activeFile, focusEditor } from './ide.js';
import { ACTIVITY, UI } from './icons.js';
import { renderMarkdown } from './md.js';
import * as skills from './skills.js';
import * as terminal from './terminal.js';
import * as shell from './shell.js';
import { setTerminalEcho } from './tools/index.js';
import { ensureModelCache, cacheEstimate, modelUsage, clearModels } from './model-cache.js';
import * as ceo from './ceo.js';
import * as mind from './mind.js';
import { buildCityAdapter, loadThoughtsAdapter } from './mind-adapter.js';
import { humanizeStreamPreview } from './humanize.js';
import { t, applyI18n } from './i18n.js';
import * as bridge from './bridge.js';
import * as conv from './conversations.js';
import { TASK_PREFIX } from './goal.js';
import { hardWork, gatherFolder } from './rlm.js';
import * as workspace from './workspace.js';

// Espacio de trabajo (core): qué de Code puede guardarse en tu disco.
workspace.init({
  app: 'code', ns: 'elffusscode', db,
  stores: [
    { id: 'conversations', label: 'Conversaciones', icon: '💬', kind: 'idb-key', store: 'kv', key: 'conversations',
      files: { ext: '.json', name: c => c.title || c.id } },
    { id: 'skills', label: 'Skills', icon: '🧩', kind: 'idb-key', store: 'kv', key: 'skills',
      files: { ext: '.md', name: s => s.name, body: s => `---\nname: ${s.name}\ndescription: ${s.description || ''}\n---\n\n${s.content || ''}` } },
    { id: 'prefs', label: 'Preferencias', icon: '⚙️', kind: 'ls',
      keys: ['elffusscode.model', 'elffusscode.autoedit', 'elffusscode.goalmode', 'elffuss.acer', 'elffuss.resumen', 'elffuss.semantic'] },
  ],
});
workspace.restore().catch(() => {});

// AVISAR ANTES DE SALIR si hay un turno en marcha.
// ─────────────────────────────────────────────────────────────────────────────
// La conversación sobrevive a recargar —se guarda en IndexedDB y se restaura al
// arrancar—, pero el turno EN CURSO no: la respuesta solo se persiste cuando el
// turno termina, así que refrescar a mitad de generación tira lo que llevara
// escrito. Y volver a empezar no es gratis: hay que subir el modelo a la GPU
// otra vez y releer la conversación entera antes de poder seguir, que con el
// modelo grande son minutos.
//
// El navegador NO deja poner un texto propio —ignora lo que se devuelva y
// enseña el suyo— así que esto solo consigue que PREGUNTE. Es poco, pero es la
// diferencia entre perderlo sin enterarte y que te den la opción.
//
// Solo se avisa si de verdad hay algo vivo: un aviso que salta siempre se
// aprende a ignorar en dos días y entonces ya no avisa de nada.
// `hayTrabajoVivo` cubre LAS DOS cosas, no solo el turno de chat: lo más caro
// de perder es irse a mitad de subir el modelo a la GPU, que con el grande son
// minutos y hay que rehacerlo entero. `loadingId` es no-nulo mientras eso pasa.
const hayTrabajoVivo = () => conv.isBusy() || loadingId !== null;
addEventListener('beforeunload', (e) => {
  if (!hayTrabajoVivo()) return;
  e.preventDefault();
  e.returnValue = '';   // Safari y navegadores viejos miran esto
});
if (workspace.autosaveEnabled()) workspace.autosave({ enabled: true });
// «Guardar solo» guarda de verdad: cada escritura de un almacén que el espacio
// de trabajo copia a disco se le avisa con touch(). Antes nada lo llamaba y el
// autoguardado no escribía nunca, con la casilla marcada.
db.onWrite((store, key) => {
  if (store !== 'kv') return;
  if (key === 'conversations') workspace.touch('conversations');
  else if (key === 'skills') workspace.touch('skills');
});
// Las preferencias viven en localStorage: se avisa al cambiarlas.
const guardaPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* lleno o bloqueado */ } workspace.touch('prefs'); };

import * as telemetry from './telemetry.js';

const $ = id => document.getElementById(id);
// Atajos tal y como se pulsan en ESTA máquina: en un Mac el editor guarda con
// ⌘S y Ctrl+S no hace nada, así que anunciar «Ctrl+S» era mandar a pulsar algo
// que no funciona.
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const atajo = (k, shift = false) => IS_MAC ? '⌘' + (shift ? '⇧' : '') + k : 'Ctrl+' + (shift ? 'Shift+' : '') + k;
// Acciones del editor que no hacen nada sin un fichero abierto: se dice en vez
// de no hacer nada.
const conFichero = fn => () => { if (!activeFile()) { $('statusbar').textContent = t('noFileOpen'); return; } fn(); };
telemetry.init('elffuss-code'); // opt-in, apagado por defecto — ver Ajustes
conv.setProvider(rules); // proveedor por defecto para cualquier conversación que se cree
let activeModel = 'rules';

// ---------- chat ----------
// Los `paths` entre backticks del chat (README.md, .elffuss/soul/x.md…) se
// vuelven ENLACES que abren el fichero en el editor (y en su línea si viene
// «ruta:línea»). Son <a href="#/file/ruta:línea">: se llega con Tab, se abren
// con Enter, y el enlace sirve para volver a ese sitio (ver abreDesdeHash).
// Antes eran <code> con un onclick: solo ratón y sin línea.
const RUTA_RE = /^([\w.-]+(?:\/[\w.-]+)*\.[a-z0-9]{1,10})(?::(\d+))?$/i;
function enlaceFichero(path, line, texto) {
  const a = document.createElement('a');
  a.className = 'file-link';
  a.href = '#/file/' + encodeURI(path) + (line ? ':' + line : '');
  a.textContent = texto;
  a.title = t('openPathTitle', { path: path + (line ? ':' + line : '') });
  a.onclick = e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;   // pestaña nueva: que lo abra el navegador
    e.preventDefault();
    openFile(path).then(() => { if (line) gotoLine(+line); });
  };
  return a;
}
function linkifyFilePaths(root) {
  root.querySelectorAll('code').forEach(el => {
    if (el.closest('pre')) return;
    const txt = el.textContent.trim();
    const m = txt.match(RUTA_RE);
    if (!m || /[{}()<>]/.test(txt)) return;
    el.classList.add('file-link');
    el.replaceChildren(enlaceFichero(m[1], m[2], txt));
  });
}
// #/file/ruta[:línea] abre ese fichero: lo usan los enlaces de arriba (abrir
// en otra pestaña) y sirve para volver al mismo sitio tras recargar.
function abreDesdeHash() {
  let h = location.hash;
  try { h = decodeURI(h); } catch { /* — */ }
  const m = h.match(/^#\/file\/(.+?)(?::(\d+))?$/);
  if (!m || !codeTools.handle()) return;
  openFile(m[1]).then(() => { if (m[2]) gotoLine(+m[2]); });
}
addEventListener('hashchange', abreDesdeHash);

// Todo lo que pinta el chat entra por aquí. Lo que se escribió mientras la elfa
// trabajaba espera AL FINAL, marcado «en cola» (⏳): lo que va llegando del turno
// en curso se coloca ANTES de esos mensajes, para que una respuesta no se lea
// como si contestara a un mensaje que todavía no ha empezado.
function appendLog(node) {
  const log = $('chat-log');
  // Los descartados al parar también hacen de tope mientras el turno parado se
  // suelta: su «(Parado.)» va encima de ellos, no debajo.
  const enCola = node.classList.contains('queued') ? null : log.querySelector(':scope > .msg.user.queued, :scope > .msg.user[data-parada]');
  if (enCola) log.insertBefore(node, enCola); else log.appendChild(node);
}

function addMsg(cls, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  // las respuestas se renderizan como markdown (estilo plugin de Claude Code);
  // lo del usuario y los errores, como texto plano
  if (/^(assistant$|sys)/.test(cls)) {
    div.classList.add('md');
    // cap defensivo: no volcar miles de nodos si una respuesta trae un archivo entero
    div.innerHTML = renderMarkdown(text.length > 8000 ? text.slice(0, 8000) + '\n… (recortado)' : text);
    linkifyFilePaths(div);
  } else {
    div.textContent = text;
  }
  appendLog(div);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
  return div;
}

// estilo plugin de Claude Code: ● herramienta en negrita + detalle plegable
function addTool(tool, arg) {
  const div = document.createElement('div');
  div.className = 'msg tool';
  const dot = document.createElement('span');
  dot.className = 'tdot';
  const b = document.createElement('b');
  b.textContent = tool;
  div.append(dot, b);
  if (arg) {
    const a = document.createElement('span');
    a.className = 'targ';
    const txt = String(arg).slice(0, 60);
    // «● code.read src/app.js»: la ruta se abre con un clic (o Enter)
    const m = String(arg).match(RUTA_RE);
    if (m) a.appendChild(enlaceFichero(m[1], m[2], txt)); else a.textContent = txt;
    div.appendChild(a);
  }
  appendLog(div);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
  return div;
}

function addToolResult(result) {
  const err = result.startsWith('ERROR');
  const det = document.createElement('details');
  det.className = 'msg tool-result' + (err ? ' err' : '');
  const sum = document.createElement('summary');
  sum.textContent = (err ? '⚠️ ' : '') + result.split('\n')[0].slice(0, 90);
  const pre = document.createElement('pre');
  // Los resultados de búsqueda («ruta:línea: texto») enlazan cada acierto.
  for (const linea of result.slice(0, 1500).split('\n')) {
    const m = linea.match(/^([\w.-]+(?:\/[\w.-]+)*\.[a-z0-9]{1,10}):(\d+):(.*)$/i);
    if (m) pre.append(enlaceFichero(m[1], m[2], `${m[1]}:${m[2]}`), ':' + m[3] + '\n');
    else pre.append(linea + '\n');
  }
  det.append(sum, pre);
  appendLog(det);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
  return det;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 🎯 Modo Objetivo: tarjeta de plan (planificador → lista de tareas →
// ejecutor). Un solo nodo por plan (mismo id), repintado in-place según
// llegan los eventos 'plan'/'plan_update'/'plan_complete' — así se ve la
// lista evolucionar en vivo en vez de reconstruirse entera cada vez.
const PLAN_ICO = { pending: '⏳', 'in-progress': '🔄', done: '✅', failed: '❌', skipped: '⏭️', stopped: '⏹️' };
const PLAN_STATUS_LABEL = { planning: t("planPlanning"), running: t("planRunning"), done: t("planDone"), failed: t("planFailed"), stopped: t("planStopped") };
function renderPlanCard(plan) {
  const domId = 'plan-' + plan.id;
  let div = document.getElementById(domId);
  if (!div) {
    div = document.createElement('div');
    div.id = domId;
    div.className = 'msg plan-card';
    appendLog(div);
  }
  div.innerHTML =
    `<span class="plan-status">${escapeHtml(PLAN_STATUS_LABEL[plan.status] || plan.status)}</span>` +
    `<div class="plan-head">🎯 Objetivo: ${escapeHtml(plan.goal)}</div>` +
    (plan.planText ? `<div class="plan-summary">${escapeHtml(plan.planText)}</div>` : '') +
    `<ul class="plan-tasks">` +
    plan.tasks.map(t =>
      `<li class="task-${t.status}"><span class="task-ico">${PLAN_ICO[t.status] || '⏳'}</span>` +
      `<div><div class="task-title">${escapeHtml(t.title)}</div><div class="task-desc">${escapeHtml(t.description)}</div></div></li>`
    ).join('') +
    `</ul>`;
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
  return div;
}

export function thinkingBubble() {
  const div = addMsg('thinking', '');
  const label = document.createElement('span');
  label.textContent = t('thinking');
  const gen = document.createElement('div');
  gen.className = 'gen';
  div.append(label, gen);
  let buf = '';
  return {
    tick(tok) {
      buf += tok;
      label.textContent = t('writing', { n: buf.length }); // caracteres, no tokens
      // si el buffer entró en un bloque de tool-call, no enseñes el JSON crudo
      // según va llegando: una frase humana («leyendo app.js…») en su lugar.
      const preview = humanizeStreamPreview(buf);
      gen.classList.toggle('tool-preview', !!preview);
      if (preview) { gen.textContent = '⟐ ' + preview; $('chat-log').scrollTop = $('chat-log').scrollHeight; }
      else {
        // texto normal: crece y se puede leer (antes solo los últimos 200 y lo
        // de arriba desaparecía); se respeta tu scroll si subes a leer.
        const pegado = gen.scrollHeight - gen.scrollTop - gen.clientHeight < 28;
        gen.textContent = buf;
        if (pegado) gen.scrollTop = gen.scrollHeight;
      }
    },
    tool(name) { buf = ''; gen.textContent = ''; label.textContent = t('using', { name }); },
    remove() { div.remove(); },
  };
}

// Conversaciones (pestañas, en paralelo, con su propia cola): la lógica de
// estado vive en conversations.js — aquí solo se pinta lo que corresponde.
let activeThinking = null;

function renderActiveLog() {
  $('chat-log').replaceChildren();
  const active = conv.getActive();
  activeThinking = null;
  if (!active) return;
  for (const m of active.agent.history) {
    if (m.role === 'user') {
      if (m.content.startsWith('[resultado ')) {
        const nl = m.content.indexOf('\n');
        addToolResult(nl > 0 ? m.content.slice(nl + 1) : '');
      } else if (m.content.startsWith(TASK_PREFIX)) {
        // objetivo/tareas internas del modo Goal: no son burbujas sueltas —
        // la tarjeta de plan las muestra todas. Se pinta justo en el punto
        // donde se lanzó el objetivo, igual que aparece en directo.
        if (m.content.startsWith(TASK_PREFIX + 'Objetivo: ') && active.plan) renderPlanCard(active.plan);
      } else if (!m.content.startsWith('[…')) {
        addMsg('user', m.content);
      }
    } else {
      const call = parseToolCall(m.content);
      if (call) addTool(call.tool, call.args?.path || call.args?.query || '');
      else {
        const div = addMsg('assistant', m.content);
        if (m.propuesta) botonPropuesta(div, m.propuesta);
      }
    }
  }
  if (active.pumping) activeThinking = thinkingBubble();
  // Lo que espera en la cola todavía no está en el historial: sin esto, al
  // volver a la pestaña los mensajes encolados desaparecían de la vista.
  for (const it of active.queue) if (it !== active.turno) addMsg('user queued', typeof it === 'string' ? it : it.text).title = t('queuedTitle');
}

// evento del módulo de conversaciones: 'switch' (cambiaste de pestaña o se
// creó una), 'tabs' (se abrió/cerró una pestaña), 'pumping' (empezó/terminó
// de procesar), 'event' (token/texto/tool/resultado/error de un turno real).
// Las conversaciones EN SEGUNDO PLANO nunca tocan el DOM visible — solo se
// refleja su punto de «ocupada» en la barra de pestañas.
function onConvEvent(kind, id, payload) {
  if (kind === 'turn') {
    // Un mensaje encolado empieza: deja de estar «en cola» y la burbuja de
    // «pensando» pasa debajo de él (era la del turno anterior, más arriba).
    const active = conv.getActive();
    if (!active || id !== active.id) return;
    const enCola = $('chat-log').querySelector(':scope > .msg.user.queued');
    if (enCola) {
      enCola.classList.remove('queued');
      enCola.removeAttribute('title');
      if (activeThinking) { activeThinking.remove(); activeThinking = thinkingBubble(); }
    }
    return;
  }
  if (kind !== 'event') renderTabsBar();
  // El botón es de la conversación ACTIVA: al cambiar de pestaña se repinta.
  // Antes se quedaba como lo dejó la anterior — un ■ sobre una conversación
  // parada, o un ▶ sobre una que seguía trabajando.
  if (kind === 'switch') { renderActiveLog(); paintSendButton(); return; }
  const active = conv.getActive();
  if (!active || id !== active.id) return;
  if (kind === 'pumping') {
    // NO deshabilitar el botón mientras genera: se convierte en PARAR. Antes se
    // ponía disabled=payload, y por eso no había forma de cortar un run largo.
    paintSendButton();
    if (payload) { if (!activeThinking) activeThinking = thinkingBubble(); }
    else { activeThinking?.remove(); activeThinking = null; }
    return;
  }
  if (kind === 'stopping') {
    // Parar vacía la cola: lo que esperaba ya no se va a mandar, y se dice.
    if (payload) for (const m of $('chat-log').querySelectorAll(':scope > .msg.user.queued')) {
      m.classList.replace('queued', 'cancelled');
      m.title = t('queuedCancelled');
      m.dataset.parada = '1';
    }
    else for (const m of $('chat-log').querySelectorAll(':scope > .msg.user[data-parada]')) delete m.dataset.parada;
    paintSendButton();
    anunciarEnvio(payload ? t('stopping') : t('stopped'));
    return;
  }
  if (kind === 'event') {
    const ev = payload;
    if (ev.type === 'token') activeThinking?.tick(ev.text);
    if (ev.type === 'text') addMsg('assistant', ev.text);
    if (ev.type === 'tool') { activeThinking?.tool(ev.call.tool); addTool(ev.call.tool, ev.call.args?.path || ev.call.args?.query || ''); }
    if (ev.type === 'tool_result') addToolResult(ev.result);
    if (ev.type === 'progress') activeThinking?.tool(ev.text);
    if (ev.type === 'error') addMsg('assistant err', ev.text);
    if (ev.type === 'aborted') addMsg('assistant muted', ev.text);
    // 🎯 Modo Objetivo: la tarjeta de plan se crea con 'plan' y se repinta
    // in-place en cada 'plan_update'/'plan_complete' (mismo nodo, por id).
    if (ev.type === 'plan' || ev.type === 'plan_update' || ev.type === 'plan_complete') renderPlanCard(ev.plan);
  }
}

function send(text, modo) {
  const active = conv.getActive();
  if (!active) return;
  // Si la elfa ya está con algo, el mensaje espera su turno y se ve así (⏳).
  const burbuja = addMsg(active.pumping || active.queue.length ? 'user queued' : 'user', text);
  if (burbuja.classList.contains('queued')) burbuja.title = t('queuedTitle');
  if (modo === 'hard') conv.startHardWork(active.id, text);
  else if (goalMode) conv.startGoal(active.id, text);
  else conv.send(active.id, text);
}

// Pestañas de conversación con semántica de pestañas: la activa entra con Tab,
// ←/→ se mueven, Supr cierra, Shift+F10 abre su menú (Renombrar, Cerrar,
// Cerrar otras). Antes eran <div> sin foco y la × un <b>; el punto de
// «trabajando» se anuncia también en el nombre accesible.
function renderTabsBar() {
  const bar = $('conv-tabs');
  if (!bar) return;
  const teniaFoco = bar.contains(document.activeElement);
  bar.replaceChildren();
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', t('convTabs'));
  const active = conv.getActive();
  const abiertas = conv.getOpenTabs();
  for (const c of abiertas) {
    const el = document.createElement('div');
    const on = !!active && c.id === active.id;
    el.className = 'tab' + (on ? ' active' : '') + (c.pumping ? ' tab-busy' : '');
    el.dataset.id = c.id;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', on ? 'true' : 'false');
    el.tabIndex = on ? 0 : -1;
    const name = document.createElement('span');
    name.className = 'tab-name';
    const title = conv.titleFor(c);
    name.textContent = title;
    name.title = title;
    el.setAttribute('aria-label', title + (c.pumping ? ' · ' + t('convBusy') : ''));
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tab-x';
    x.tabIndex = -1;
    x.textContent = '×';
    x.title = t('tabClose');
    x.setAttribute('aria-label', t('tabCloseNamed', { title }));
    x.onclick = e => { e.stopPropagation(); conv.closeTab(c.id); };
    el.append(name, x);
    el.onclick = () => conv.switchTo(c.id);
    el.oncontextmenu = e => { e.preventDefault(); menuConversacion(c, e.clientX, e.clientY, el); };
    el.onkeydown = e => {
      const i = abiertas.indexOf(c);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const n = abiertas[(i + (e.key === 'ArrowRight' ? 1 : abiertas.length - 1)) % abiertas.length];
        conv.switchTo(n.id);
        $('conv-tabs').querySelector(`.tab[data-id="${n.id}"]`)?.focus();
      } else if (e.key === 'Delete') { e.preventDefault(); conv.closeTab(c.id); $('conv-tabs').querySelector('.tab.active')?.focus(); }
      else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = el.getBoundingClientRect(); menuConversacion(c, r.left, r.bottom, el); }
    };
    bar.appendChild(el);
  }
  const plus = document.createElement('button');
  plus.className = 'tab-add';
  plus.title = t('newConv');
  plus.setAttribute('aria-label', t('newConv'));
  plus.textContent = '+';
  plus.onclick = () => conv.create();
  bar.appendChild(plus);
  if (teniaFoco) bar.querySelector('.tab.active')?.focus();
}

// Menú de una pestaña de conversación (botón derecho / Shift+F10).
function menuConversacion(c, x, y, volver) {
  document.getElementById('conv-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'conv-menu';
  menu.className = 'conv-menu';
  menu.setAttribute('role', 'menu');
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200`;
  const cerrar = () => { menu.remove(); document.removeEventListener('mousedown', fuera, true); volver?.focus?.(); };
  const fuera = ev => { if (!menu.contains(ev.target)) cerrar(); };
  const opciones = [
    [t('convRename'), async () => {
      const nuevo = prompt(t('convRenamePrompt'), conv.titleFor(c));
      if (nuevo != null) await conv.rename(c.id, nuevo);
    }],
    [t('tmClose'), () => conv.closeTab(c.id)],
    [t('tmCloseOthers'), () => { for (const o of conv.getOpenTabs()) if (o.id !== c.id) conv.closeTab(o.id); conv.switchTo(c.id); }],
  ];
  for (const [label, fn] of opciones) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tm-item'; b.setAttribute('role', 'menuitem'); b.textContent = label;
    b.onclick = () => { cerrar(); fn(); };
    menu.appendChild(b);
  }
  menu.addEventListener('keydown', e => {
    const l = [...menu.querySelectorAll('[role="menuitem"]')], i = l.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); l[(i + 1) % l.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); l[(i - 1 + l.length) % l.length].focus(); }
  });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('mousedown', fuera, true), 0);
  menu.querySelector('button')?.focus();
}

async function renderHistoryPanel() {
  const panel = $('history-panel');
  panel.replaceChildren();
  // Un diálogo con filas que son botones: antes eran <div> y solo se usaban
  // con el ratón. La conversación activa se marca (aria-current).
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'hp-title');
  const head = document.createElement('div');
  head.className = 'hp-head';
  const tit = document.createElement('span'); tit.id = 'hp-title'; tit.textContent = t('tHistory');
  head.append(tit);
  const xBtn = document.createElement('button');
  xBtn.textContent = '✕';
  xBtn.setAttribute('aria-label', t('close'));
  xBtn.onclick = () => cierraHistorial();
  head.appendChild(xBtn);
  panel.appendChild(head);
  const list = document.createElement('div');
  list.id = 'hp-list';
  panel.appendChild(list);
  const all = await conv.listAll();
  if (!all.length) {
    const empty = document.createElement('div');
    empty.className = 'hp-empty';
    empty.textContent = t('histEmpty');
    list.appendChild(empty);
    return;
  }
  const activa = conv.getActive()?.id;
  for (const c of all) {
    const row = document.createElement('div');
    row.className = 'hp-row';
    const abrir = document.createElement('button');
    abrir.type = 'button';
    abrir.className = 'hp-open';
    if (c.id === activa) abrir.setAttribute('aria-current', 'true');
    const titEl = document.createElement('span');
    titEl.className = 'hp-title';
    titEl.textContent = c.title || t('newConv');
    const d = new Date(c.updatedAt);
    const date = document.createElement('span');
    date.className = 'hp-date';
    date.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    abrir.append(titEl, date);
    abrir.onclick = async () => { await conv.open(c.id); cierraHistorial({ foco: false }); $('prompt').focus(); };
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'hp-del';
    del.title = t('histDel');
    del.setAttribute('aria-label', t('histDelNamed', { title: c.title || t('thisConv') }));
    del.textContent = '🗑';
    del.onclick = async e => {
      e.stopPropagation();
      if (!confirm(t('confirmDel', { title: c.title || t('thisConv') }))) return;
      await conv.remove(c.id);
      await renderHistoryPanel();
      ($('history-panel').querySelector('.hp-open') || $('history-panel').querySelector('.hp-head button'))?.focus();
    };
    row.append(abrir, del);
    list.appendChild(row);
  }
}

// ---------- modelos (local primero; externos = ⚙️ opt-in) ----------
const localProviders = { litert: () => import('./providers/litert.js'), onnx: () => import('./providers/onnx.js') };

async function resolveProvider(id) {
  if (localProviders[id]) return localProviders[id]();
  if (id.startsWith('litert:')) {            // Gemma vía LiteRT-LM (build elegido)
    const mod = await import('./providers/litert.js');
    mod.configure(id.slice(7));
    return mod;
  }
  if (id.startsWith('onnx:')) {              // ONNX concreto (Qwen3.5…)
    const mod = await import('./providers/onnx.js');
    mod.configure(id.slice(5));
    return mod;
  }
  if (id.startsWith('engine:')) {            // runtime WebGPU propio (GGUF)
    // El motor no se versiona en este repo: llega a web/js/engine/ por rsync,
    // igual que en Claw. Si no está, el import falla y se trata como cualquier
    // otro fallo de carga.
    const mod = await import('./engine/provider.js');
    mod.configure(id.slice(7));
    // Igual que en Claw: solo el motor propio mide tok/s (`alMedir`), así que
    // con ONNX o con un proveedor externo el chip se queda oculto en vez de
    // mentir con un número que nadie ha medido.
    try {
      const vm = await import('./velocimetro.js');
      vm.montar(mod);
    } catch (e) { console.warn('[code] velocímetro no disponible:', e.message); }
    return mod;
  }
  if (id.startsWith('ext:')) {
    const cfg = settings.get(id.slice(4));
    const mod = await import('./providers/api.js');
    mod.configure(cfg);
    return mod;
  }
  return null;
}

// El E4B healed (4.12 GB) NO carga aún en navegador (export prefill_decode, no
// artisan) — descargarlo y fallar deja la GPU en estado inválido y TUMBA la
// pestaña. Se oculta hasta el reexport artisan. Poner true para reactivarlo.
const LITERT_READY = false;

const isMobile = () => matchMedia('(max-width: 820px)').matches || matchMedia('(pointer: coarse)').matches;
// navigator.gpu puede EXISTIR como API sin que haya un adaptador real (ciertos
// Linux/drivers, entornos sandboxed/headless…) — comprobarlo UNA vez al
// arrancar evita ofrecer/elegir Gemma (2-4 GB) cuando de todos modos va a
// fallar al crear el motor (onnx.js y litert.js ya comprueban el adaptador
// por su cuenta como defensa adicional, pero esto evita hasta OFRECERLO).
let realGPU = !!navigator.gpu;
const realGPUCheck = (async () => {
  if (!navigator.gpu) return (realGPU = false);
  try { return (realGPU = !!(await navigator.gpu.requestAdapter())); }
  catch { return (realGPU = false); }
})();
// Capacidad real de la GPU: no basta con que exista navigator.gpu, hay que
// mirar los límites del adaptador — un buffer máximo pequeño no aguanta Gemma.
async function gpuCapacity() {
  const mem = navigator.deviceMemory || 8;               // GB (grueso, tope 8 en Chrome)
  if (!navigator.gpu) return { gpu: false, maxBuf: 0, mem };
  try {
    const a = await navigator.gpu.requestAdapter();
    if (!a) return { gpu: false, maxBuf: 0, mem };
    return { gpu: true, maxBuf: a.limits?.maxBufferSize || 0, mem };
  } catch { return { gpu: false, maxBuf: 0, mem }; }
}

// Auto-selección: el modelo MÁS GRANDE que entre en esta máquina. Gemma por
// LiteRT si la GPU aguanta sus buffers; si no, un ONNX pequeño (WebGPU o wasm).
async function pickLocalBrain() {
  const c = await gpuCapacity();
  if (c.gpu && !isMobile()) {
    if (c.maxBuf >= 2 ** 31 && c.mem >= 8) return 'litert:gemma-e4b';   // ~4 GB
    if (c.maxBuf >= 2 ** 30 && c.mem >= 6) return 'litert:gemma-e2b';   // ~2 GB
  }
  if (c.gpu && isMobile()) return 'litert:gemma-e2b';
  return 'onnx';   // ONNX pequeño: Qwen3.5-0.8B por defecto (ver model-config.js)
}
// heurística vieja como último recurso síncrono
const defaultBrain = () => !realGPU ? 'onnx' : (isMobile() ? 'litert:gemma-e2b' : 'litert:gemma-e4b');

// El runtime propio y su modelo grande se SONDEAN, no se cablean: el motor
// llega por rsync y el modelo son gigabytes que pueden no estar alojados.
// Ofrecer algo que no está sería prometer un fallo que llega DESPUÉS de que el
// usuario haya esperado, que es la peor forma de fallar.
// Mismo patrón que el 27B: nombre y tamaño salen del REGISTRO del motor, nunca
// de un literal aquí. Un nombre duplicado es un nombre que se queda viejo.
// ⚠️ Con HANDLE, no «fire and forget». La lista del selector se construye tras
// esperar las sondas de disponibilidad, así que una sonda que nadie espera deja
// su bandera en false cuando se pinta la lista y el modelo no aparece — se sirve
// y nadie puede elegirlo, el mismo modo de fallo que escondió a Bonsai. Pasó con
// esta misma sonda: en una app se colaba por carrera y en la otra no aparecía.
let MINICPM_READY = false, MINICPM_LABEL = 'MiniCPM5 2B', MINICPM_GB = 0;
const minicpmCheck = (async () => {
  try {
    const reg = await import('./engine/registro.js');
    const m = reg.MODELS && reg.MODELS['minicpm5-2b'];
    if (m) { MINICPM_LABEL = m.label || MINICPM_LABEL; MINICPM_GB = (m.bytes || 0) / 1e9; }
    MINICPM_READY = await reg.disponible('minicpm5-2b');
    return MINICPM_READY;
  } catch { return (MINICPM_READY = false); }
})();

let ENGINE_READY = false, MODEL27_READY = false;
let MODEL27_LABEL = 'Modelo grande';
let MODEL27_GB = 0;
const engineCheck = (async () => {
  try { return (ENGINE_READY = (await fetch('js/engine/provider.js', { method: 'HEAD', cache: 'no-store' })).ok); }
  catch { return (ENGINE_READY = false); }
})();
// Se le pregunta AL MOTOR por sus propios ficheros. Aquí había cableada la URL
// del 27B de un solo trozo; cuando pasó a dos fragmentos en dos hosts, esta
// línea siguió sondeando el fichero viejo y dando 200 de milagro, porque aún
// estaba en el servidor. El día que se borre, la opción desaparece del selector
// y nadie ata los dos cabos. Se importa el registro (unos kilobytes) y no el
// proveedor, que arrastra el motor entero.
const modelo27Check = (async () => {
  try {
    const reg = await import('./engine/registro.js');
    // El NOMBRE y el TAMAÑO salen del registro del motor, no de un literal aquí.
    // Estaban a mano y al cambiar de modelo mintieron en tres cosas a la vez:
    // decían «Qwen3.8-27B IQ1» y «~7,6 GB» cuando lo que se sirve es el ternario
    // de Prism y son 7,2 GB. Un nombre duplicado es un nombre que se queda viejo.
    const m27 = reg.MODELS && reg.MODELS['qwen38-27b'];
    if (m27) { MODEL27_LABEL = m27.label || MODEL27_LABEL; MODEL27_GB = (m27.bytes || 0) / 1e9; }
    return (MODEL27_READY = await reg.disponible('qwen38-27b'));
  } catch { return (MODEL27_READY = false); }
})();

// Los modelos LOCALES, en un solo sitio. Los usan el desplegable y las tarjetas
// de los ajustes: hasta ahora eran dos listas escritas a mano y la de ajustes se
// quedó vieja — no ofrecía NI el motor propio ni el 27B, así que desde ahí era
// imposible elegir Bonsai por mucho que el motor lo sirviera. Es justo el modo
// de fallo que avisa el comentario de `modelo27Check`: un nombre duplicado es un
// nombre que se queda viejo.
function modelOptionsLocales() {
  const opts = [];
  if (realGPU) opts.push({ id: 'litert:gemma-e4b', label: 'Gemma-4 E4B · LiteRT-LM (~4 GB) ★' });
  if (realGPU) opts.push({ id: 'litert:gemma-e2b', label: 'Gemma-4 E2B · LiteRT-LM (~2 GB)' });
  // `onnx` a secas era Elffuss LM y se ha quitado. Ojo con el patrón: ESTE era
  // el TERCER sitio donde el mismo modelo estaba declarado a mano (el registro
  // de model-config.js, la lista del lab y esta), y quitarlo de los dos
  // primeros lo dejaba igual de visible aquí. Es el mismo modo de fallo que el
  // comentario de arriba avisa para Bonsai: un nombre duplicado es un nombre
  // que se queda viejo.
  opts.push({ id: 'onnx:qwen3.5-0.8b', label: 'Qwen3.5-0.8B · WebGPU (~600 MB)' });
  if (realGPU && ENGINE_READY) opts.push({ id: 'engine:qwen35-0.8b', label: 'Qwen3.5-0.8B · Elffuss Engine (~800 MB)' });
  // El 27B se guarda tras la primera descarga (repartido en dos servidores y
  // troceado, porque el navegador corta un fichero suelto sobre 1,94 GB), así
  // que son «gigas una vez», no «gigas cada vez». Sigue siendo lento: la espera
  // cae entera antes de la primera palabra.
  // MiniCPM5-2B por el motor propio. Va en «Avanzado» y sin estrella a
  // propósito: carga y responde con texto limpio, y eso es TODO lo que está
  // comprobado. No se ha medido contra Gemma E4B, que es el predeterminado, así
  // que la etiqueta no promete velocidad ni calidad.
  if (realGPU && ENGINE_READY && MINICPM_READY) opts.push({ id: 'engine:minicpm5-2b', label: `${MINICPM_LABEL} · Elffuss Engine (${MINICPM_GB.toFixed(1)} GB, se guarda)`, group: '⚠ Avanzado' });
  if (realGPU && ENGINE_READY && MODEL27_READY) opts.push({ id: 'engine:qwen38-27b', label: `${MODEL27_LABEL} · Elffuss Engine (${MODEL27_GB.toFixed(1)} GB, se guarda: solo se baja la primera vez) — lento`, group: '⚠ Avanzado' });
  opts.push({ id: 'rules', label: t('setModelRulesName') });
  return opts;
}

function modelOptions() {
  return [...modelOptionsLocales(), ...settings.enabledExternals()];
}

function rebuildSelect() {
  const sel = $('model-select');
  sel.replaceChildren();
  // Los grupos avisados («⚠ Avanzado») van SIEMPRE al final. Si se crean según
  // aparecen, basta una opción agrupada en mitad de la lista para que las
  // siguientes queden colgando bajo el encabezado de aviso — le pasó a «Básico
  // (sin modelo)» en Claw, que es la opción más segura que hay.
  const grupos = new Map();
  for (const o of modelOptions()) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.label;
    if (o.group) {
      let g = grupos.get(o.group);
      if (!g) { g = document.createElement('optgroup'); g.label = o.group; grupos.set(o.group, g); }
      g.appendChild(opt);
    } else {
      sel.appendChild(opt);
    }
  }
  for (const g of grupos.values()) sel.appendChild(g);
  sel.value = activeModel;
}

// progreso del modelo: píldora prominente visible sobre landing e IDE.
// Es una región viva (role=status en el HTML). Con `reintentar`, un fallo deja
// un botón para volver a intentarlo y otro para cerrar, y no se esconde solo.
function showModelProgress(text, pct = null, { reintentar = null } = {}) {
  const box = $('model-progress');
  box.querySelector('.mp-acciones')?.remove();
  if (text == null) { box.hidden = true; return; }
  box.hidden = false;
  $('model-progress-text').textContent = text;
  if (reintentar) {
    const acc = document.createElement('div'); acc.className = 'mp-acciones';
    const r = document.createElement('button'); r.type = 'button'; r.textContent = t('retry');
    r.onclick = () => { acc.remove(); reintentar(); };
    const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', t('close'));
    x.onclick = () => showModelProgress(null);
    acc.append(r, x);
    box.querySelector('.mp-body').appendChild(acc);
  }
  const bar = $('model-bar');
  if (pct == null) {
    bar.classList.add('indet');      // sin % conocido → barra animada
    bar.style.width = '';
  } else {
    bar.classList.remove('indet');
    bar.style.width = pct + '%';
  }
}

// El punto de estado del modelo dice con palabras qué modelo es y cómo está
// (antes era solo un color, con el título «modelo» siempre), y es un botón que
// lleva a Ajustes → Cerebro.
function pintaDot(estado, id) {
  const d = $('model-dot');
  if (!d) return;
  d.className = 'dot ' + (estado === 'error' ? 'off' : estado);
  const nombre = (modelOptions().find(o => o.id === id)?.label || id || '').replace(/\s*★$/, '');
  const txt = id === 'rules' ? t('modelDotBasic') : t('modelDot', { name: nombre, state: t('modelState_' + estado) });
  d.title = txt;
  d.setAttribute('aria-label', txt);
}

function errorHumano(e) {
  const m = String(e?.message || e || '');
  if (/Failed to fetch|NetworkError|network|ERR_/i.test(m)) return t('errNet');
  if (/adaptador WebGPU|No available adapters|webgpu|requestAdapter/i.test(m)) return t('errGpu');
  if (/quota|QuotaExceeded/i.test(m)) return t('errQuota');
  if (/out of memory|memory|OOM|Aborted/i.test(m)) return t('errMem');
  return m || t('errUnknown');
}

let loadingId = null;
// Lo pone renderSettings: repinta las tarjetas de modelo del panel abierto.
let repintaTarjetasModelo = () => {};
// Solo el motor propio mide tok/s: con cualquier otro cerebro el chip ⚡ se
// oculta (montar(null)) en vez de seguir enseñando las cifras del motor.
const apagaVelocimetro = () => import('./velocimetro.js').then(v => v.montar(null)).catch(() => {});

async function changeModel(id) {
  if (id === 'rules') {
    conv.setProvider(rules);
    apagaVelocimetro();
    activeModel = 'rules';
    guardaPref('elffusscode.model', 'rules');
    pintaDot('off', 'rules');
    return true;
  }
  if (loadingId === id || activeModel === id) return true; // un solo modelo, una sola carga
  loadingId = id;
  pintaDot('loading', id);
  showModelProgress(t("stModelLoadingAI"), 4);
  try {
    const mod = await resolveProvider(id);
    await mod.load(p => {
      if (typeof p === 'string') return showModelProgress(p);
      if (p?.status === 'progress' && p.total) {
        const pct = Math.round(p.loaded / p.total * 100);
        showModelProgress(t('modelLoading', { pct, loaded: (p.loaded / 1e6 | 0), total: (p.total / 1e6 | 0) }), pct);
      }
    });
    conv.setProvider(mod);
    if (!id.startsWith('engine:')) apagaVelocimetro();
    // AHORA sí se reanuda lo que quedó a medias. Al refrescar durante un turno,
    // el mensaje sigue en la cola —se guarda al enviarlo— pero reanudarlo antes
    // de este punto lo habría procesado con el cerebro básico. Aquí ya hay
    // modelo de verdad.
    //
    // Si un turno ya se intentó dos veces sin terminar, no se reanuda solo: lo
    // normal es que esté tumbando la pestaña, y reintentarlo al abrir deja al
    // usuario en un bucle del que no sale ni cerrando. Se le cuenta y decide.
    conv.resumePending((convId, item) => {
      const texto = String(item?.text || '').slice(0, 60);
      addMsg('sys', `⚠️ «${texto}…» se quedó a medias dos veces y no lo reintento solo: puede estar agotando la memoria. ` +
        `Escribe otra cosa para seguir, o vuelve a enviarlo si quieres insistir.`);
      conv.descartarPendiente(convId);
    });
    // El medidor de contexto pasa a hablar del modelo QUE ESTÁ CARGADO. Quien no
    // sepa decir su contexto deja el valor de reserva, así que esto no puede
    // romper a un proveedor que no lo implemente.
    try { if (typeof mod.contextTokens === 'function') setCtxBudget(mod.contextTokens()); }
    catch { /* el medidor no vale un fallo de carga */ }
    activeModel = id;
    guardaPref('elffusscode.model', id);
    pintaDot('on', id);
    showModelProgress(t('modelReadyBadge'), 100);
    setTimeout(() => showModelProgress(null), 2500);
    $('statusbar').textContent = t('modelReady');
    rebuildSelect();
    return true;
  } catch (e) {
    console.error('[elffuss-code] fallo cargando', e);
    // Un Gemma (LiteRT) que no cabe → cae al ligero (onnx, Qwen3.5-0.8B).
    if (id.startsWith('litert') && !_fellBack) {
      _fellBack = true;
      sessionStorage.setItem('elffusscode.skipGemma', '1');
      showModelProgress(t('fallbackToast'));
      loadingId = null;
      const okc = await changeModel('onnx');
      _fellBack = false;
      if (okc) return true;
    }
    conv.setProvider(rules);
    apagaVelocimetro();
    activeModel = 'rules';
    pintaDot('error', id);
    // En palabras de persona («sin conexión», «sin GPU», «sin espacio»…), con
    // el detalle técnico en la consola, y un botón para reintentar.
    showModelProgress(t('modelLoadFailed', { e: errorHumano(e) }), null, { reintentar: () => changeModel(id) });
    $('model-bar').classList.remove('indet');
    rebuildSelect();
    return false;
  } finally {
    loadingId = null;
    repintaTarjetasModelo();       // Ajustes abierto: la activa y el «cargando…» al día
  }
}
let _fellBack = false;

// El cerebro empieza a descargarse desde el PRIMER segundo, en segundo plano,
// mientras el usuario elige la carpeta. Solo el modelo local — los externos
// jamás se activan solos.
// Cadena de respaldo: el modelo preferido → LFM2.5 local → básico. Si el E4B
// healed falla (p. ej. «HF_Tokenizer_Zlib not supported» del runtime LiteRT),
// cae solo a LFM2.5 en vez de dejar al usuario sin cerebro.
async function preloadModel() {
  const saved = localStorage.getItem('elffusscode.model');
  if (saved === 'rules') return;
  await realGPUCheck; // que defaultBrain()/modelOptions() vean el adaptador real, no solo la API
  // Las sondas del motor y del modelo grande resuelven DESPUÉS de que se pinte
  // el selector, así que hay que repintarlo: sin esto la opción no aparece
  // hasta que algo más fuerce un refresco, y el usuario no la ve nunca.
  const [hayMotor, hay27, hayMini] = await Promise.all([engineCheck, modelo27Check, minicpmCheck]);
  if (hayMotor || hay27 || hayMini) rebuildSelect();
  const avail = new Set(modelOptions().map(o => o.id));
  const skipGemma = sessionStorage.getItem('elffusscode.skipGemma') === '1';
  const def = skipGemma ? 'onnx' : await pickLocalBrain();
  const chain = [...new Set([saved, def, 'onnx']
    .filter(id => id && id !== 'rules' && avail.has(id)))];
  // MÓVIL: no descargar ~1,9 GB sin permiso. defaultBrain() elige gemma-e2b en
  // móvil, y medido el 2026-09-08 con un iPhone emulado contra producción: al
  // abrir la página arrancaban OCHO peticiones de pesos sin que el usuario
  // pidiera nada. Son casi dos gigas de datos de alguien que solo entró a
  // mirar, y encima el navegador de móvil mata la pestaña bastante antes de
  // sostener ese modelo, así que se gastaban para nada. Se avisa y se espera.
  if (isMobile() && localStorage.getItem('elffusscode.movil.ok') !== '1') {
    avisoMovil('~1,9 GB', () => {
      (async () => { for (const id of chain) if (await changeModel(id)) return; })();
    });
    return;
  }
  for (const id of chain) if (await changeModel(id)) return;
}

// ---------- panel ⚙️ Ajustes: modelo (cerebro) + API keys ----------
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

// Ajustes (y el panel de skills, que usa el mismo sitio) es un diálogo: se
// anuncia como tal, el foco entra en él al abrirse y vuelve a quien lo abrió
// al cerrarse (también con Escape). Antes el foco se quedaba en el engranaje.
let volverDeAjustes = null;
function settingsShell(title) {
  const box = $('settings-panel');
  const yaAbierto = !box.hidden && box.contains(document.activeElement);
  if (box.hidden || !volverDeAjustes) volverDeAjustes = document.activeElement;
  box.hidden = false;
  box.replaceChildren();
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-labelledby', 'settings-title');
  const close = el('button', 'panel-close'); close.innerHTML = UI.close; close.title = t("close");
  close.setAttribute('aria-label', t('close'));
  close.onclick = () => cierraAjustes();
  const h = el('h3', 'panel-title', title); h.id = 'settings-title'; h.tabIndex = -1;
  box.append(close, h);
  if (!yaAbierto) requestAnimationFrame(() => h.focus());
  return box;
}
function cierraAjustes() {
  const box = $('settings-panel');
  if (box.hidden) return;
  box.hidden = true;
  const v = volverDeAjustes; volverDeAjustes = null;
  if (v && document.body.contains(v)) v.focus();
}

function showBridgeMsg(card, text, isErr) {
  let el2 = card.querySelector('.br-msg');
  if (!el2) { el2 = document.createElement('div'); el2.className = 'br-msg muted'; el2.setAttribute('role', 'status'); el2.style.cssText = 'font-size:.7rem;margin-top:6px'; card.appendChild(el2); }
  el2.textContent = text;
  el2.style.color = isErr ? '#ff6b8b' : '';
}

// Qué bridge descargar. Todos los Mac dicen «MacIntel» en navigator.platform,
// también los Apple Silicon, y por eso a un Mac ARM se le ofrecía la versión
// Intel. Se pregunta la arquitectura a userAgentData (Chrome/Edge) y, si no se
// puede saber (Safari), se ofrecen las DOS versiones de Mac en vez de adivinar.
async function bridgeParaEstaMaquina() {
  const ua = navigator.userAgent;
  let arch = '';
  try { arch = (await navigator.userAgentData?.getHighEntropyValues?.(['architecture']))?.architecture || ''; } catch { /* sin datos */ }
  if (/Mac/.test(ua)) {
    if (arch === 'arm') return ['elffuss-bridge-mac-arm64'];
    if (arch === 'x86') return ['elffuss-bridge-mac-intel'];
    return ['elffuss-bridge-mac-arm64', 'elffuss-bridge-mac-intel'];
  }
  if (/Win/.test(ua)) return ['elffuss-bridge-windows.exe'];
  if (/Linux/.test(ua)) return [arch === 'arm' || /aarch64|arm64/i.test(ua) ? 'elffuss-bridge-linux-arm64' : 'elffuss-bridge-linux'];
  return ['elffuss-bridge-mac-arm64', 'elffuss-bridge-mac-intel'];
}
async function pintaDescargasBridge(card, NOMBRES) {
  const principales = await bridgeParaEstaMaquina();
  const host = card.querySelector('#br-dl'), otros = card.querySelector('#br-dl-other');
  if (!host || !otros) return;
  const enlace = (f, principal) => {
    const a = document.createElement('a');
    a.href = 'bridge-dl/' + f; a.setAttribute('download', '');
    a.dataset.file = f;
    if (principal) { a.className = 'prov-use'; a.style.cssText = 'text-decoration:none;display:inline-block;margin:0 6px 6px 0'; a.textContent = t('setBridgeDownload', { os: NOMBRES[f] }); }
    else { a.style.cssText = 'color:var(--accent2);font-size:.72rem'; a.textContent = NOMBRES[f]; }
    // El tamaño, para saber qué se baja (una petición HEAD, sin descargar).
    fetch(a.href, { method: 'HEAD' }).then(r => {
      const n = +r.headers.get('content-length');
      if (r.ok && n) a.textContent += ` (${(n / 1048576).toFixed(1)} MB)`;
    }).catch(() => {});
    return a;
  };
  host.replaceChildren(...principales.map(f => enlace(f, true)));
  otros.replaceChildren(...Object.keys(NOMBRES).filter(f => !principales.includes(f)).map(f => { const d = document.createElement('div'); d.appendChild(enlace(f, false)); return d; }));
}

// pequeño estallido de fuegos artificiales (canvas, un par de segundos) para
// que se entienda de un vistazo que el bridge quedó conectado.
function fireworks() {
  const cv = document.createElement('canvas');
  cv.id = 'fireworks-fx';
  cv.width = innerWidth; cv.height = innerHeight;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const colors = ['#ff4d8d', '#7c5cff', '#49e8ff', '#3fb970', '#ffd479'];
  const bursts = Array.from({ length: 5 }, () => ({
    x: innerWidth * (0.2 + Math.random() * 0.6), y: innerHeight * (0.2 + Math.random() * 0.4),
    t0: performance.now() + Math.random() * 500,
    particles: Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * Math.PI * 2; const sp = 2 + Math.random() * 3; return { a, sp, color: colors[i % colors.length] }; }),
  }));
  const start = performance.now();
  function frame(now) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    let alive = false;
    for (const b of bursts) {
      const age = (now - b.t0) / 1000;
      if (age < 0) { alive = true; continue; }
      if (age > 1.4) continue;
      alive = true;
      for (const p of b.particles) {
        const r = p.sp * age * 40;
        const x = b.x + Math.cos(p.a) * r, y = b.y + Math.sin(p.a) * r + age * age * 60;
        ctx.globalAlpha = Math.max(0, 1 - age / 1.4);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (alive && now - start < 3000) requestAnimationFrame(frame);
    else cv.remove();
  }
  requestAnimationFrame(frame);
}

function renderSettings() {
  const box = settingsShell(t("setTitle"));

  // --- Cerebro (modelo) ---
  box.append(el('div', 'sk-h', t("setBrainTitle")));
  // De `modelOptionsLocales()`, no de una copia: así lo que se puede elegir aquí
  // es exactamente lo que se puede elegir en el desplegable, hoy y cuando se
  // añada el siguiente modelo. El texto de debajo sigue siendo a medida cuando
  // lo hay; si no, se saca de la propia etiqueta.
  const SUBS = {
    'litert:gemma-e4b': t("setModelE4bSub"),
    'litert:gemma-e2b': t("setModelE2bSub"),
    'onnx': t("setModelOnnxSub"),
    'rules': t("setModelRulesSub"),
  };
  const LOCAL = modelOptionsLocales().map((o) => {
    const partes = String(o.label).split(' · ');
    return {
      id: o.id,
      name: partes[0].trim(),
      sub: SUBS[o.id] || partes.slice(1).join(' · ').trim(),
    };
  });
  const grid = el('div', 'model-grid');
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', t('setBrainTitle'));
  // Cada tarjeta se pinta aquí y se REPINTA en su sitio (clases, aria-pressed,
  // aria-busy y texto): la misma tarjeta, el mismo foco. Antes elegir un modelo
  // rehacía el panel entero al empezar y otra vez al terminar la carga: lo que
  // estuvieras escribiendo en Ajustes (el feedback, el token del bridge) se
  // borraba y el foco caía a <body> (con Enter, al instante).
  const pintaTarjeta = (card, m) => {
    const cargando = loadingId === m.id;
    card.className = 'model-card' + (activeModel === m.id ? ' active' : '') + (m.disabled ? ' disabled' : '') + (cargando ? ' loading' : '');
    card.setAttribute('aria-pressed', activeModel === m.id ? 'true' : 'false');
    if (cargando) card.setAttribute('aria-busy', 'true'); else card.removeAttribute('aria-busy');
    card.innerHTML = `<b>${m.name}</b><span>${cargando ? escapeHtml(t('setModelLoadingCard')) : m.sub}</span>`;
  };
  const tarjetas = [];
  for (const m of LOCAL) {
    if (m.need === 'gpu' && !realGPU) continue;
    const card = el('button', 'model-card');
    card.dataset.model = m.id;
    if (m.disabled) card.disabled = true;
    pintaTarjeta(card, m);
    tarjetas.push([card, m]);
    // La tarjeta dice «cargando…» mientras carga, y la activa cambia cuando
    // termina (changeModel avisa: repintaTarjetasModelo).
    card.onclick = async () => {
      const p = changeModel(m.id);
      repintaTarjetasModelo();
      await p;
      repintaTarjetasModelo();
    };
    grid.appendChild(card);
  }
  repintaTarjetasModelo = () => { for (const [card, m] of tarjetas) if (card.isConnected) pintaTarjeta(card, m); };
  box.appendChild(grid);

  // --- Espacio de trabajo: guardar conversaciones/skills en disco ---
  box.append(el('div', 'sk-h', '💾 ' + t('wsTitle')));
  const wsCard = el('div', 'prov-card');
  const wsState = el('div', 'muted'); wsState.style.fontSize = '.78rem';
  // `flex-direction:row` EXPLÍCITO. La clase `field` es una columna
  // (`flex-direction: column`), y el estilo de aquí ponía `display:flex` y
  // `flex-wrap` sin corregir la dirección: los botones quedaban apilados y
  // estirados a todo el ancho —tres barras de color enormes para «elige una
  // carpeta»— cuando son acciones pequeñas que caben en una línea. El
  // `align-items:center` es para que la casilla de autoguardado no se estire.
  const wsRow = el('div', 'field');
  wsRow.style.cssText = 'display:flex;flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px';
  const wsInv = el('div'); wsInv.style.cssText = 'margin-top:10px;font-size:.78rem';
  wsCard.append(el('span', 'muted', t('wsDesc')), wsState, wsRow, wsInv);
  box.appendChild(wsCard);
  const wsKb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
  async function paintWs() {
    const st = workspace.status();
    wsRow.replaceChildren();
    wsState.textContent = !st.supported.pick ? t('wsNoSupport')
      : !st.folder ? t('wsNoFolder')
      : st.ready ? t('wsFolder', { name: st.folder }) : t('wsNeedsPerm', { name: st.folder });
    const mk = (label, fn) => { const b = el('button', 'prov-use', label); b.onclick = fn; wsRow.appendChild(b); };
    if (st.supported.pick) {
      if (!st.folder) {
        mk(t('wsPick'), async () => { try { await workspace.pick(); await paintWs(); } catch (e) { wsState.textContent = '⚠️ ' + e.message; } });
        // Code ya tiene una carpeta abierta: reutilizarla es un clic
        if (codeTools.handle()) mk(t('wsUseProject'), async () => { await workspace.adopt(codeTools.handle()); await paintWs(); });
      } else if (!st.ready) mk(t('wsRegrant'), async () => { try { await workspace.regrant(); await paintWs(); } catch (e) { wsState.textContent = '⚠️ ' + e.message; } });
      else {
        mk(t('wsSaveNow'), async () => { try { const r = await workspace.save(); wsState.textContent = r.ok ? t('wsSaved', { n: r.wrote.length }) : '⚠️ ' + (r.errors[0]?.error || ''); } catch (e) { wsState.textContent = '⚠️ ' + e.message; await paintWs(); } });
        const lbl = el('label', null); lbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:.78rem';
        const chk = el('input'); chk.type = 'checkbox'; chk.checked = workspace.autosaveEnabled();
        chk.onchange = () => workspace.autosave({ enabled: chk.checked });
        lbl.append(chk, el('span', 'muted', t('wsAuto'))); wsRow.appendChild(lbl);
        mk(t('wsForget'), async () => { await workspace.forget(); await paintWs(); });
      }
    }
    mk(t('wsDownload'), async () => {
      const blob = await workspace.bundle();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `elffuss-code-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
    wsInv.replaceChildren(el('b', null, t('wsWhat')));
    for (const it of await workspace.inventory()) {
      const line = el('div'); line.style.cssText = 'display:flex;justify-content:space-between;padding:3px 0';
      line.append(el('span', null, `${it.icon} ${it.label}`), el('span', 'muted', it.error ? '⚠️' : `${it.count} · ${wsKb(it.bytes)}`));
      wsInv.appendChild(line);
    }
  }
  paintWs().catch(() => {});

  // --- Almacenamiento del modelo (caché persistente) ---
  box.append(el('div', 'sk-h', t('setStoreTitle')));
  const storeCard = el('div', 'prov-card');
  const storeInfo = el('span', null, t('setCalc')); storeInfo.style.cssText = 'font-size:.8rem;color:var(--fg)';
  const storeSub = el('div', 'field'); storeSub.style.marginTop = '2px';
  const storeMuted = el('span', 'muted', ''); storeMuted.style.fontSize = '.72rem';
  const clearBtn = el('button', 'prov-use', t('setClear'));
  clearBtn.style.marginTop = '8px';
  const clearMsg = el('div', 'muted'); clearMsg.setAttribute('role', 'status'); clearMsg.style.cssText = 'font-size:.72rem;margin-top:6px';
  // La misma rutina que el chip 💾: confirma, vacía TODO lo que son modelos y
  // dice cuánto se liberó (antes solo borraba una caché vieja y no decía nada).
  clearBtn.onclick = async () => {
    const r = await vaciarModelos(clearBtn);
    if (r) clearMsg.textContent = r;
    await paintStorage();
  };
  const storeHead = el('div', 'prov-head'); storeHead.append(storeInfo);
  storeCard.append(storeHead, storeMuted, clearBtn, clearMsg);
  box.appendChild(storeCard);
  async function paintStorage() {
    const { quota, persisted } = await cacheEstimate();
    const m = await modelUsage();
    storeInfo.textContent = m.total ? t('setCached', { gb: tamano(m.total) }) : t('setNone');
    storeMuted.textContent = (persisted ? t('setPersist') : t('setNoPersist'))
      + (quota ? t('setLimit', { gb: tamano(quota) }) : '')
      + (m.sharedOk ? '' : t('setSharedUnknown'));
  }
  paintStorage();

  // --- Bridge local (ejecución REAL en tu máquina: node, npm, python…) ---
  box.append(el('div', 'sk-h', t("setBridgeTitle")));
  const brCard = el('div', 'prov-card bridge-card');
  const OTHER = { 'elffuss-bridge-mac-arm64': 'Mac (Apple Silicon)', 'elffuss-bridge-mac-intel': 'Mac (Intel)', 'elffuss-bridge-windows.exe': 'Windows', 'elffuss-bridge-linux': 'Linux (x64)', 'elffuss-bridge-linux-arm64': 'Linux (ARM)' };
  // Etiquetas ASOCIADAS a sus campos (for/id) y mensajes en una región viva.
  brCard.innerHTML =
    `<div class="prov-head"><span id="br-dot" class="dot off" aria-hidden="true"></span><b>${escapeHtml(t('setBridgeName'))}</b><span id="br-status" class="muted" role="status" style="margin-left:auto;font-size:.72rem">${escapeHtml(t('setBridgeDisconnected'))}</span></div>` +
    `<p class="muted" style="font-size:.72rem;margin:6px 0">${t('setBridgeDesc')}</p>` +
    `<p class="muted" style="font-size:.7rem;margin:0 0 6px">${t('setBridgeOld')}</p>` +
    `<div id="br-dl"></div>` +
    `<details style="margin-top:6px"><summary class="muted" style="font-size:.7rem;cursor:pointer">${t('setBridgeOtherOS')}</summary><div id="br-dl-other"></div></details>` +
    `<p class="muted" style="font-size:.7rem;margin:6px 0 0"><a href="https://github.com/KikoCis/elffuss-code/tree/main/bridge" target="_blank" rel="noopener noreferrer" style="color:var(--accent2)">${escapeHtml(t('setBridgeSource'))} ↗</a></p>` +
    `<div class="field" style="margin-top:8px"><label for="br-token" class="muted" style="font-size:.68rem">${t('setBrToken')}</label><input id="br-token" type="password" autocomplete="off" placeholder="${t('brTokenPh')}"></div>` +
    `<div class="field" style="margin-top:6px"><label for="br-folder" class="muted" style="font-size:.68rem">${t('setBridgeFolderLabel')}</label><input id="br-folder" placeholder="${t('setBridgeFolderPh')}"></div>` +
    `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button id="br-connect" class="prov-use">${t('setBridgeConnect')}</button>` +
    `<button id="br-disconnect" class="prov-use" hidden>${escapeHtml(t('setBridgeDisconnect'))}</button>` +
    `<button id="br-forget" class="prov-use" hidden>${escapeHtml(t('setBridgeForget'))}</button></div>`;
  box.appendChild(brCard);
  pintaDescargasBridge(brCard, OTHER);
  brCard.querySelector('#br-folder').value = bridge.getFolder();
  brCard.querySelector('#br-token').value = localStorage.getItem('elffusscode.bridgeToken') || '';
  const paintBridge = () => {
    const on = bridge.isConnected();
    brCard.querySelector('#br-dot').className = 'dot ' + (on ? 'on' : 'off');
    brCard.querySelector('#br-status').textContent = on ? t("setBridgeOnStatus") : t("setBridgeDisconnected");
    if (on) brCard.querySelector('#br-token').value = localStorage.getItem('elffusscode.bridgeToken') || '';
    brCard.querySelector('#br-disconnect').hidden = !on;
    brCard.querySelector('#br-forget').hidden = !bridge.hasSavedToken();
  };
  paintBridge();
  // repinta si el bridge conecta/cae mientras Ajustes está abierto; al cerrarse
  // el panel se deja de escuchar
  const dejar = bridge.onStatusChange(() => { if (!document.body.contains(brCard)) return dejar(); paintBridge(); });
  brCard.querySelector('#br-connect').onclick = async () => {
    const btn = brCard.querySelector('#br-connect');
    bridge.setFolder(brCard.querySelector('#br-folder').value);
    const token = brCard.querySelector('#br-token').value.trim();
    if (!token) return showBridgeMsg(brCard, t("setBridgeNoToken"), true);
    btn.disabled = true; btn.textContent = t("setBridgeConnecting");
    try { await bridge.connect(token); paintBridge(); showBridgeMsg(brCard, t("setBridgeConnectedMsg")); fireworks(); }
    catch (e) { showBridgeMsg(brCard, '⚠️ ' + e.message, true); }
    finally { btn.disabled = false; btn.textContent = t("setBridgeConnect"); }
  };
  // Antes no había forma de desconectar (la función existía y nadie la usaba)
  // ni de que el navegador olvidara el token guardado.
  brCard.querySelector('#br-disconnect').onclick = () => { bridge.disconnect(); paintBridge(); showBridgeMsg(brCard, t('setBridgeDisconnectedMsg')); };
  brCard.querySelector('#br-forget').onclick = () => {
    bridge.forgetToken();
    brCard.querySelector('#br-token').value = '';
    paintBridge();
    showBridgeMsg(brCard, t('setBridgeForgotMsg'));
  };

  // --- Permisos de ejecución (mismo interruptor que </> Auto de la barra) ---
  box.append(el('div', 'sk-h', t("setPermTitle")));
  const permCard = el('div', 'prov-card');
  permCard.innerHTML =
    // Lo que de verdad controla: escribir/editar ficheros. Decía «y comandos de
    // terminal», y la nota de debajo contaba que terminal.run no pregunta nunca.
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">` +
    `<input type="checkbox" id="perm-autoedit"> ` +
    `<span>${escapeHtml(t('setPermLabel'))}</span>` +
    `</label>` +
    `<p class="muted" style="font-size:.7rem;margin:6px 0 0">${escapeHtml(t('setPermNote'))}</p>`;
  box.appendChild(permCard);
  const permCheckbox = permCard.querySelector('#perm-autoedit');
  permCheckbox.checked = autoEdit;
  permCheckbox.onchange = () => {
    autoEdit = permCheckbox.checked;
    guardaPref('elffusscode.autoedit', autoEdit ? '1' : '0');
    paintAuto();
  };

  // --- 🎯 Modo Objetivo (planificador + ejecutor, mismo patrón que Auto) ---
  box.append(el('div', 'sk-h', t("setGoalTitle")));
  const goalCard = el('div', 'prov-card');
  goalCard.innerHTML =
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">` +
    `<input type="checkbox" id="perm-goalmode"> ` +
    `<span>${escapeHtml(t('setGoalLabel'))}</span>` +
    `</label>` +
    `<p class="muted" style="font-size:.7rem;margin:6px 0 0">${escapeHtml(t('setGoalNote'))}</p>`;
  box.appendChild(goalCard);
  const goalCheckbox = goalCard.querySelector('#perm-goalmode');
  goalCheckbox.checked = goalMode;
  goalCheckbox.onchange = () => {
    goalMode = goalCheckbox.checked;
    guardaPref('elffusscode.goalmode', goalMode ? '1' : '0');
    paintGoal();
  };

  // --- 📨 Errores y feedback (opt-in — apagado no sale NADA de tu máquina) ---
  box.append(el('div', 'sk-h', t("setTelTitle")));
  const telCard = el('div', 'prov-card');
  telCard.innerHTML =
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">` +
    `<input type="checkbox" id="tel-enabled"> ` +
    `<span>${escapeHtml(t('setTelAuto'))}</span>` +
    `</label>` +
    `<p class="muted" style="font-size:.7rem;margin:6px 0 10px">${escapeHtml(t('setTelNote'))}</p>` +
    `<label for="tel-feedback" class="muted" style="font-size:.68rem">${escapeHtml(t('setTelManual'))}</label>` +
    `<textarea id="tel-feedback" rows="2" style="width:100%;margin-top:4px;resize:vertical;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:6px 8px;font:inherit" placeholder="${t('setFeedbackPh')}"></textarea>` +
    `<button id="tel-send" class="prov-use" style="margin-top:6px">${escapeHtml(t('setTelSend'))}</button>` +
    `<span id="tel-msg" class="muted" role="status" aria-live="polite" style="font-size:.7rem;margin-left:8px"></span>`;
  box.appendChild(telCard);
  const telCheckbox = telCard.querySelector('#tel-enabled');
  telCheckbox.checked = telemetry.isEnabled();
  telCheckbox.onchange = () => telemetry.setEnabled(telCheckbox.checked);
  // Solo dice «enviado» si el servidor lo aceptó. Antes lo decía siempre
  // (también con un 404 o sin red) y además borraba el texto: el usuario
  // creía haberlo mandado y lo había perdido.
  telCard.querySelector('#tel-send').onclick = async () => {
    const btn = telCard.querySelector('#tel-send');
    const ta = telCard.querySelector('#tel-feedback');
    const msg = telCard.querySelector('#tel-msg');
    const text = ta.value.trim();
    msg.style.color = '';
    if (!text) { msg.textContent = t("setTelEmpty"); return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    msg.textContent = t('setTelSending');
    const wasEnabled = telemetry.isEnabled();
    if (!wasEnabled) telemetry.setEnabled(true); // el envío manual es explícito, se permite aunque el automático esté apagado
    let enviado = false;
    try { enviado = await telemetry.sendFeedback(text); }
    finally {
      if (!wasEnabled) telemetry.setEnabled(false); // no activa el automático de fondo si no lo pidió
      btn.disabled = false; btn.removeAttribute('aria-busy');
    }
    if (!enviado) { msg.textContent = t('setTelFailed'); msg.style.color = '#ff6b8b'; return; }
    ta.value = '';
    msg.textContent = t("setTelThanks");
    setTimeout(() => { msg.textContent = ''; }, 4000);
  };

  // --- Proveedores externos (API keys) ---
  box.append(el('div', 'sk-h', t("setProvTitle")));
  for (const [id, c] of Object.entries(settings.configs())) {
    const card = el('div', 'prov-card' + (c.enabled ? ' on' : ''));
    const head = el('div', 'prov-head');
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = c.enabled;
    toggle.setAttribute('aria-label', t('provToggle', { name: c.label }));
    const title = el('b', null, c.label);
    const use = el('button', 'prov-use', t("setProvUse"));
    use.hidden = !c.enabled || activeModel === 'ext:' + id;
    use.onclick = () => { changeModel('ext:' + id); renderSettings(); };
    head.append(toggle, title, use);
    const fields = el('div', 'prov-fields' + (c.enabled ? '' : ' hide'));
    const model = document.createElement('input'); model.value = c.model || ''; model.placeholder = t('setModelPh');
    const key = document.createElement('input'); key.type = 'password'; key.value = c.apiKey || '';
    key.placeholder = c.kind === 'anthropic' ? 'sk-ant-…' : (id === 'ollama' || id === 'server' ? t('keyNeeded') : 'sk-…');
    fields.append(labeled(t('lblModel'), model), labeled(t('lblApiKey'), key));
    const save = () => {
      settings.update(id, { enabled: toggle.checked, model: model.value.trim(), apiKey: key.value });
      rebuildSelect();
    };
    toggle.onchange = () => { save(); renderSettings(); };
    model.onchange = key.onchange = save;
    card.append(head, fields);
    box.appendChild(card);
  }

  // --- Skills ---
  box.append(el('div', 'sk-h', 'Skills'));
  const skBtn = el('button', 'primary wide', '🧩 Gestionar skills de Claude Code');
  skBtn.textContent = t("setManageSkillsBtn");
  skBtn.onclick = openSkillsPanel;
  box.appendChild(skBtn);
}
function labeled(label, input) {
  const w = el('label', 'field'); w.append(el('span', 'muted', label), input); return w;
}

// ---------- arranque ----------
let galaxy = null;
async function enterIDE(handle) {
  const name = await codeTools.openProject(handle);
  shell.reset();                 // el terminal arranca en la raíz del proyecto
  galaxy?.stop();
  $('landing').hidden = true;
  $('ide').hidden = false;
  $('project-name').textContent = name;
  $('explorer-proj').textContent = name.toUpperCase();
  await initEditor();
  await refreshTree(handle);
  // el sistema de conversaciones primero: renderActiveLog() REEMPLAZA todo
  // #chat-log con el historial replay de la conversación activa — si el
  // saludo se añadiera antes, desaparecería sin dejar rastro.
  await conv.init({ onEvent: onConvEvent });
  renderTabsBar();
  renderActiveLog();
  addMsg('sys', t('welcome', { name }));
  abreDesdeHash();
  // Abierto desde una notificación con la app cerrada (sw.js → ?notif=…):
  // la propuesta está en la Mente, que se abre ya con el proyecto cargado.
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('notif')) {
      u.searchParams.delete('notif');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
      mind.openMind();
    }
  } catch { /* — */ }
  refreshGit();
  preloadModel(); // por si el arranque en la landing no llegó a dispararse
}

// Un fallo al abrir: en la landing si sigue a la vista, si no en la barra de
// estado del IDE (enterIDE ya la ha ocultado).
function avisaFalloApertura(e) {
  const msg = '⚠️ ' + t('openFolderFailed', { e: e?.message || e });
  if (!$('landing').hidden) { const st = $('clone-status'); st.textContent = msg; st.classList.add('err'); }
  else $('statusbar').textContent = msg;
}

async function boot() {
  applyI18n(); // localiza el chrome estático (placeholder) antes de pintar nada
  // Caché de modelos (persistente + service worker) ANTES de descargar nada,
  // para que hasta la primera descarga de pesos quede cacheada y no se repita.
  ensureModelCache().finally(() => preloadModel());
  bridge.tryAutoConnect(); // reconecta en silencio si ya se conectó antes (mismo token)
  bridge.startAutoDetect(); // sigue sondeando en 2º plano: detecta el bridge si se arranca/reinicia más tarde
  // galaxia en la landing (misma técnica que Elffuss)
  import('./splash-gl.js').then(m => { galaxy = m.startGalaxy($('landing')); }).catch(() => {});

  // clonar un repo público (GitHub/Bitbucket): elige carpeta destino, se
  // descarga ahí (fichero a fichero, sin git) y se abre como proyecto.
  // RESUMIBLE: el trabajo (lista de ficheros + cuáles ya se bajaron + el
  // handle de la carpeta) se persiste en IndexedDB — si el usuario navega
  // atrás, cierra la pestaña o recarga a medias, al volver se ofrece
  // «Reanudar» en vez de forzar a empezar de cero.
  const cloneUrl = $('clone-url'), cloneBtn = $('clone-btn'), cloneStatus = $('clone-status');
  // #clone-status es la línea de estado de la landing (role=status): ahí van
  // los fallos de abrir, reabrir y clonar. Antes «Reabrir» escribía en la
  // barra de estado del IDE, que aún está oculta, y nadie lo veía.
  const showCloneStatus = (text, isErr) => { cloneStatus.textContent = text; cloneStatus.classList.toggle('err', !!isErr); };

  // Abrir una carpeta: cancelar el selector (AbortError) no es un fallo y se
  // calla; cualquier otro error se dice. Antes un catch pelado se lo tragaba
  // todo, y en un navegador sin selector de carpetas el botón no hacía nada.
  $('open-project').onclick = async () => {
    const btn = $('open-project');
    showCloneStatus('');
    let handle;
    try { handle = await window.showDirectoryPicker({ mode: 'readwrite' }); }
    catch (e) { if (e?.name !== 'AbortError') showCloneStatus('⚠️ ' + t('openFolderFailed', { e: e?.message || e }), true); return; }
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    showCloneStatus(t('openingIde'));
    try { await enterIDE(handle); showCloneStatus(''); }
    catch (e) { avisaFalloApertura(e); }
    finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  };
  // Sin File System Access (Firefox, Safari) no hay forma de abrir una carpeta
  // ni de elegir dónde descargar un repo: se dice en la propia landing, se
  // desactivan esos botones y se ofrece trabajar en el almacenamiento privado
  // del navegador (OPFS), que sí existe ahí.
  if (typeof window.showDirectoryPicker !== 'function') {
    for (const b of [$('open-project'), cloneBtn, cloneUrl]) b.disabled = true;
    showCloneStatus(t('noFsAccess'), true);
    if (navigator.storage?.getDirectory) {
      const probar = $('try-browser');
      probar.hidden = false;
      // Una carpeta PROPIA dentro del almacenamiento del navegador, no su raíz: en
      // la raíz viven también los pesos de los modelos (elffuss-models), y abierta
      // como proyecto el explorador, la paleta, la búsqueda y las herramientas del
      // agente los enseñaban y podían editarlos o borrarlos.
      probar.onclick = async () => {
        try { await enterIDE(await (await navigator.storage.getDirectory()).getDirectoryHandle('elffuss-code', { create: true })); }
        catch (e) { avisaFalloApertura(e); }
      };
    }
  }
  const saveCloneJob = job => db.set('kv', 'cloneJob', job).catch(() => {});
  const loadCloneJob = () => db.get('kv', 'cloneJob').catch(() => null);
  const clearCloneJob = () => db.del('kv', 'cloneJob').catch(() => {});

  async function runDownload(job) {
    cloneBtn.disabled = true;
    const doneSet = new Set(job.done);
    const clone = await import('./tools/clone.js');
    try {
      await clone.downloadFiles(job, job.handle, doneSet,
        p => showCloneStatus(p.text || ''),
        async path => {
          job.done.push(path);
          // persistir el progreso poco a poco (no en cada fichero: de sobra
          // para no perder más de un puñado si se interrumpe a media descarga)
          if (job.done.length % 5 === 0) await saveCloneJob(job);
        });
      await saveCloneJob(job);
      showCloneStatus(`✔ ${job.files.length} ficheros descargados` + (job.skipped ? ` (${job.skipped} omitidos por tamaño)` : ''));
      await clearCloneJob();
      await enterIDE(job.handle);
    } catch (e) {
      await saveCloneJob(job); // que lo ya bajado no se pierda aunque falle a mitad
      showCloneStatus('⚠️ ' + (e?.message || e) + ' — puedes reintentar, retoma donde se quedó', true);
    } finally { cloneBtn.disabled = false; }
  }

  const runClone = async () => {
    const url = cloneUrl.value.trim();
    // La URL se valida ANTES de abrir el selector de carpeta: antes se elegía
    // la carpeta y solo después decía que la URL no valía. Vacía, lo dice.
    if (!url) { showCloneStatus(t('clonePasteUrl'), true); cloneUrl.focus(); return; }
    const clone = await import('./tools/clone.js');
    try { clone.parseRepoUrl(url); }
    catch { showCloneStatus('⚠️ ' + t('cloneBadUrl'), true); cloneUrl.focus(); return; }
    showCloneStatus('');
    let handle;
    try { handle = await window.showDirectoryPicker({ mode: 'readwrite' }); }
    catch (e) { if (e?.name !== 'AbortError') showCloneStatus('⚠️ ' + (e?.message || e), true); return; }
    showCloneStatus(t('cloneListing'));
    try {
      const info = await clone.listRepo(url);
      const job = { url, handle, done: [], ...info };
      await saveCloneJob(job);
      await runDownload(job);
    } catch (e) {
      showCloneStatus('⚠️ ' + (e?.message || e), true);
    }
  };
  cloneBtn.addEventListener('click', runClone);
  cloneUrl.addEventListener('keydown', e => { if (e.key === 'Enter') runClone(); });

  // ¿había una descarga a medias de una sesión anterior? ofrece reanudarla
  const job = await loadCloneJob();
  if (job && job.handle && job.files && job.done.length < job.files.length) {
    const banner = $('resume-clone');
    banner.hidden = false;
    // owner/repo enlaza al repositorio público que se estaba bajando.
    const rc = banner.querySelector('.rc-text');
    const a = document.createElement('a');
    a.href = (job.host === 'bitbucket' ? 'https://bitbucket.org/' : 'https://github.com/') + encodeURIComponent(job.owner) + '/' + encodeURIComponent(job.repo);
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = `${job.owner}/${job.repo}`;
    const [antes, despues] = t('cloneHalf', { repo: '\u0000', n: job.done.length, total: job.files.length }).split('\u0000');
    rc.replaceChildren(antes, a, despues);
    $('resume-clone-btn').onclick = async () => {
      banner.hidden = true;
      try {
        const q = job.handle.queryPermission ? await job.handle.queryPermission({ mode: 'readwrite' }) : 'granted';
        if (q !== 'granted' && await job.handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('permiso denegado para la carpeta');
        showCloneStatus(`Reanudando ${job.owner}/${job.repo}…`);
        await runDownload(job);
      } catch (e) { showCloneStatus('⚠️ ' + (e?.message || e), true); }
    };
    $('discard-clone-btn').onclick = async () => { await clearCloneJob(); banner.hidden = true; };
  } else if (job) {
    await clearCloneJob(); // job corrupto o ya completo: limpiar
  }

  // gancho de test: ?test-opfs usa el almacenamiento del navegador como proyecto
  if (location.search.includes('test-opfs')) {
    const opfs = await navigator.storage.getDirectory();
    return enterIDE(opfs);
  }

  // reabrir el último proyecto (un clic si el navegador exige gesto)
  const prev = await codeTools.restoreProject();
  if (prev?.ready) return enterIDE(await db.get('kv', 'project'));
  if (prev?.handle) {
    const btn = $('reopen-project');
    btn.hidden = false;
    btn.textContent = t('reopenFolder', { name: prev.name });
    btn.onclick = async () => {
      try { await codeTools.regrant(prev.handle); await enterIDE(prev.handle); }
      catch (e) { avisaFalloApertura(e); }
    };
  }
}

// Historial del prompt del chat: ↑/↓ recuperan lo enviado (como una shell).
// Persistente entre recargas (localStorage, últimos 100).
const PROMPT_HIST_KEY = 'elffusscode.promptHistory';
let promptHistory = [];
try { promptHistory = JSON.parse(localStorage.getItem(PROMPT_HIST_KEY) || '[]'); } catch { /* corrupto */ }
let promptHistIdx = -1, promptDraft = '';
function pushPromptHistory(text) {
  if (promptHistory[promptHistory.length - 1] !== text) promptHistory.push(text);
  if (promptHistory.length > 100) promptHistory = promptHistory.slice(-100);
  try { localStorage.setItem(PROMPT_HIST_KEY, JSON.stringify(promptHistory)); } catch { /* lleno */ }
  promptHistIdx = -1; promptDraft = '';
}
$('prompt').addEventListener('keydown', e => {
  if (!$('menu').hidden) return;                 // el menú «/» ya usa ↑/↓
  const inp = e.target;
  // En un borrador de varias líneas, ↑/↓ mueven el cursor como siempre: el
  // historial solo salta desde la primera línea (↑) o la última (↓). Antes ↑
  // en un texto largo lo sustituía entero por el mensaje anterior.
  const antes = inp.value.slice(0, inp.selectionStart), despues = inp.value.slice(inp.selectionEnd);
  if (e.key === 'ArrowUp' && antes.includes('\n')) return;
  if (e.key === 'ArrowDown' && despues.includes('\n')) return;
  if (e.key === 'ArrowUp') {
    if (!promptHistory.length) return;
    if (promptHistIdx === -1) { promptDraft = inp.value; promptHistIdx = promptHistory.length; }
    promptHistIdx = Math.max(0, promptHistIdx - 1);
    inp.value = promptHistory[promptHistIdx];
    e.preventDefault();
    requestAnimationFrame(() => inp.setSelectionRange(inp.value.length, inp.value.length));
  } else if (e.key === 'ArrowDown') {
    if (promptHistIdx === -1) return;
    promptHistIdx++;
    inp.value = promptHistIdx >= promptHistory.length ? (promptHistIdx = -1, promptDraft) : promptHistory[promptHistIdx];
    e.preventDefault();
  } else if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
    // envío explícito: no depender del submit-on-Enter nativo del <form>,
    // que algún navegador puede "tragarse" el primer Enter (autocompletar/
    // sugerencias) justo después de rellenar el valor por código (↑ del
    // historial) en vez de por tecleo real.
    e.preventDefault();
    $('composer').requestSubmit();
  }
});
$('composer').addEventListener('submit', e => {
  e.preventDefault();
  // Mientras el agente trabaja, el BOTÓN para en vez de enviar. Enter no: con
  // texto lo ENCOLA (cada conversación acepta y encola mensajes) y sale en
  // cuanto termine lo de ahora. Antes Enter también paraba, y el texto se
  // quedaba sin enviar en la caja. `submitter` es el botón solo en un clic (o
  // Enter/Espacio con el foco en él); con Enter en el cuadro de texto
  // (requestSubmit sin argumento) es null. Si ya se está parando, pulsar el
  // propio botón, que dice «Parando…» y está aria-disabled, no hace nada.
  const active = conv.getActive();
  const desdeBoton = e.submitter?.id === 'btn-send';
  if (desdeBoton && active?.parando) return;
  if (desdeBoton && active && active.pumping && !active.parando) { conv.stopActive(); return; }
  const text = $('prompt').value.trim();
  if (!text) return;
  $('prompt').value = '';
  pushPromptHistory(text);
  send(text);
});
// Reflejar en el botón si estamos generando (▶ enviar / ■ parar). Se llama desde
// el onChange de conversaciones cuando cambia «pumping».
const STOP_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor"/></svg>';
function paintSendButton() {
  const b = document.getElementById('btn-send');
  if (!b) return;
  const active = conv.getActive();
  const busy = !!active?.pumping;
  // «Parando…»: ya se pulsó ■ y el turno aún se está soltando (un modelo lento
  // tarda en dejar la generación). Antes el ■ seguía igual tras el clic y
  // parecía que no había hecho caso. Se marca con aria-disabled y NO con
  // disabled: deshabilitar el botón que tiene el foco lo saca del foco, el
  // teclado caía a <body> y ya no volvía.
  const parando = busy && !!active?.parando;
  b.classList.toggle('sending', busy);
  b.classList.toggle('is-stop', busy && !parando);
  b.classList.toggle('is-stopping', parando);
  if (parando) { b.setAttribute('aria-disabled', 'true'); b.setAttribute('aria-busy', 'true'); }
  else { b.removeAttribute('aria-disabled'); b.removeAttribute('aria-busy'); }
  b.innerHTML = parando ? escapeHtml(t('stopping')) : busy ? STOP_ICON : UI.send;
  b.title = parando ? t('stopping') : busy ? t('stop') : t('send');
  b.setAttribute('aria-label', b.title);
}
// La parada se anuncia en una región viva: el botón solo lo dice en su
// etiqueta, y parando con Enter el foco está en el cuadro de texto, así que el
// cambio no se oía; el «(Parado.)» del chat tampoco, porque el chat no es una
// región viva. Se vacía y se escribe en otro tick para que el mismo texto dos
// veces seguidas se vuelva a leer, y un anuncio que llega antes de escribirse
// el anterior lo sustituye.
let anuncioPendiente = null;
function anunciarEnvio(texto) {
  const r = document.getElementById('send-status');
  if (!r) return;
  clearTimeout(anuncioPendiente);
  r.textContent = '';
  anuncioPendiente = setTimeout(() => { r.textContent = texto; }, 50);
}
$('model-select').addEventListener('change', e => changeModel(e.target.value));
// El foco va a la tarjeta del modelo ACTIVO (un selector con coma devolvía la
// primera tarjeta en el orden del documento, no la activa).
$('model-dot').addEventListener('click', () => {
  renderSettings();
  requestAnimationFrame(() => { const panel = $('settings-panel'); (panel.querySelector('.model-card.active') || panel.querySelector('.model-card'))?.focus(); });
});
pintaDot('off', 'rules');
// móvil: conmutar chat ↔ editor
// ☰ (solo en el móvil): cajón con el árbol de ficheros y la barra de
// actividad. Abrir un fichero desde ahí pasa a la vista Editor y cierra el
// cajón; Escape o tocar fuera lo cierran.
function abreCajon(abrir) {
  const on = abrir ?? !document.body.classList.contains('drawer-open');
  if (on) {
    document.documentElement.style.setProperty('--drawer-top', Math.round(document.querySelector('#ide header').getBoundingClientRect().bottom) + 'px');
    if (!$('drawer-scrim')) {
      const scrim = document.createElement('div');
      scrim.id = 'drawer-scrim';
      scrim.onclick = () => abreCajon(false);
      document.body.appendChild(scrim);
    }
  }
  document.body.classList.toggle('drawer-open', on);
  // el árbol empieza justo debajo de la fila de herramientas, mida lo que mida
  if (on) document.documentElement.style.setProperty('--drawer-act', Math.round($('activity').getBoundingClientRect().height) + 'px');
  $('btn-drawer').setAttribute('aria-expanded', on ? 'true' : 'false');
  if (on) ($('tree').querySelector('[tabindex="0"]') || $('act-files'))?.focus();
  else if (document.activeElement && ($('sidebar').contains(document.activeElement) || $('activity').contains(document.activeElement))) $('btn-drawer').focus();
}
$('btn-drawer').title = t('drawerTitle');
$('btn-drawer').setAttribute('aria-label', t('drawerTitle'));
$('btn-drawer').addEventListener('click', () => abreCajon());
// Elegir algo del cajón lo cierra; un fichero del árbol además enseña el editor.
$('tree').addEventListener('click', e => {
  if (!document.body.classList.contains('drawer-open')) return;
  if (!e.target.closest('.file')) return;
  document.body.classList.add('show-editor');
  paintFlip(true);
  abreCajon(false);
});
$('activity').addEventListener('click', e => {
  if (!document.body.classList.contains('drawer-open') || !e.target.closest('button')) return;
  if (e.target.closest('#act-files')) return;            // en el cajón, el árbol ya se ve
  abreCajon(false);
  if (e.target.closest('#act-arch, #act-city, #act-term')) { document.body.classList.add('show-editor'); paintFlip(true); }
}, true);

$('code-flip').addEventListener('click', () => {
  const showEditor = !document.body.classList.contains('show-editor');
  document.body.classList.toggle('show-editor', showEditor);
  paintFlip(showEditor);
});

// vistas Arquitectura (grafo) y Ciudad 3D — leen el proyecto abierto y al
// hacer clic abren el fichero en Monaco (inspirado en CodeFlow + VibeCodeViewer)
$('act-arch').innerHTML = UI.graph || UI.code;
$('act-city').innerHTML = UI.city || UI.code;
let viewRenderSeq = 0;
async function openView(kind) {
  const overlay = $('view-overlay'), body = $('view-body');
  const seq = ++viewRenderSeq;
  // destruir CUALQUIER vista previa (su RAF/canvas seguía vivo al cambiar → la
  // nueva no cargaba bien). Ambas, no solo la del mismo tipo.
  try { (await import('./city.js')).disposeCity(); } catch { /* */ }
  try { (await import('./arch.js')).disposeArch(); } catch { /* */ }
  body.innerHTML = '<div class="view-loading" role="status"></div>';
  body.firstChild.textContent = t('viewBuilding');
  overlay.hidden = false;
  document.querySelectorAll('#activity button').forEach(b => b.classList.toggle('on', b.id === 'act-' + kind));
  // esperar a que el layout dé tamaño real al overlay (si no, canvas 0×0/mal aspect)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (seq !== viewRenderSeq) return; // el usuario cambió de vista mientras tanto
  try {
    if (kind === 'arch') { const m = await import('./arch.js'); await m.renderArchitecture(body, p => { closeView(); openFile(p); }); }
    else { const m = await import('./city.js'); await m.renderCity(body, p => { closeView(); openFile(p); }); }
  } catch (e) { body.innerHTML = '<div class="view-loading" role="status"></div>'; body.firstChild.textContent = t('viewFailed', { e: e?.message || e }); }
}
function closeView({ foco = false } = {}) {
  const abierta = [...document.querySelectorAll('#act-arch.on, #act-city.on')][0];
  $('view-overlay').hidden = true;
  import('./city.js').then(m => m.disposeCity()).catch(() => {});
  import('./arch.js').then(m => m.disposeArch()).catch(() => {});
  document.querySelectorAll('#activity button').forEach(b => b.classList.toggle('on', b.id === 'act-files'));
  if (foco) abierta?.focus();
}
$('act-arch').addEventListener('click', () => openView('arch'));
$('act-city').addEventListener('click', () => openView('city'));
$('view-close').addEventListener('click', () => closeView({ foco: true }));

// ── Cerebro CEO autónomo + Mente de Elffuss ───────────────────────────────
// Cuando NO estás pidiendo nada, la elfa trabaja: revisa el proyecto y propone
// mejoras (en elffuss-mind/, sin tocar tu código). Clic en la elfa → abre la
// «Mente» (mundo trance + pensamientos paralelos + música) y activa el cerebro.
// «Abrir en el editor» de la Mente: abre el fichero y deja el foco en el editor
// (la Mente cierra sin devolverlo a la elfa).
mind.setOpenFile(async p => { await openFile(p); focusEditor(); });
mind.init({ buildCity: buildCityAdapter, loadThoughts: loadThoughtsAdapter });
// «Ejecutar esta propuesta»: la manda a la MISMA cola/agente del chat normal
// (mismas herramientas reales, mismo gate de Auto-edit) — no un auto-apply
// aparte sin supervisión.
mind.setExecuteProposal(md => { mind.closeMind(); send(t('pProposal') + md); });
// «perfiles»: cada uno es una línea de pensamiento paralela (foco + color de
// su estrella) del cerebro CEO (compartido, core/ceo.js). El usuario los
// edita/crea/borra desde ⚙ en la Mente.
const CEO_DEFAULT_PROFILES = [
  { id: 'arq', name: 'Arquitectura', focus: 'estructura, acoplamiento y dependencias; qué módulo conviene dividir o unificar', color: '#7c5cff' },
  { id: 'cal', name: 'Calidad', focus: 'bugs latentes, casos borde sin cubrir, validaciones que faltan', color: '#49e8ff' },
  { id: 'rend', name: 'Rendimiento', focus: 'cuellos de botella, trabajo repetido, estructuras de datos mejorables', color: '#ffb454' },
  { id: 'dx', name: 'Producto/DX', focus: 'legibilidad, nombres, documentación y ergonomía para quien lo usa', color: '#3fb970' },
];
// adaptador de workspace para el cerebro CEO genérico (core/ceo.js): traduce
// sus operaciones a las herramientas de code.js (proyecto de código único).
async function ceoDirHandle(dirPath) {
  let dir = codeTools.handle();
  for (const seg of dirPath.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(seg, { create: true });
  return dir;
}
const ceoWorkspace = {
  isReady: () => !!codeTools.handle(),
  tree: (opts) => codeTools.tree(opts),
  write: (opts) => codeTools.write(opts),
  read: (opts) => codeTools.read(opts),
  list: async (dirPath) => {
    const dir = await ceoDirHandle(dirPath);
    const names = [];
    for await (const e of dir.values()) if (e.kind === 'file') names.push(e.name);
    return names;
  },
  remove: async (dirPath, name) => (await ceoDirHandle(dirPath)).removeEntry(name),
};
ceo.init({
  namespace: 'elffusscode',
  workspace: ceoWorkspace,
  defaultProfiles: CEO_DEFAULT_PROFILES,
  defaultMission: 'Revisar el proyecto y proponer mejoras concretas y accionables (código, procesos, datos o docs).',
  // Sin modelo de verdad no hay cerebro: con el motor de reglas (modo Básico)
  // el CEO «pensaba» con el texto de ayuda, escribía .elffuss/soul/*.md dentro
  // del proyecto y anunciaba «4 mejoras» que no eran nada.
  provider: () => { const p = conv.getProvider(); return p && p !== rules ? p : null; },
  // el usuario tiene PRIORIDAD: si CUALQUIER conversación está en cola o procesándose, el cerebro espera
  isBusy: () => conv.isBusy(),
  onEvent: (ch, ev) => {
    mind.pushThought(ch, ev);
    if (ch === 'ceo' && ev.type === 'built') reportImprovements(ev);
    // la elfa se anima mientras el cerebro trabaja (invita a hacer clic para ver la Mente)
    const av = document.querySelector('#activity img');
    if (av) {
      if (ch === 'ceo' && ev.type === 'cycle') av.classList.add('working');
      if (ch === 'ceo' && (ev.type === 'built' || ev.type === 'paused')) av.classList.remove('working');
    }
  },
});
// Reporta las mejoras SIEMPRE en el chat (visual, entendible); la notificación
// del navegador solo salta si de verdad hay algo interesante y bien trabajado
// — nada de avisar por un ciclo flojo con una propuesta de una línea.
const WEAK_RE = /^(no (encontr|hay|se me ocurre)|nada que|sin cambios|todo (está|esta) bien|no aplica)/i;
export function isNoteworthy(ev) {
  const solid = (ev.proposals || []).filter(p => p.text && p.text.trim().length >= 60 && !WEAK_RE.test(p.text.trim()));
  return solid.length >= 2; // al menos 2 departamentos con algo sustancioso, no una ocurrencia suelta
}
// manda una propuesta (el .md completo del ciclo) a la MISMA cola/agente real
// del chat — usado tanto por el botón del chat como por el de la notificación.
function executeProposal(md) { send(t('pProposal') + md); }

// Botón REAL para ejecutar la propuesta desde el propio chat.
function botonPropuesta(div, md) {
  const btn = document.createElement('button');
  btn.className = 'proposal-exec-btn';
  btn.textContent = t('mindExec');
  btn.onclick = () => { btn.disabled = true; btn.textContent = t('proposalSent'); executeProposal(md); };
  div.appendChild(btn);
}

export function reportImprovements(ev) {
  const props = ev.proposals || [];
  if (!props.length) return;
  const firstLine = t => (t || '').split('\n').find(l => l.trim())?.trim().slice(0, 160) || '';
  const body = `💡 **Mientras estabas fuera revisé el proyecto y encontré ${props.length} mejora${props.length === 1 ? '' : 's'}:**\n\n` +
    props.map(p => `**${p.dept}** — ${firstLine(p.text)}`).join('\n\n') +
    (ev.path ? `\n\n_Guardado en \`${ev.path}\`. Dale a la elfa para verlo en la Mente, o ábrelo en el editor._` : '');
  const div = addMsg('assistant', body);
  // se guarda en el historial REAL de la conversación activa — si no, el
  // aviso vive solo en el DOM y desaparece al cambiar de pestaña o recargar.
  // Con la propuesta al lado: el botón «▶ Ejecutar» se vuelve a pintar al
  // repintar el chat (antes solo existía en el DOM del momento).
  const md = ev.md || body;
  const active = conv.getActive();
  if (active) conv.appendMessage(active.id, 'assistant', body, { propuesta: md });
  if (div) botonPropuesta(div, md);
  if (isNoteworthy(ev)) notify(`Elffuss encontró ${props.length} mejora${props.length === 1 ? '' : 's'}`, props.map(p => p.dept).join(' · '), md);
}
// SOLO notifica si el permiso YA está concedido. Nunca pide permiso aquí:
// fuera de un gesto de usuario, Chrome/Firefox lo bloquean en silencio —
// pedirlo vive únicamente en el clic de la elfa y en ⚙ de la Mente.
// Vía el service worker (registration.showNotification) para poder incluir
// un botón «▶ Ejecutar» de verdad en la propia notificación del sistema
// (new Notification() normal no soporta acciones); si el SW no está listo,
// cae a la notificación simple sin botón.
async function notify(title, body, md) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg.showNotification) {
        await reg.showNotification(title, {
          body, icon: 'img/elffuss-code.svg',
          actions: [{ action: 'execute', title: t('nExec') }, { action: 'open', title: t('nView') }],
          data: { md },
        });
        return;
      }
    }
  } catch { /* cae a la notificación simple */ }
  try { new Notification(title, { body, icon: 'img/elffuss-code.svg' }); } catch { /* */ }
}
// clic en el botón de la notificación del sistema → lo mismo que en el chat
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    if (e.data?.type !== 'notif-action') return;
    if (e.data.action === 'execute' && e.data.md) executeProposal(e.data.md);
    else mind.openMind();
  });
}
// cualquier interacción FUERA de la Mente cuenta como actividad → pausa el CEO
const noteAct = e => { if (!e.target.closest?.('#mind-overlay')) ceo.noteActivity(); };
document.addEventListener('pointerdown', noteAct, true);
document.addEventListener('keydown', noteAct, true);
// La elfa de la barra es un BOTÓN que abre la Mente, y nada más. Antes el
// primer clic encendía en silencio el cerebro autónomo (que empezaba a trabajar
// sobre tu proyecto) y pedía permiso de notificaciones sin explicar para qué.
// Ahora el cerebro se enciende DENTRO de la Mente, con un botón que dice lo que
// hace, y las notificaciones se piden solo desde ⚙ cerebro.
const elfAvatar = $('act-mind');
if (elfAvatar) {
  elfAvatar.title = t('avatarTitle');
  elfAvatar.setAttribute('aria-label', t('avatarLabel'));
  elfAvatar.addEventListener('click', () => mind.openMind());
}
// restaura tu última elección (play o stop) tal cual la dejaste
if (ceo.wasEnabledLastSession()) ceo.enable();

// terminal integrado: xterm.js + shell sobre los ficheros REALES del proyecto.
// La elfa comparte este shell (tool terminal.run) y su salida se refleja aquí.
$('act-term').innerHTML = UI.terminal;
shell.setHooks({ fsChange: () => refreshTree().catch(() => {}), openFile });
setTerminalEcho((cmd, out) => terminal.echoAgent(cmd, out));
async function toggleTerminal(force) {
  const show = force != null ? force : $('terminal-panel').hidden;
  $('terminal-panel').hidden = !show;
  $('act-term').classList.toggle('on', show);
  if (show) {
    pintaCapacidades();
    await terminal.mount($('terminal-host'));
    terminal.refit();
  }
}
// La etiqueta del terminal sigue al bridge: antes solo se pintaba al abrir el
// panel y se quedaba vieja si el bridge conectaba o caía con él abierto.
function pintaCapacidades() {
  const cap = shell.capabilities();
  $('term-caps').textContent = cap.bridge ? t("termCapsBridge") : t("termCapsNoBridge");
}
bridge.onStatusChange(() => { if (!$('terminal-panel').hidden) pintaCapacidades(); });
$('act-term').addEventListener('click', () => toggleTerminal());
$('term-close').addEventListener('click', () => toggleTerminal(false));
$('term-clear').addEventListener('click', () => terminal.clearScreen());
// Ctrl+` (o Cmd+`) alterna el terminal, como en VS Code
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === '`') { e.preventDefault(); toggleTerminal(); }
});
// redimensionar arrastrando la barra superior del panel
(() => {
  const panel = $('terminal-panel'), handle = $('term-resize');
  let sy = 0, sh = 0;
  // También con el teclado: es un separador con foco, ↑/↓ cambian la altura.
  const ajusta = h => {
    h = Math.max(120, Math.min(window.innerHeight - 160, h));
    panel.style.height = h + 'px';
    handle.setAttribute('aria-valuenow', String(Math.round(h)));
    terminal.refit();
  };
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'horizontal');
  handle.setAttribute('aria-label', t('termResizeLabel'));
  handle.setAttribute('aria-valuemin', '120');
  handle.tabIndex = 0;
  handle.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp') { e.preventDefault(); ajusta(panel.offsetHeight + 24); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); ajusta(panel.offsetHeight - 24); }
  });
  const move = e => ajusta(sh + (sy - e.clientY));
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
  handle.addEventListener('mousedown', e => { sy = e.clientY; sh = panel.offsetHeight; document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); e.preventDefault(); });
})();
window.addEventListener('resize', () => terminal.refit());

// iconos VS Code (sin emojis) en cabecera, composer y flip
$('btn-history').innerHTML = UI.history;
$('btn-settings').innerHTML = UI.gear;
$('btn-send').innerHTML = UI.send;
$('btn-plus').innerHTML = UI.add;
$('btn-slash').innerHTML = UI.slash;
const paintFlip = editor => { $('code-flip').innerHTML = (editor ? UI.chat : UI.editor) + `<span>${editor ? t('flipChat') : t('flipEditor')}</span>`; };
paintFlip(false);

// barra de actividad estilo VS Code
$('act-files').innerHTML = ACTIVITY.files;
$('act-search').innerHTML = ACTIVITY.search;
$('act-settings').innerHTML = ACTIVITY.gear;
$('act-files').addEventListener('click', () => {
  document.body.classList.toggle('hide-tree');
  $('act-files').classList.toggle('on');
});
// Lo que promete su título: buscar ficheros (la paleta, como Cmd/Ctrl+P). Antes
// escribía «busca » en el chat. Buscar DENTRO del código es «#» en la paleta.
$('act-search').addEventListener('click', (e) => { e.stopPropagation(); openPalette(''); });
$('act-settings').addEventListener('click', () => $('btn-settings').click());

$('btn-history').addEventListener('click', () => {
  const panel = $('history-panel');
  if (!panel.hidden) return cierraHistorial();
  panel.hidden = false;
  $('btn-history').setAttribute('aria-expanded', 'true');
  renderHistoryPanel().then(() => (panel.querySelector('.hp-open') || panel.querySelector('.hp-head button'))?.focus());
});
function cierraHistorial({ foco = true } = {}) {
  const panel = $('history-panel');
  if (panel.hidden) return;
  panel.hidden = true;
  $('btn-history').setAttribute('aria-expanded', 'false');
  if (foco) $('btn-history').focus();
}
document.addEventListener('pointerdown', e => {
  const p = $('history-panel');
  if (p.hidden) return;
  if (p.contains(e.target) || e.target.closest('#btn-history')) return;
  cierraHistorial({ foco: false });
}, true);
$('btn-settings').addEventListener('click', () => {
  const p = $('settings-panel');
  if (!p.hidden) return cierraAjustes();
  renderSettings();
});
// clic fuera del panel (o ir a Archivo/chat) lo cierra — antes solo la X lo hacía
document.addEventListener('pointerdown', e => {
  const p = $('settings-panel');
  if (p.hidden) return;
  if (p.contains(e.target) || e.target.closest('#btn-settings, #act-settings, #model-dot')) return;
  p.hidden = true;
  volverDeAjustes = null;
}, true);

// ── Escape cierra la capa de más arriba ─────────────────────────────────────
// Una por pulsación, y el foco vuelve a quien la abrió. Antes solo la paleta,
// la Mente y el menú @ hacían caso: menús de arriba, modos, historial,
// ajustes y la vista 3D se quedaban abiertos.
const CAPAS = [
  { abierta: () => !$('menu').hidden, cerrar: () => { $('menu').hidden = true; $('prompt').focus(); } },
  { abierta: () => !$('topmenu').hidden, cerrar: () => cierraMenuBarra({ foco: true }) },
  { abierta: () => !$('modos-menu')?.hidden, cerrar: () => cierraModos({ foco: true }) },
  { abierta: () => !$('history-panel').hidden, cerrar: () => cierraHistorial() },
  { abierta: () => !$('settings-panel').hidden, cerrar: () => cierraAjustes() },
  { abierta: () => !$('view-overlay').hidden, cerrar: () => closeView({ foco: true }) },
  { abierta: () => document.body.classList.contains('drawer-open'), cerrar: () => abreCajon(false) },
];
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
  if (mind.isOpen() || !$('palette').hidden) return;                 // tienen su propio Escape
  if (document.querySelector('dialog[open], #tree-menu, #tab-menu, #conv-menu')) return;
  if (e.target.closest?.('.monaco-editor, #terminal-host')) {
    // El editor y el terminal usan Escape para lo suyo; solo se cierra una capa
    // si no hay nada que cerrar dentro de ellos.
    if (!CAPAS.some(c => c.abierta())) return;
  }
  for (const c of CAPAS) if (c.abierta()) { e.preventDefault(); c.cerrar(); return; }
});

// ---------- composer estilo plugin: +, /, medidor de contexto, Auto ----------

// medidor de contexto: chars del historial / presupuesto (~4 chars/token)
//
// El presupuesto se le PREGUNTA al proveedor cargado, no se escribe aquí. Era un
// 28.000 fijo, calculado para el LFM2.5 de serie, y enseñaba «ctx 0 / 28k» con
// cualquier modelo: con el motor propio a 65.536 mentía por más del doble, y al
// revés con uno pequeño habría dicho que cabe lo que no cabe. Un número escrito
// a mano en la interfaz es un número que se queda viejo — el mismo fallo que la
// lista de modelos de los ajustes.
const CTX_BUDGET_FALLBACK = 28000;   // solo si el proveedor no sabe decirlo
let ctxBudgetTok = CTX_BUDGET_FALLBACK;
export function setCtxBudget(tokens) {
  // Se reserva sitio para el prompt de sistema y para la respuesta: el techo del
  // modelo NO es lo que cabe de conversación.
  const RESERVA = 4000;
  if (Number.isFinite(tokens) && tokens > RESERVA) ctxBudgetTok = tokens - RESERVA;
}
function updateCtxMeter() {
  if (!$('ctx-text')) return; // aún en la landing
  const CTX_BUDGET_TOK = ctxBudgetTok;
  const chars = (conv.getActive()?.agent.history || []).reduce((s, m) => s + (m.content || '').length, 0);
  const tok = Math.round(chars / 4);
  const pct = Math.min(100, Math.round(tok / CTX_BUDGET_TOK * 100));
  const k = n => n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : n;
  $('ctx-text').textContent = `ctx ${k(tok)} / ${k(CTX_BUDGET_TOK)}`;
  $('ctx-bar').style.width = pct + '%';
  $('ctx-bar').className = pct > 85 ? 'hot' : '';
  // Decía «usa 🧹 para empezar limpio», y no hay ningún 🧹: lo que empieza
  // limpio es «+» (nueva conversación) en la barra de pestañas del chat.
  $('ctx-meter').title = pct > 85
    ? t('ctxFull', { pct })
    : t('ctxUse', { tok, max: CTX_BUDGET_TOK, free: 100 - pct });
}
const _origAdd = addMsg; // refrescar el medidor cuando cambia la conversación
addMsg = (...a) => { const r = _origAdd(...a); updateCtxMeter(); return r; };

// menú flotante genérico sobre el composer
function openMenu(items) {
  const menu = $('menu');
  menu.replaceChildren();
  for (const it of items) {
    if (it.sep) { const s = document.createElement('div'); s.className = 'sep'; s.textContent = it.sep; menu.appendChild(s); continue; }
    const row = document.createElement('button');
    row.className = 'menu-item';
    row.innerHTML = `<b>${it.label}</b>${it.hint ? `<span>${it.hint}</span>` : ''}`;
    row.onclick = () => { menu.hidden = true; it.run(); };
    row.onmouseenter = () => { menuSel = menuFilas().indexOf(row); pintaMenuSel(); };
    menu.appendChild(row);
  }
  menu.hidden = false;
  menuSel = menuFilas().length ? 0 : -1;
  pintaMenuSel();
}

// Navegar el menú con el teclado. El keydown del composer se aparta cuando el
// menú está abierto «porque el menú ya usa ↑/↓», y era mentira: nadie escuchaba,
// así que con el menú abierto las flechas no movían nada y el Enter se quedaba
// sin enviar el mensaje y sin elegir fichero. Ahora es verdad.
let menuSel = -1;
const menuFilas = () => [...$('menu').querySelectorAll('.menu-item')];
function pintaMenuSel() {
  const filas = menuFilas();
  filas.forEach((f, i) => f.classList.toggle('sel', i === menuSel));
  if (menuSel >= 0) filas[menuSel]?.scrollIntoView({ block: 'nearest' });
}
function cierraMenu({ sueltaToken = true } = {}) {
  $('menu').hidden = true;
  menuSel = -1;
  if (sueltaToken) { arrobaDesde = -1; cacheFicheros = null; }
}
$('prompt').addEventListener('keydown', (e) => {
  if ($('menu').hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); return cierraMenu(); }
  const filas = menuFilas();
  if (!filas.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); menuSel = (menuSel + 1) % filas.length; pintaMenuSel(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); menuSel = (menuSel - 1 + filas.length) % filas.length; pintaMenuSel(); }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); filas[Math.max(0, menuSel)].click(); }
});
document.addEventListener('click', e => {
  if (!e.target.closest('#menu, #btn-slash, #btn-plus')) cierraMenu();
});

// [/] comandos
$('btn-slash').addEventListener('click', () => openMenu([
  { sep: t('cmdsSep') },
  { label: '/tree', hint: t('slTree'), run: () => send(t('pTree')) },
  { label: '/search', hint: t('slSearch'), run: () => { $('prompt').value = t('pSearch'); $('prompt').focus(); } },
  { label: '/skills', hint: t('slSkills'), run: () => openSkillsPanel() },
  { label: '/model', hint: t('slModel'), run: () => $('btn-settings').click() },
  // «/clear» abría una conversación NUEVA (no limpiaba la actual): se llama
  // por lo que hace.
  { label: '/new', hint: t('slClear'), run: () => conv.create() },
]));
// Abierto con el ratón desde + o /, el foco pasa al menú (antes se quedaba en
// el botón y las flechas no hacían nada); dentro, ↑/↓ recorren las opciones y
// Escape vuelve a la caja de texto.
function enfocaMenuAlAbrir() {
  let n = 0;
  const mira = () => {
    const primero = $('menu').hidden ? null : $('menu').querySelector('.menu-item');
    if (primero) return primero.focus();
    if (++n < 60) requestAnimationFrame(mira);
  };
  requestAnimationFrame(mira);
}
$('btn-slash').addEventListener('click', enfocaMenuAlAbrir);
$('btn-plus').addEventListener('click', enfocaMenuAlAbrir);
$('menu').addEventListener('keydown', e => {
  const l = [...$('menu').querySelectorAll('.menu-item')], i = l.indexOf(document.activeElement);
  if (i < 0) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); l[(i + 1) % l.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); l[(i - 1 + l.length) % l.length].focus(); }
  else if (e.key === 'Home') { e.preventDefault(); l[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); l.at(-1).focus(); }
});

// [+] adjuntar archivo del proyecto como @ruta
// El menú de ficheros, en una función: lo abren el botón `+` Y escribir `@` en
// la conversación, que es lo natural y lo que ya prometía el título del botón
// («Adjuntar archivo del proyecto (@)») sin que nada lo implementara.
//
// Y FILTRA mientras escribes. Antes el menú se pintaba una vez al teclear `@` y
// se quedaba congelado: las letras siguientes entraban en el textarea y la lista
// seguía mostrando los mismos veinte ficheros. Con un árbol de verdad eso es un
// menú inútil, porque lo que buscas casi nunca está entre los veinte primeros.
let arrobaDesde = -1;      // índice del `@` que se está escribiendo, o -1
let cacheFicheros = null;  // el árbol, leído una vez por sesión de menú

// Reconstruye las RUTAS COMPLETAS del árbol. `code.tree` indenta dos espacios
// por nivel y marca las carpetas con «📁 », así que la carpeta de un fichero
// está en su sangría, no en su línea.
//
// ⚠️ Esto hacía `l.trim()` sobre cada línea, que es exactamente tirar esa
// información: el menú ofrecía «obj_1_Zusammenbau.stl» cuando el fichero real
// es «dinos/obj_1_Zusammenbau.stl», y al insertarlo la herramienta fallaba con
// «no existe en este proyecto». Lo peor del fallo es que el menú te deja
// elegirlo: parece que la ruta está bien hasta que la lees.
export function rutasDelArbol(tree) {
  const rutas = [];
  const pila = [];
  for (const linea of String(tree || '').split('\n')) {
    if (!linea.trim()) continue;
    if (linea.startsWith('…')) continue;            // el aviso de árbol recortado
    const sangria = linea.length - linea.replace(/^ +/, '').length;
    const nivel = Math.floor(sangria / 2);
    const texto = linea.trim();
    if (texto.startsWith('📁')) {
      pila.length = nivel;                          // salir de las carpetas hermanas
      pila.push(texto.replace(/^📁\s*/, ''));
    } else {
      rutas.push([...pila.slice(0, nivel), texto].join('/'));
    }
  }
  return rutas;
}

async function listaProyecto() {
  if (cacheFicheros) return cacheFicheros;
  let tree = '';
  try { tree = await codeTools.tree({ depth: 3 }); } catch { /* sin proyecto */ }
  const files = rutasDelArbol(tree);
  const { currentFile } = codeTools.current();
  return (cacheFicheros = { files, currentFile });
}

async function abreMenuFicheros(frag = '') {
  const { files, currentFile } = await listaProyecto();
  const q = frag.toLowerCase();
  // El filtro va sobre la lista COMPLETA y el recorte a 20 va DESPUÉS. Al revés
  // —recortar y luego filtrar, como hacía antes— un fichero en el puesto 50 del
  // árbol no aparece nunca, por mucho que escribas su nombre entero.
  const casa = (f) => !q || f.toLowerCase().includes(q);
  const items = [{ sep: frag ? `${t('attachSep')} · @${frag}` : t('attachSep') }];
  if (currentFile && casa(currentFile)) items.push({ label: '@' + currentFile, hint: t('attachOpen'), run: () => attach(currentFile) });
  for (const f of files.filter(f => f !== currentFile && casa(f)).slice(0, 20))
    items.push({ label: '@' + f, run: () => attach(f) });

  if (items.length === 1) {
    // Sin coincidencias: el menú se aparta en vez de estorbar con una lista
    // vacía, y vuelve solo en cuanto borras una letra y el filtro encaja.
    if (frag) { cierraMenu({ sueltaToken: false }); return; }
    openMenu([{ sep: t('openProjFirst') }]);
    return;
  }
  openMenu(items);
}
$('btn-plus').addEventListener('click', () => { arrobaDesde = -1; cacheFicheros = null; abreMenuFicheros(); });

// ¿Está el cursor dentro de un `@token`? Se recorre hacia atrás hasta el primer
// espacio: así `correo@dominio` no dispara el menú a media palabra (el carácter
// previo al `@` no es espacio) y `@` al principio o tras un espacio sí. El
// fragmento no puede contener espacios, que es justo donde termina una ruta.
function tokenArroba(el) {
  const v = el.value, cur = el.selectionStart;
  for (let i = cur - 1; i >= 0; i--) {
    if (/\s/.test(v[i])) return null;
    if (v[i] === '@') {
      const previo = i > 0 ? v[i - 1] : '';
      return (previo === '' || /\s/.test(previo)) ? { desde: i, frag: v.slice(i + 1, cur) } : null;
    }
  }
  return null;
}

$('prompt').addEventListener('input', () => {
  const tk = tokenArroba($('prompt'));
  if (!tk) { if (arrobaDesde >= 0) cierraMenu(); return; }
  arrobaDesde = tk.desde;
  abreMenuFicheros(tk.frag);
});

function attach(path) {
  const p = $('prompt');
  if (arrobaDesde >= 0) {
    // Se SUSTITUYE el `@frag` a medio escribir. Añadirlo al final, como antes,
    // dejaba `@src/ma @src/main.js` en cuanto el menú empezó a filtrar.
    const cola = p.value.slice(p.selectionStart);
    const sep = cola.startsWith(' ') ? '' : ' ';
    p.value = p.value.slice(0, arrobaDesde) + '@' + path + sep + cola;
    const cur = arrobaDesde + 1 + path.length + sep.length;
    p.focus();
    p.setSelectionRange(cur, cur);
  } else {
    p.value = (p.value + ' @' + path).trim() + ' ';
    p.focus();
  }
  arrobaDesde = -1;
  cacheFicheros = null;
}

// </> Auto (Edit automatically): si off, pide confirmación antes de escribir
let autoEdit = localStorage.getItem('elffusscode.autoedit') !== '0';
// Los tres modos se declaran juntos y antes de pintar nada: pintaModos() los
// lee todos y se llama ya al pintar Auto.
let goalMode = localStorage.getItem('elffusscode.goalmode') === '1';
let hardMode = false;
function paintAuto() {
  const b = $('btn-autoedit');
  b.classList.toggle('on', autoEdit);
  b.querySelector('.ae-txt').textContent = autoEdit ? t('autoTxt') : t('reviewTxt');
  b.title = autoEdit ? t('autoOn') : t('autoOff');
  pintaModos();
}
$('btn-autoedit').addEventListener('click', () => {
  autoEdit = !autoEdit;
  guardaPref('elffusscode.autoedit', autoEdit ? '1' : '0');
  paintAuto();
});
paintAuto();
codeTools.setWriteApprover(async (path, content) => {
  if (autoEdit) return true;
  return confirm(`Elffuss quiere escribir en «${path}» (${content.split('\n').length} líneas).\n\n¿Aplicar el cambio?`);
});

function cierraModos({ foco = false } = {}) {
  const menu = $('modos-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $('btn-modos')?.setAttribute('aria-expanded', 'false');
  if (foco) $('btn-modos')?.focus();
}
// El botón «Modos» lleva los que están encendidos (y el texto del prompt dice
// qué va a pasar con lo que escribas).
function pintaModos() {
  const b = $('btn-modos');
  if (!b) return;
  const activos = [];
  if (!autoEdit) activos.push(['Revisar', t('modeReview')]);
  if (goalMode) activos.push(['🎯', t('modeGoal')]);
  if (hardMode) activos.push(['⛏', t('modeHard')]);
  b.textContent = '⚙︎ ' + t('modesBtn') + (activos.length ? ' · ' + activos.map(a => a[0] === 'Revisar' ? t('reviewTxt') : a[0]).join(' ') : '') + ' ▾';
  b.setAttribute('aria-label', t('modesBtn') + (activos.length ? ': ' + activos.map(a => a[1]).join(', ') : ': ' + t('modesNone')));
  b.classList.toggle('on', activos.length > 0);
  $('btn-autoedit')?.setAttribute('aria-checked', autoEdit ? 'true' : 'false');
  $('btn-goal')?.setAttribute('aria-checked', goalMode ? 'true' : 'false');
  $('btn-hardwork')?.setAttribute('aria-checked', hardMode ? 'true' : 'false');
  $('prompt').placeholder = hardMode ? t('hwPlaceholder') : goalMode ? t('goalPlaceholder') : t('ph');
}

// 🎯 Goal: el siguiente mensaje que mandes se trata como un OBJETIVO — se
// planifica en tareas y se ejecutan una a una (goal.js), en vez del turno de
// chat normal. Mismo patrón (interruptor persistente en localStorage) que
// </> Auto de arriba.
function paintGoal() {
  $('btn-goal').classList.toggle('on', goalMode);
  pintaModos();
}
$('btn-goal').addEventListener('click', () => {
  goalMode = !goalMode;
  guardaPref('elffusscode.goalmode', goalMode ? '1' : '0');
  paintGoal();
});
paintGoal();

// ── Hard Work (RLM): lee el proyecto ENTERO por partes ──
$('btn-hardwork').addEventListener('click', () => {
  hardMode = !hardMode;
  $('btn-hardwork').classList.toggle('on', hardMode);
  // Al apagarlo vuelve el texto de siempre, en el idioma de la interfaz: antes
  // quedaba un «Pídele código a Elffuss…» fijo y en español.
  pintaModos();
});

// Trabaja el proyecto abierto por partes: trocea, pregunta a cada parte y funde.
// Corre como un turno MÁS de la conversación (conversations.js → 'hard'): el ■
// lo para, la conversación se ve ocupada y la pregunta y la respuesta quedan en
// su historial, así que sobreviven a cambiar de pestaña y a recargar. Antes
// corría por fuera de la cola: el botón nunca pasaba a ■ y todo vivía solo en
// el DOM.
conv.setHardWorkRunner(async (c, question, onEvent, { signal }) => {
  const hist = c.agent.history;
  hist.push({ role: 'user', content: question, ts: Date.now() });
  const responde = texto => {
    hist.push({ role: 'assistant', content: texto, ts: Date.now() });
    onEvent({ type: 'text', text: texto });
  };
  const parado = () => onEvent({ type: 'aborted', text: '(Parado.)' });
  const provider = conv.getProvider();
  if (!provider || provider === rules) return responde(t('hwNeedBrain'));
  const root = codeTools.handle();
  if (!root) return responde(t('hwNeedProject'));
  // Cada sub-llamada recibe la parada (corta la generación en curso) y, si ya
  // se pulsó ■, la siguiente ni se lanza.
  const conParada = {
    chat: (h, sys, cb) => signal.aborted
      ? Promise.reject(new DOMException('Parado', 'AbortError'))
      : provider.chat(h, sys, cb, signal),
  };
  try {
    onEvent({ type: 'progress', text: t('hwReading') });
    const context = await gatherFolder(root, { maxBytes: 1.5e6 });
    if (signal.aborted) return parado();
    if (!context.trim()) return responde(t('hwNoFiles'));
    const res = await hardWork({
      question, context, provider: conParada,
      onProgress: p => {
        if (signal.aborted) return;
        if (p.phase === 'plan') onEvent({ type: 'progress', text: t('hwPhasePlan', { n: p.chunks, k: Math.round(p.chars / 1000), trim: p.truncated ? t('hwTrimmed') : '' }) });
        else if (p.phase === 'map') onEvent({ type: 'progress', text: t('hwPhaseMap', { i: p.i, n: p.n }) });
        else if (p.phase === 'reduce-group') onEvent({ type: 'progress', text: t('hwPhaseGroup', { g: p.g, n: p.n }) });
        else if (p.phase === 'reduce') onEvent({ type: 'progress', text: t('hwPhaseReduce') });
      },
    });
    if (signal.aborted) return parado();
    responde(res.answer + '\n\n_' + t('hwResult', { n: res.chunks, k: res.kept }) + (res.truncated ? t('hwResultTrunc') : '') + '_');
  } catch (e) {
    if (signal.aborted || e?.name === 'AbortError') return parado();
    const texto = t('hwFailed', { e: e?.message || String(e) });
    hist.push({ role: 'assistant', content: texto, ts: Date.now() });
    onEvent({ type: 'error', text: texto });
  }
});

// resolver @rutas del mensaje: se leen y se adjuntan como contexto
const _send = send;
send = async (text) => {
  if (hardMode) return _send(text, 'hard');
  const refs = [...text.matchAll(/@([\w./-]+\.\w+)/g)].map(m => m[1]);
  if (refs.length) {
    let ctx = '';
    for (const r of [...new Set(refs)].slice(0, 4)) {
      try { ctx += `\n\n--- ${r} ---\n${await codeTools.read({ path: r })}`; } catch { /* ignora */ }
    }
    if (ctx) text += '\n\n[archivos adjuntos]' + ctx;
  }
  _send(text);
};

// ---------- panel de skills (transparente: repo + lista + SKILL.md) ----------
// Mismo diálogo que Ajustes. Los fallos se dicen DENTRO del panel, en palabras
// de persona y con «Reintentar» (antes: «⚠️ FAILED TO FETCH» en mayúsculas, y
// un alert() del navegador al añadir un repo que no valía o al instalar).
async function openSkillsPanel() {
  const box = settingsShell(t('skTitle'));
  const wrap = document.createElement('div');
  wrap.className = 'skills-panel';
  const intro = document.createElement('p');
  intro.className = 'muted';
  intro.textContent = t('skIntro');
  wrap.appendChild(intro);
  box.appendChild(wrap);

  // instaladas
  const inst = skills.installed();
  const instBox = document.createElement('div');
  instBox.append(el('div', 'sk-h', t('skInstalled', { n: inst.length })));
  for (const s of inst) {
    const row = document.createElement('div');
    row.className = 'sk-row';
    row.append(el('b', null, s.name), el('span', 'muted', s.repo || 'local'));
    const rm = document.createElement('button');
    rm.className = 'ghost'; rm.textContent = t("skRemove");
    rm.setAttribute('aria-label', t('skRemoveNamed', { name: s.name }));
    rm.onclick = async () => { await skills.remove(s.name); openSkillsPanel(); };
    row.appendChild(rm);
    instBox.appendChild(row);
  }
  if (!inst.length) instBox.append(el('p', 'muted', t('skNone')));
  box.appendChild(instBox);

  // fuentes + añadir repo
  const srcs = await skills.sources();
  const srcBox = document.createElement('div');
  srcBox.append(el('div', 'sk-h', t('skCatalogs')));
  for (const s of srcs) {
    const row = document.createElement('div');
    row.className = 'sk-row';
    const a = document.createElement('a');
    a.href = `https://github.com/${s.repo}`; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = s.repo + ' ↗';
    row.append(el('b', null, s.label), a);
    const browse = document.createElement('button');
    browse.className = 'primary'; browse.textContent = t("skBrowse");
    browse.onclick = () => browseRepo(s.repo, box);
    row.appendChild(browse);
    if (!s.official) {
      const rm = document.createElement('button');
      rm.className = 'ghost'; rm.textContent = '🗑';
      rm.setAttribute('aria-label', t('skRemoveRepo', { repo: s.repo }));
      rm.onclick = async () => { await skills.removeSource(s.repo); openSkillsPanel(); };
      row.appendChild(rm);
    }
    srcBox.appendChild(row);
  }
  const addRow = document.createElement('div');
  addRow.className = 'sk-row';
  const inp = document.createElement('input');
  inp.placeholder = t("skAddRepoPh");
  inp.setAttribute('aria-label', t('skAddRepo'));
  const add = document.createElement('button');
  add.className = 'primary'; add.textContent = t("skAddRepo");
  const addMsg2 = el('div', 'muted sk-msg'); addMsg2.setAttribute('role', 'status');
  add.onclick = async () => {
    addMsg2.textContent = '';
    try { await skills.addSource(inp.value); openSkillsPanel(); }
    catch (e) { addMsg2.textContent = '⚠️ ' + (e?.message || e); addMsg2.classList.add('err'); inp.focus(); }
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') add.click(); });
  addRow.append(inp, add);
  srcBox.append(addRow, addMsg2);
  box.appendChild(srcBox);
}

async function browseRepo(repo, box) {
  box.querySelector(`.sk-browse[data-repo="${CSS.escape(repo)}"]`)?.remove();
  const list = document.createElement('div');
  list.className = 'sk-browse';
  list.dataset.repo = repo;
  list.setAttribute('aria-live', 'polite');
  list.append(el('div', 'sk-h', t('skLoading', { repo })));
  box.appendChild(list);
  try {
    const found = await skills.listFromRepo(repo);
    list.replaceChildren(el('div', 'sk-h', t('skFound', { repo, n: found.length })));
    for (const sk of found.slice(0, 120)) {
      const row = document.createElement('div');
      row.className = 'sk-row';
      row.append(el('b', null, sk.name), el('span', 'muted', sk.dir));
      const btn = document.createElement('button');
      const on = skills.isInstalled(sk.repo, sk.path);
      btn.className = on ? 'ghost' : 'primary';
      btn.textContent = on ? t('skInstalledOne') : t('skInstall');
      btn.setAttribute('aria-label', (on ? t('skInstalledOne') : t('skInstall')) + ': ' + sk.name);
      btn.onclick = async () => {
        btn.textContent = '…'; btn.disabled = true;
        try {
          const entry = await skills.installFromRepo(sk);
          btn.textContent = t('skInstalledOne'); btn.className = 'ghost';
          cierraAjustes();                                  // cierra el panel
          addMsg('assistant', skills.usageMessage(entry));  // «cómo usarla» en el chat
        } catch (e) {
          btn.textContent = t('skInstall'); btn.disabled = false;
          row.append(el('span', 'muted sk-msg err', '⚠️ ' + (e?.message || e)));
        }
      };
      row.appendChild(btn);
      list.appendChild(row);
    }
  } catch (e) {
    const msg = /Failed to fetch|NetworkError|network/i.test(String(e?.message)) ? t('skNoNet', { repo }) : t('skLoadFailed', { repo, e: e?.message || e });
    const retry = document.createElement('button');
    retry.className = 'primary'; retry.textContent = t('retry');
    retry.onclick = () => browseRepo(repo, box);
    const fila = el('div', 'sk-row');
    fila.append(el('span', 'sk-msg err', '⚠️ ' + msg), retry);
    list.replaceChildren(el('div', 'sk-h', repo), fila);
  }
}

// ---------- command palette (Cmd/Ctrl+P) ----------
let palItems = [], palSel = 0;
const COMMANDS = [
  { label: t('newConv'), run: () => conv.create() },
  { label: t('tHistory'), run: () => $('btn-history').click() },
  { label: t('pSearchCode'), run: () => openPalette('#') },
  { label: t('pManageSkills'), run: () => { closePalette(); openSkillsPanel(); } },
  { label: t('tActSettings'), run: () => { closePalette(); renderSettings(); } },
  { label: t('pToggleExplorer'), run: () => $('act-files').click() },
  { label: t('pToggleTerm'), hint: 'Ctrl+`', run: () => { closePalette(); toggleTerminal(); } },
  { label: t('pSave', { k: atajo('S') }), run: () => saveActive() },
  { label: t('mLab'), run: () => abrirLab() },
];
// El banco de pruebas (lab.html) existía pero no había forma de llegar a él
// desde el IDE: solo escribiendo la URL. Se abre en otra pestaña para no
// dejar a medias lo que tengas aquí.
function abrirLab() { window.open('lab.html', '_blank', 'noopener'); }

// La paleta es un combobox con su lista (role=listbox, opción activa en
// aria-activedescendant), así un lector de pantalla sigue la selección.
let volverDePaleta = null;
function openPalette(prefix = '') {
  if ($('palette').hidden) volverDePaleta = document.activeElement;
  $('palette').hidden = false;
  const inp = $('pal-input');
  inp.setAttribute('role', 'combobox');
  inp.setAttribute('aria-controls', 'pal-list');
  inp.setAttribute('aria-expanded', 'true');
  inp.setAttribute('aria-autocomplete', 'list');
  $('pal-list').setAttribute('role', 'listbox');
  inp.value = prefix;
  inp.focus();
  renderPalette();
}
function closePalette() {
  if ($('palette').hidden) return;
  $('palette').hidden = true;
  $('pal-input').setAttribute('aria-expanded', 'false');
  const v = volverDePaleta; volverDePaleta = null;
  if (v && document.body.contains(v) && document.activeElement === $('pal-input')) v.focus?.();
}

function fuzzy(q, s) {
  q = q.toLowerCase(); s = s.toLowerCase();
  let i = 0, score = 0, streak = 0;
  for (const ch of s) {
    if (i < q.length && ch === q[i]) { i++; streak++; score += streak; }
    else streak = 0;
  }
  return i === q.length ? score + (s.endsWith(q) ? 20 : 0) : -1;
}

// «#texto»: busca DENTRO de los ficheros (code.search) y lista cada resultado
// como fichero:línea; Enter lo abre en esa línea. Es lo que hace ahora Edit ›
// Buscar en el código (antes solo escribía «busca » en el chat).
let palSeq = 0, palBusca = null;
async function resultadosBusqueda(q) {
  const out = await codeTools.search({ query: q }).catch(e => 'ERROR: ' + e.message);
  const items = [];
  for (const linea of String(out).split('\n')) {
    const m = linea.match(/^(.+?):(\d+): (.*)$/);
    if (m) items.push({ label: m[3] || '·', hint: `${m[1]}:${m[2]}`, run: () => { closePalette(); openFile(m[1]).then(() => gotoLine(+m[2])); } });
  }
  const nota = String(out).split('\n').find(l => l.startsWith('…') || l.startsWith('Sin resultados') || l.startsWith('ERROR'));
  return { items, nota };
}

async function renderPalette() {
  const raw = $('pal-input').value;
  const list = $('pal-list');
  const seq = ++palSeq;
  palItems = [];
  let nota = '';

  if (raw.startsWith('#')) {                       // buscar en el código
    const q = raw.slice(1).trim();
    if (q.length < 2) nota = t('palSearchHint');
    else {
      clearTimeout(palBusca);
      await new Promise(r => { palBusca = setTimeout(r, 180); });
      if (seq !== palSeq) return;                  // se siguió escribiendo
      const r = await resultadosBusqueda(q);
      if (seq !== palSeq) return;
      palItems = r.items.slice(0, 60);
      nota = r.nota || '';
    }
  } else if (raw.startsWith('>')) {                       // comandos
    const q = raw.slice(1).trim().toLowerCase();
    // Todo comando cierra la paleta al ejecutarse: «Nueva conversación», por
    // ejemplo, la dejaba abierta encima.
    palItems = COMMANDS.filter(c => c.label.toLowerCase().includes(q)).map(c => ({ label: c.label, hint: t('palCmd'), run: () => { closePalette(); c.run(); } }));
  } else if (raw.startsWith('@')) {                // símbolos del archivo abierto (Monaco)
    palItems = [{ label: t('palGotoSym'), hint: '@', run: () => { closePalette(); conFichero(() => triggerEditor('editor.action.quickOutline'))(); } }];
  } else {                                          // archivos (con :línea opcional)
    const [pathQ, lineQ] = raw.split(':');
    const files = await codeTools.fileList().catch(() => []);
    const scored = pathQ.trim()
      ? files.map(f => ({ f, s: fuzzy(pathQ.trim(), f.split('/').pop()) * 2 + fuzzy(pathQ.trim(), f) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s)
      : files.slice(0, 40).map(f => ({ f, s: 0 }));
    palItems = scored.slice(0, 40).map(({ f }) => ({
      label: f.split('/').pop(), hint: f, icon: true,
      run: () => { closePalette(); openFile(f); if (lineQ && +lineQ) setTimeout(() => gotoLine(+lineQ), 300); },
    }));
  }
  if (seq !== palSeq) return;
  list.replaceChildren();
  palSel = 0;
  palItems.forEach((it, i) => {
    const row = el('button', 'pal-item' + (i === 0 ? ' sel' : ''));
    row.type = 'button';
    row.id = 'pal-opt-' + i;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    row.tabIndex = -1;
    row.innerHTML = '<span class="pi-name"></span><span class="pi-hint"></span>';
    row.querySelector('.pi-name').textContent = it.label;
    row.querySelector('.pi-hint').textContent = it.hint || '';
    row.onmouseenter = () => { palSel = i; paintPalSel(); };
    row.onclick = () => it.run();
    list.appendChild(row);
  });
  if (!palItems.length) list.appendChild(el('div', 'pal-empty', nota || t('palEmpty')));
  else if (nota) list.appendChild(el('div', 'pal-empty', nota));
  paintPalSel();
}
function paintPalSel() {
  [...$('pal-list').querySelectorAll('.pal-item')].forEach((c, i) => { c.classList.toggle('sel', i === palSel); c.setAttribute('aria-selected', i === palSel ? 'true' : 'false'); });
  const opt = $('pal-list').querySelector('#pal-opt-' + palSel);
  if (opt) { $('pal-input').setAttribute('aria-activedescendant', opt.id); opt.scrollIntoView({ block: 'nearest' }); }
  else $('pal-input').removeAttribute('aria-activedescendant');
}
$('pal-input').addEventListener('input', renderPalette);
$('pal-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') return closePalette();
  if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palSel + 1, palItems.length - 1); paintPalSel(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(palSel - 1, 0); paintPalSel(); }
  if (e.key === 'Enter') { e.preventDefault(); palItems[palSel]?.run(); }
});
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') { e.preventDefault(); openPalette(e.shiftKey ? '>' : ''); }
  if (e.key === 'Escape' && !$('palette').hidden) closePalette();
});
// Cerrar la paleta al pulsar fuera, PERO no cuando el clic viene del menú: es
// el menú el que la abre («Go to file»), y sin esta excepción el mismo clic la
// abría y la cerraba — el `onclick` del item la mostraba y acto seguido el
// evento seguía burbujeando hasta aquí, donde el target es el item del menú,
// que no está dentro de #palette. Con Cmd+P funcionaba porque es teclado y no
// pasa por este camino, y por eso parecía que «el atajo sí y el menú no».
document.addEventListener('click', e => {
  if (!e.target.closest('#palette, #menubar, #topmenu')) closePalette();
});

// ---------- barra de menú File/Edit/View/Git ----------
async function menuFor(which) {
  if (which === 'file') return [
    { label: t('mNewFile'), run: () => { const p = prompt(t('promptNewPath')); if (p) codeTools.write({ path: p, content: '' }).then(() => { openFile(p); refreshTree(); }); } },
    { label: t('mSave'), hint: atajo('S'), run: () => saveActive() },
    { label: t('mOpenFolder'), run: async () => {
      // Cambiar de carpeta con la elfa a medias deja su trabajo sobre el
      // proyecto anterior: se pregunta antes.
      if (conv.isBusy() && !confirm(t('openFolderBusy'))) return;
      let handle;
      try { handle = await window.showDirectoryPicker({ mode: 'readwrite' }); }
      catch (e) { if (e?.name !== 'AbortError') $('statusbar').textContent = '⚠️ ' + t('openFolderFailed', { e: e?.message || e }); return; }
      try { await enterIDE(handle); } catch (e) { avisaFalloApertura(e); }
    } },
  ];
  if (which === 'edit') return [
    { label: t('mSearchCode'), hint: '#', run: () => openPalette('#') },
    { label: t('mGotoFile'), hint: atajo('P'), run: () => openPalette('') },
    { label: t('mGotoSym'), run: conFichero(() => triggerEditor('editor.action.quickOutline')) },
  ];
  if (which === 'view') return [
    { label: t('tFiles'), run: () => $('act-files').click() },
    { label: t('mTerminal'), hint: 'Ctrl+`', run: () => toggleTerminal(true) },
    { label: t('mArch'), run: () => openView('arch') },
    { label: t('tCity'), run: () => openView('city') },
    { label: t('mPalette'), hint: atajo('P', true), run: () => openPalette('>') },
    { label: 'Skills', run: () => openSkillsPanel() },
    { label: t('mLab'), hint: '↗', run: () => abrirLab() },
    { label: t('mAbout'), hint: '↗', run: () => window.open('https://github.com/KikoCis/elffuss-code', '_blank', 'noopener') },
  ];
  if (which === 'git') {
    // Rama y último commit enlazan al remoto (sin credenciales) cuando lo hay;
    // si no, se ven como texto desactivado. Antes parecían opciones y no hacían
    // nada. El commit enseña su SHA corto; el correo del autor, nunca.
    const g = await codeTools.gitInfo();
    if (!g.isRepo) return [{ label: t('gNotRepo'), disabled: true }];
    const abre = url => () => window.open(url, '_blank', 'noopener,noreferrer');
    const items = [g.web
      ? { label: t('gBranch', { b: g.branch }), hint: '↗', title: g.web.branch(g.branch), run: abre(g.web.branch(g.branch)) }
      : { label: t('gBranch', { b: g.branch }), hint: t('gNoRemote'), disabled: true }];
    if (g.lastCommit) {
      const corto = g.lastCommit.sha ? g.lastCommit.sha.slice(0, 7) + ' · ' : '';
      const label = t('gLast', { m: corto + g.lastCommit.msg.slice(0, 40) });
      items.push(g.web && g.lastCommit.sha
        ? { label, hint: '↗', title: g.web.commit(g.lastCommit.sha), run: abre(g.web.commit(g.lastCommit.sha)) }
        : { label, hint: g.lastCommit.author, disabled: true });
    }
    // Pide al agente el MENSAJE de commit: commitear de verdad no puede (el git
    // de aquí es de solo lectura), y la etiqueta vieja lo prometía.
    items.push({ label: t('gCommit'), run: () => { $('prompt').value = t('pCommit'); $('prompt').focus(); } });
    return items;
  }
  return [];
}
// La barra de menús se usa con el teclado como una de verdad (patrón
// menubar/menu): ↓, Enter o Espacio abren el menú con el foco en su primera
// opción; ←/→ pasan al menú de al lado; ↑/↓ recorren; Escape cierra y devuelve
// el foco; Tab sale. Antes ↓ no entraba en el menú y Escape no lo cerraba. Los
// nombres salen en el idioma de la interfaz.
const barraMenus = () => [...document.querySelectorAll('#menubar button')];
let menuBarraAbierto = null;
{
  const bar = $('menubar');
  bar.setAttribute('role', 'menubar');
  bar.setAttribute('aria-label', t('menubarLabel'));
  barraMenus().forEach((b, i) => {
    b.setAttribute('role', 'menuitem');
    b.setAttribute('aria-haspopup', 'menu');
    b.setAttribute('aria-expanded', 'false');
    b.textContent = t('menu_' + b.dataset.menu);
    b.tabIndex = i === 0 ? 0 : -1;
    b.addEventListener('click', () => (menuBarraAbierto === b ? cierraMenuBarra({ foco: true }) : abreMenuBarra(b)));
    b.addEventListener('keydown', e => {
      const lista = barraMenus(), j = lista.indexOf(b);
      const mueve = k => { const n = lista[(j + k + lista.length) % lista.length]; lista.forEach(x => { x.tabIndex = x === n ? 0 : -1; }); n.focus(); if (menuBarraAbierto) abreMenuBarra(n, { foco: true }); };
      if (e.key === 'ArrowRight') { e.preventDefault(); mueve(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); mueve(-1); }
      else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abreMenuBarra(b, { foco: true }); }
    });
  });
}
async function abreMenuBarra(b, { foco = false } = {}) {
  barraMenus().forEach(x => { x.classList.toggle('open', x === b); x.setAttribute('aria-expanded', x === b ? 'true' : 'false'); });
  menuBarraAbierto = b;
  openMenuAt(await menuFor(b.dataset.menu), b);
  if (menuBarraAbierto !== b) return;      // otro menú se abrió mientras tanto
  if (foco) $('topmenu').querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
}
function cierraMenuBarra({ foco = false } = {}) {
  const b = menuBarraAbierto;
  $('topmenu').hidden = true;
  barraMenus().forEach(x => { x.classList.remove('open'); x.setAttribute('aria-expanded', 'false'); });
  menuBarraAbierto = null;
  if (foco && b) b.focus();
}
function openMenuAt(items, anchor) {
  const menu = $('topmenu');
  const r = anchor.getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.style.top = (r.bottom + 3) + 'px';
  menu.replaceChildren();
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', anchor.textContent);
  for (const it of items) {
    const row = el('button', 'menu-item');
    row.type = 'button';
    row.setAttribute('role', 'menuitem');
    row.tabIndex = -1;
    row.innerHTML = `<b></b>${it.hint ? '<span></span>' : ''}`;
    row.querySelector('b').textContent = it.label;
    if (it.hint) row.querySelector('span').textContent = it.hint;
    if (it.title) row.title = it.title;
    if (it.disabled) { row.setAttribute('aria-disabled', 'true'); row.classList.add('disabled'); }
    // stopPropagation: el clic no debe seguir hasta los «clic fuera» del
    // documento, que cerraban al instante lo que la opción acababa de abrir
    // (la paleta con «Ir a archivo…» o «Buscar en el código»).
    row.onclick = (e) => { e.stopPropagation(); if (it.disabled) return; cierraMenuBarra(); it.run(); };
    menu.appendChild(row);
  }
  menu.hidden = false;
}
$('topmenu').addEventListener('keydown', e => {
  const filas = [...$('topmenu').querySelectorAll('[role="menuitem"]')];
  const i = filas.indexOf(document.activeElement);
  const ve = k => { e.preventDefault(); filas[(i + k + filas.length) % filas.length]?.focus(); };
  if (e.key === 'ArrowDown') ve(1);
  else if (e.key === 'ArrowUp') ve(-1);
  else if (e.key === 'Home') { e.preventDefault(); filas[0]?.focus(); }
  else if (e.key === 'End') { e.preventDefault(); filas.at(-1)?.focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); cierraMenuBarra({ foco: true }); }
  else if (e.key === 'Tab') cierraMenuBarra();
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const lista = barraMenus(), j = lista.indexOf(menuBarraAbierto);
    const n = lista[(j + (e.key === 'ArrowRight' ? 1 : -1) + lista.length) % lista.length];
    lista.forEach(x => { x.tabIndex = x === n ? 0 : -1; });
    abreMenuBarra(n, { foco: true });
  }
});
document.addEventListener('click', e => {
  if (!e.target.closest('#menubar, #topmenu') && !$('topmenu').hidden) cierraMenuBarra();
});

// ---------- git en el header ----------
async function refreshGit() {
  const g = await codeTools.gitInfo().catch(() => ({ isRepo: false }));
  const chip = $('git-branch');
  if (g.isRepo) { chip.hidden = false; chip.innerHTML = UI.code + ' ' + g.branch; }
  else chip.hidden = true;
}
$('git-branch').addEventListener('click', () => document.querySelector('#menubar button[data-menu="git"]').click());

// icono de skills en la barra de actividad
$('act-skills').innerHTML = UI.puzzle;
$('act-skills').addEventListener('click', () => openSkillsPanel());

rebuildSelect();
skills.initSkills();
boot();
window.elffussClaw = { conv, get agent() { return conv.getActive()?.agent; }, send, openFile, parseToolCall, skills };


// ---------- puerta de móvil y chip de disco ----------
// Declaradas con `function` para que se icen: preloadModel() las usa y está
// escrita más arriba en el fichero.
function avisoMovil(tam, onAccept) {
  // Se pinta FIJO sobre la pantalla, no dentro del layout: cuando esto corre,
  // #chat todavía no existe (Code construye su interfaz después), así que caía
  // al body y el propio layout lo tapaba — presente en el DOM y invisible para
  // el usuario, que es la peor variante de un aviso.
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:99999;'
    + 'width:min(92vw,520px);padding:16px;border:1px solid #3a3a4a;border-radius:14px;'
    + 'background:#15161f;color:#eae8f2;box-shadow:0 18px 50px -18px rgba(0,0,0,.8);'
    + 'display:flex;flex-direction:column;gap:8px;font:14px/1.5 system-ui,sans-serif';
  const h = document.createElement('b'); h.textContent = '📱 En el móvil todavía no funciona';
  const p1 = document.createElement('span'); p1.style.opacity = '.75';
  p1.textContent = 'Elffuss Code ejecuta el modelo dentro de tu propio navegador. En el móvil eso hoy no sale bien: '
    + 'habría que descargar ' + tam + ' y el navegador suele cerrar la pestaña antes de terminar. '
    + 'Así que no te lo descargo sin preguntar.';
  const p2 = document.createElement('span'); p2.style.opacity = '.75';
  p2.textContent = 'Ábrelo en un ordenador y sí funciona: ahí es donde vive.';
  const fila = document.createElement('div');
  fila.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const b = document.createElement('button');
  b.style.cssText = 'flex:1;padding:9px 12px;border-radius:9px;border:1px solid #4a4a5e;background:#22232f;color:inherit;font:inherit;cursor:pointer';
  b.textContent = 'Descargarlo igualmente (' + tam + ')';
  b.onclick = () => { try { localStorage.setItem('elffusscode.movil.ok', '1'); } catch {} box.remove(); onAccept(); };
  const x = document.createElement('button');
  x.style.cssText = 'padding:9px 12px;border-radius:9px;border:1px solid #4a4a5e;background:transparent;color:inherit;font:inherit;cursor:pointer';
  x.textContent = 'Entendido';
  x.onclick = () => box.remove();
  fila.append(b, x);
  box.append(h, p1, p2, fila);
  document.body.appendChild(box);
}

// Tamaño legible: MB por debajo de 1 GB.
function tamano(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.round(n / 1048576) + ' MB'; }

// Vaciar los modelos guardados: lo usan el chip 💾 y «Vaciar caché» de Ajustes.
// Devuelve el mensaje con lo que pasó (o null si el usuario canceló).
async function vaciarModelos(boton) {
  const m = await modelUsage();
  if (!confirm(t('clearModelsConfirm', { size: tamano(m.total) }) + (m.sharedOk ? '' : '\n\n' + t('clearModelsShared')))) return null;
  const antes = boton.textContent;
  boton.disabled = true; boton.setAttribute('aria-busy', 'true');
  boton.textContent = t('setClearing');
  let r;
  try { r = await clearModels(); }
  finally { boton.disabled = false; boton.removeAttribute('aria-busy'); boton.textContent = antes; }
  let msg = t('clearModelsDone', { size: tamano(r.liberado) });
  if (r.fallos.length) msg += ' ' + t('clearModelsFailed', { what: r.fallos.join(' · ') });
  if (!r.sharedOk) msg += ' ' + t('clearModelsShared');
  $('statusbar').textContent = msg;
  return msg;
}

// Chip 💾: lo que ocupan los MODELOS (no el origen entero, que mezclaba
// conversaciones y el proyecto de prueba) y un clic para vaciarlos.
function mountDiskChip() {
  const chip = document.getElementById('disk-chip');
  if (!chip) return;
  async function paint() {
    const { quota } = await cacheEstimate();
    const m = await modelUsage();
    if (!m.total) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.textContent = '💾 ' + tamano(m.total);
    chip.title = t('diskChipTitle', { size: tamano(m.total), quota: quota ? t('diskChipQuota', { quota: tamano(quota) }) : '' })
      + (m.sharedOk ? '' : t('setSharedUnknown'));
  }
  chip.addEventListener('click', async () => {
    const msg = await vaciarModelos(chip);
    if (msg) await paint();
  });
  paint();
  setInterval(paint, 20000);
}
mountDiskChip();

// ── Compositor: menú de modos, ancho del chat y caja que crece ──────────────
// Los tres botones de modo siguen siendo los mismos elementos con los mismos
// ids: lo único que cambia es que viven dentro de un desplegable. Así el JS que
// ya los escuchaba no se entera de nada.
{
  const modos = $('btn-modos'), menu = $('modos-menu');
  if (modos && menu) {
    // Cada modo lleva DEBAJO lo que hace. El texto sale del `title` que ya
    // tenía el botón: estaba escrito y bien, pero solo lo veía quien dejara el
    // ratón quieto encima — o sea casi nadie, y en móvil nadie. «Auto», «Goal»
    // y «Hard Work» sueltos no dicen nada a quien llega nuevo.
    for (const b of menu.querySelectorAll('.cbtn')) {
      const que = b.getAttribute('title');
      if (!que || b.querySelector('.modo-que')) continue;
      const span = document.createElement('span');
      span.className = 'modo-que';
      // Cortar por el primer paréntesis dejaba «Hard Work (RLM): lee tu
      // proyecto…» en «Hard Work», o sea una explicación que repite el nombre
      // del botón y no explica nada. Lo que sobra es el PREFIJO —«Nombre
      // (SIGLAS):»— no lo que viene detrás, que es justo la frase útil.
      span.textContent = que
        .replace(/^[^:]{0,40}:\s*/, '')      // fuera «Hard Work (RLM): »
        .split('.')[0]                        // la primera frase
        .replace(/\s*\([^)]*\)\s*/g, ' ')   // sin incisos entre paréntesis
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      b.appendChild(span);
      // Ya está a la vista: dejar el title duplicaría el texto en un tooltip.
      b.removeAttribute('title');
    }
    // Menú con casillas: cada modo dice si está encendido (aria-checked) y el
    // botón «Modos» enseña cuáles lo están, también cerrado. Antes cualquier
    // clic dentro cerraba el menú y desde fuera no había forma de saber que
    // Goal o Hard Work seguían activos (y las preguntas normales se volvían
    // planes sin avisar). Ahora pulsar un modo lo cambia y el menú se queda
    // abierto para verlo; se cierra al pulsar fuera o con Escape.
    modos.setAttribute('aria-haspopup', 'menu');
    modos.setAttribute('aria-expanded', 'false');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', t('modesLabel'));
    for (const b of menu.querySelectorAll('.cbtn')) b.setAttribute('role', 'menuitemcheckbox');
    modos.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.hidden) { menu.hidden = false; modos.setAttribute('aria-expanded', 'true'); menu.querySelector('.cbtn')?.focus(); }
      else cierraModos({ foco: false });
    });
    menu.addEventListener('keydown', (e) => {
      const opciones = [...menu.querySelectorAll('.cbtn')], i = opciones.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); opciones[(i + 1) % opciones.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); opciones[(i - 1 + opciones.length) % opciones.length]?.focus(); }
      else if (e.key === 'Tab') cierraModos({ foco: false });
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#modos') && !menu.hidden) cierraModos({ foco: false });
    });
    pintaModos();
  }

  // El chat a toda la ventana. Al editor se le da cero de ancho en vez de
  // quitarlo: volver es instantáneo y no se pierde lo que hubiera abierto.
  const ancho = $('btn-ancho');
  if (ancho) {
    const pinta = () => {
      const full = document.body.classList.contains('chat-full');
      ancho.textContent = full ? '⇥' : '⇔';
      ancho.title = full ? 'Recuperar el editor' : 'Ensanchar el chat a toda la ventana';
    };
    try { if (localStorage.getItem('elffusscode.chatfull') === '1') document.body.classList.add('chat-full'); }
    catch { /* sin localStorage se queda como está */ }
    pinta();
    ancho.addEventListener('click', () => {
      document.body.classList.toggle('chat-full');
      try { localStorage.setItem('elffusscode.chatfull', document.body.classList.contains('chat-full') ? '1' : '0'); }
      catch { /* — */ }
      pinta();
    });
  }

  // La caja crece con el texto hasta el tope que pone el CSS. Se recalcula
  // desde cero (`auto`) antes de medir: si no, una vez crecida ya no encoge al
  // borrar, y acaba ocupando media pantalla vacía.
  const caja = $('prompt');
  if (caja && caja.tagName === 'TEXTAREA') {
    const crece = () => {
      caja.style.height = 'auto';
      caja.style.height = Math.min(caja.scrollHeight, window.innerHeight * 0.4) + 'px';
    };
    caja.addEventListener('input', crece);
    // Al enviar, el valor se vacía desde fuera y no salta `input`: sin esto la
    // caja se queda alta y vacía después de cada mensaje.
    new MutationObserver(crece).observe(caja, { attributes: true, attributeFilter: ['value'] });
    $('composer')?.addEventListener('submit', () => setTimeout(crece, 0));
  }
}

// ── Instalable: es lo único que consigue almacenamiento persistente ─────────
// Medido en este proyecto: `navigator.storage.persist()` devuelve false en un
// perfil normal, así que Chrome puede desalojar los gigas del modelo cuando le
// falte disco — y lo hizo. Chrome concede la persistencia a los sitios
// instalados, y solo ofrece instalar si hay manifiesto Y un service worker con
// manejador de `fetch`. De ahí `sw.js`, que no cachea nada a propósito.
//
// El registro va tras `load` para no competir con la carga del modelo, que es
// lo que el usuario está esperando de verdad.
if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(async () => {
      // Se vuelve a pedir la persistencia DESPUÉS de registrar: si el usuario ya
      // tenía el sitio instalado de una visita anterior, aquí es donde se
      // concede, y sin pedirla otra vez nadie se enteraría.
      try {
        if (navigator.storage?.persist && !(await navigator.storage.persisted())) {
          const ok = await navigator.storage.persist();
          console.log('[elffuss] almacenamiento persistente: ' + (ok ? 'concedido' : 'denegado — instala la app para que el navegador no borre el modelo'));
        }
      } catch { /* el diagnóstico no vale un error */ }
    }).catch(e => console.warn('[elffuss] service worker no registrado: ' + e.message));
  });
}

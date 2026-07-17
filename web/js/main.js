// Elffuss Code: landing («abre tu carpeta») → IDE con la elfa integrada.
import { parseToolCall } from './agent.js';
import * as rules from './providers/rules.js';
import * as codeTools from './tools/code.js';
import * as db from './db.js';
import * as settings from './settings.js';
import { initEditor, refreshTree, openFile, gotoLine, triggerEditor, hasEditor } from './ide.js';
import { ACTIVITY, UI } from './icons.js';
import { renderMarkdown } from './md.js';
import * as skills from './skills.js';
import * as terminal from './terminal.js';
import * as shell from './shell.js';
import { setTerminalEcho } from './tools/index.js';
import { ensureModelCache, cacheEstimate, clearModelCache } from './model-cache.js';
import * as ceo from './ceo.js';
import * as mind from './mind.js';
import { buildCityAdapter, loadThoughtsAdapter } from './mind-adapter.js';
import { humanizeStreamPreview } from './humanize.js';
import * as bridge from './bridge.js';
import * as conv from './conversations.js';
import { TASK_PREFIX } from './goal.js';
import * as telemetry from './telemetry.js';

const $ = id => document.getElementById(id);
telemetry.init('elffuss-code'); // opt-in, apagado por defecto — ver Ajustes
conv.setProvider(rules); // proveedor por defecto para cualquier conversación que se cree
let activeModel = 'rules';

// ---------- chat ----------
// Los `paths` entre backticks del chat (README.md, .elffuss/soul/x.md…) se
// vuelven clicables → abren el fichero en el editor directamente, sin tener
// que ir a buscarlos a mano.
function linkifyFilePaths(root) {
  root.querySelectorAll('code').forEach(el => {
    const t = el.textContent.trim();
    if (!/^[\w.-]+(\/[\w.-]+)*\.[a-z0-9]{1,10}$/i.test(t) || /[{}()<>]/.test(t)) return;
    el.classList.add('file-link');
    el.title = 'abrir ' + t;
    el.onclick = () => openFile(t);
  });
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
  $('chat-log').appendChild(div);
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
    a.textContent = String(arg).slice(0, 60);
    div.appendChild(a);
  }
  $('chat-log').appendChild(div);
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
  pre.textContent = result.slice(0, 1500);
  det.append(sum, pre);
  $('chat-log').appendChild(det);
  $('chat-log').scrollTop = $('chat-log').scrollHeight;
  return det;
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 🎯 Modo Objetivo: tarjeta de plan (planificador → lista de tareas →
// ejecutor). Un solo nodo por plan (mismo id), repintado in-place según
// llegan los eventos 'plan'/'plan_update'/'plan_complete' — así se ve la
// lista evolucionar en vivo en vez de reconstruirse entera cada vez.
const PLAN_ICO = { pending: '⏳', 'in-progress': '🔄', done: '✅', failed: '❌', skipped: '⏭️' };
const PLAN_STATUS_LABEL = { planning: 'planificando…', running: 'ejecutando…', done: 'completado', failed: 'con fallos' };
function renderPlanCard(plan) {
  const domId = 'plan-' + plan.id;
  let div = document.getElementById(domId);
  if (!div) {
    div = document.createElement('div');
    div.id = domId;
    div.className = 'msg plan-card';
    $('chat-log').appendChild(div);
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
  label.textContent = 'Elffuss está pensando';
  const gen = document.createElement('div');
  gen.className = 'gen';
  div.append(label, gen);
  let buf = '';
  return {
    tick(t) {
      buf += t;
      label.textContent = `Elffuss escribe · ${buf.length} car.`; // caracteres, no tokens
      // si el buffer entró en un bloque de tool-call, no enseñes el JSON crudo
      // según va llegando: una frase humana («leyendo app.js…») en su lugar.
      const preview = humanizeStreamPreview(buf);
      gen.classList.toggle('tool-preview', !!preview);
      gen.textContent = preview ? '⟐ ' + preview : (buf.length > 200 ? '…' : '') + buf.slice(-200);
      $('chat-log').scrollTop = $('chat-log').scrollHeight;
    },
    tool(name) { buf = ''; gen.textContent = ''; label.textContent = `Elffuss usa ${name}`; },
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
      else addMsg('assistant', m.content);
    }
  }
  if (active.pumping) activeThinking = thinkingBubble();
}

// evento del módulo de conversaciones: 'switch' (cambiaste de pestaña o se
// creó una), 'tabs' (se abrió/cerró una pestaña), 'pumping' (empezó/terminó
// de procesar), 'event' (token/texto/tool/resultado/error de un turno real).
// Las conversaciones EN SEGUNDO PLANO nunca tocan el DOM visible — solo se
// refleja su punto de «ocupada» en la barra de pestañas.
function onConvEvent(kind, id, payload) {
  if (kind !== 'event') renderTabsBar();
  if (kind === 'switch') { renderActiveLog(); return; }
  const active = conv.getActive();
  if (!active || id !== active.id) return;
  if (kind === 'pumping') {
    $('btn-send').disabled = payload;
    $('btn-send').classList.toggle('sending', payload);
    if (payload) { if (!activeThinking) activeThinking = thinkingBubble(); }
    else { activeThinking?.remove(); activeThinking = null; }
    return;
  }
  if (kind === 'event') {
    const ev = payload;
    if (ev.type === 'token') activeThinking?.tick(ev.text);
    if (ev.type === 'text') addMsg('assistant', ev.text);
    if (ev.type === 'tool') { activeThinking?.tool(ev.call.tool); addTool(ev.call.tool, ev.call.args?.path || ev.call.args?.query || ''); }
    if (ev.type === 'tool_result') addToolResult(ev.result);
    if (ev.type === 'error') addMsg('assistant err', ev.text);
    // 🎯 Modo Objetivo: la tarjeta de plan se crea con 'plan' y se repinta
    // in-place en cada 'plan_update'/'plan_complete' (mismo nodo, por id).
    if (ev.type === 'plan' || ev.type === 'plan_update' || ev.type === 'plan_complete') renderPlanCard(ev.plan);
  }
}

function send(text) {
  const active = conv.getActive();
  if (!active) return;
  addMsg('user', text);
  if (goalMode) conv.startGoal(active.id, text);
  else conv.send(active.id, text);
}

function renderTabsBar() {
  const bar = $('conv-tabs');
  if (!bar) return;
  bar.replaceChildren();
  const active = conv.getActive();
  for (const c of conv.getOpenTabs()) {
    const el = document.createElement('div');
    el.className = 'tab' + (active && c.id === active.id ? ' active' : '') + (c.pumping ? ' tab-busy' : '');
    el.dataset.id = c.id;
    const name = document.createElement('span');
    name.className = 'tab-name';
    const title = conv.titleFor(c);
    name.textContent = title;
    name.title = title;
    const x = document.createElement('b');
    x.textContent = '×';
    x.title = 'Cerrar pestaña (no borra la conversación)';
    x.onclick = e => { e.stopPropagation(); conv.closeTab(c.id); };
    el.append(name, x);
    el.onclick = () => conv.switchTo(c.id);
    bar.appendChild(el);
  }
  const plus = document.createElement('button');
  plus.className = 'tab-add';
  plus.title = 'Nueva conversación';
  plus.textContent = '+';
  plus.onclick = () => conv.create();
  bar.appendChild(plus);
}

async function renderHistoryPanel() {
  const panel = $('history-panel');
  panel.replaceChildren();
  const head = document.createElement('div');
  head.className = 'hp-head';
  head.append(document.createTextNode('Historial de conversaciones'));
  const xBtn = document.createElement('button');
  xBtn.textContent = '✕';
  xBtn.onclick = () => { panel.hidden = true; };
  head.appendChild(xBtn);
  panel.appendChild(head);
  const list = document.createElement('div');
  list.id = 'hp-list';
  panel.appendChild(list);
  const all = await conv.listAll();
  if (!all.length) {
    const empty = document.createElement('div');
    empty.className = 'hp-empty';
    empty.textContent = 'Sin conversaciones guardadas todavía.';
    list.appendChild(empty);
    return;
  }
  for (const c of all) {
    const row = document.createElement('div');
    row.className = 'hp-row';
    const t = document.createElement('div');
    t.className = 'hp-title';
    t.textContent = c.title || 'Nueva conversación';
    const d = new Date(c.updatedAt);
    const date = document.createElement('div');
    date.className = 'hp-date';
    date.textContent = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const del = document.createElement('button');
    del.className = 'hp-del';
    del.title = 'Eliminar para siempre';
    del.textContent = '🗑';
    del.onclick = async e => {
      e.stopPropagation();
      if (!confirm(`¿Eliminar «${c.title || 'esta conversación'}» para siempre?`)) return;
      await conv.remove(c.id);
      renderHistoryPanel();
    };
    row.append(t, date, del);
    row.onclick = async () => { await conv.open(c.id); panel.hidden = true; };
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
const defaultBrain = () => !realGPU ? 'onnx' : (isMobile() ? 'litert:gemma-e2b' : 'litert:gemma-e4b');

function modelOptions() {
  const opts = [];
  if (realGPU) opts.push({ id: 'litert:gemma-e4b', label: 'Gemma-4 E4B · LiteRT-LM (~4 GB) ★' });
  if (realGPU) opts.push({ id: 'litert:gemma-e2b', label: 'Gemma-4 E2B · LiteRT-LM (~2 GB)' });
  opts.push({ id: 'onnx', label: 'Elffuss LM (healed · 850 MB) — ligero' });
  opts.push({ id: 'rules', label: 'Básico (sin modelo)' });
  return [...opts, ...settings.enabledExternals()];
}

function rebuildSelect() {
  const sel = $('model-select');
  sel.replaceChildren();
  for (const o of modelOptions()) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  sel.value = activeModel;
}

// progreso del modelo: píldora prominente visible sobre landing e IDE
function showModelProgress(text, pct = null) {
  const box = $('model-progress');
  if (text == null) { box.hidden = true; return; }
  box.hidden = false;
  $('model-progress-text').textContent = text;
  const bar = $('model-bar');
  if (pct == null) {
    bar.classList.add('indet');      // sin % conocido → barra animada
    bar.style.width = '';
  } else {
    bar.classList.remove('indet');
    bar.style.width = pct + '%';
  }
}

let loadingId = null;
async function changeModel(id) {
  if (id === 'rules') {
    conv.setProvider(rules);
    activeModel = 'rules';
    localStorage.setItem('elffusscode.model', 'rules');
    $('model-dot').className = 'dot off';
    return true;
  }
  if (loadingId === id || activeModel === id) return true; // un solo modelo, una sola carga
  loadingId = id;
  $('model-dot').className = 'dot loading';
  showModelProgress('Cargando el modelo IA…', 4);
  try {
    const mod = await resolveProvider(id);
    await mod.load(p => {
      if (typeof p === 'string') return showModelProgress(p);
      if (p?.status === 'progress' && p.total) {
        const pct = Math.round(p.loaded / p.total * 100);
        showModelProgress(`Descargando el modelo IA · ${pct}% · ${(p.loaded / 1e6 | 0)}/${(p.total / 1e6 | 0)} MB`, pct);
      }
    });
    conv.setProvider(mod);
    activeModel = id;
    localStorage.setItem('elffusscode.model', id);
    $('model-dot').className = 'dot on';
    showModelProgress('Modelo IA listo · готово ✳', 100);
    setTimeout(() => showModelProgress(null), 2500);
    $('statusbar').textContent = 'Modelo IA listo';
    rebuildSelect();
    return true;
  } catch (e) {
    console.error('[elffuss-code] fallo cargando', e);
    // Un Gemma (LiteRT) que no cabe → cae al Elffuss LM healed (onnx, ligero).
    if (id.startsWith('litert') && !_fellBack) {
      _fellBack = true;
      sessionStorage.setItem('elffusscode.skipGemma', '1');
      showModelProgress('Ese Gemma no cargó (memoria/GPU) — uso Elffuss LM (ligero)…');
      loadingId = null;
      const okc = await changeModel('onnx');
      _fellBack = false;
      if (okc) return true;
    }
    conv.setProvider(rules);
    activeModel = 'rules';
    $('model-dot').className = 'dot off';
    showModelProgress('⚠️ No pude cargar el modelo: ' + (e?.message || e));
    setTimeout(() => showModelProgress(null), 6000);
    rebuildSelect();
    return false;
  } finally {
    loadingId = null;
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
  const avail = new Set(modelOptions().map(o => o.id));
  const skipGemma = sessionStorage.getItem('elffusscode.skipGemma') === '1';
  const def = skipGemma ? 'onnx' : defaultBrain();
  const chain = [...new Set([saved, def, 'onnx']
    .filter(id => id && id !== 'rules' && avail.has(id)))];
  for (const id of chain) if (await changeModel(id)) return;
}

// ---------- panel ⚙️ Ajustes: modelo (cerebro) + API keys ----------
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

function settingsShell(title) {
  const box = $('settings-panel');
  box.hidden = false;
  box.replaceChildren();
  const close = el('button', 'panel-close'); close.innerHTML = UI.close; close.title = 'cerrar';
  close.onclick = () => { box.hidden = true; };
  box.append(close, el('h3', 'panel-title', title));
  return box;
}

function showBridgeMsg(card, text, isErr) {
  let el2 = card.querySelector('.br-msg');
  if (!el2) { el2 = document.createElement('div'); el2.className = 'br-msg muted'; el2.style.cssText = 'font-size:.7rem;margin-top:6px'; card.appendChild(el2); }
  el2.textContent = text;
  el2.style.color = isErr ? '#ff6b8b' : '';
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
  const box = settingsShell('Ajustes');

  // --- Cerebro (modelo) ---
  box.append(el('div', 'sk-h', 'Cerebro (modelo)'));
  const LOCAL = [
    { id: 'litert:gemma-e4b', name: 'Gemma-4 E4B ★', sub: 'El mejor · WebGPU local · ~4 GB', need: 'gpu' },
    { id: 'litert:gemma-e2b', name: 'Gemma-4 E2B', sub: 'Ligero · WebGPU local · ~2 GB', need: 'gpu' },
    { id: 'onnx', name: 'Elffuss LM (healed)', sub: 'Modelo propio · 850 MB · tool-calls + apps' },
    { id: 'rules', name: 'Básico (sin modelo)', sub: 'Órdenes directas, cero descarga' },
  ];
  const grid = el('div', 'model-grid');
  for (const m of LOCAL) {
    if (m.need === 'gpu' && !realGPU) continue;
    const card = el('button', 'model-card' + (activeModel === m.id ? ' active' : '') + (m.disabled ? ' disabled' : ''));
    if (m.disabled) card.disabled = true;
    card.innerHTML = `<b>${m.name}</b><span>${m.sub}</span>`;
    card.onclick = () => { changeModel(m.id); renderSettings(); };
    grid.appendChild(card);
  }
  box.appendChild(grid);

  // --- Almacenamiento del modelo (caché persistente) ---
  box.append(el('div', 'sk-h', 'Modelo descargado (se cachea en tu navegador)'));
  const storeCard = el('div', 'prov-card');
  const storeInfo = el('span', null, 'Calculando espacio…'); storeInfo.style.cssText = 'font-size:.8rem;color:var(--fg)';
  const storeSub = el('div', 'field'); storeSub.style.marginTop = '2px';
  const storeMuted = el('span', 'muted', ''); storeMuted.style.fontSize = '.72rem';
  const clearBtn = el('button', 'prov-use', 'Vaciar caché');
  clearBtn.style.marginTop = '8px';
  clearBtn.onclick = async () => { clearBtn.textContent = 'Vaciando…'; await clearModelCache(); await paintStorage(); clearBtn.textContent = 'Vaciar caché'; };
  const storeHead = el('div', 'prov-head'); storeHead.append(storeInfo);
  storeCard.append(storeHead, storeMuted, clearBtn);
  box.appendChild(storeCard);
  async function paintStorage() {
    const { usage, quota, persisted } = await cacheEstimate();
    const gb = n => (n / 1073741824).toFixed(2) + ' GB';
    storeInfo.textContent = usage ? `${gb(usage)} en caché` : 'Nada cacheado todavía';
    storeMuted.textContent = (persisted ? '✓ almacenamiento persistente (no se borra solo)' : '⚠ sin persistencia: el navegador podría desalojarlo')
      + (quota ? ` · límite ~${gb(quota)}` : '');
  }
  paintStorage();

  // --- Bridge local (ejecución REAL en tu máquina: node, npm, python…) ---
  box.append(el('div', 'sk-h', '🔌 Bridge local (ejecución real en tu máquina)'));
  const brCard = el('div', 'prov-card bridge-card');
  const guessOS = () => {
    const ua = navigator.userAgent;
    if (/Mac/.test(ua)) return /Intel/.test(navigator.platform) && !/arm/i.test(ua) ? 'elffuss-bridge-mac-intel' : 'elffuss-bridge-mac-arm64';
    if (/Win/.test(ua)) return 'elffuss-bridge-windows.exe';
    if (/Linux/.test(ua)) return /aarch64|arm64/i.test(ua) ? 'elffuss-bridge-linux-arm64' : 'elffuss-bridge-linux';
    return 'elffuss-bridge-mac-arm64';
  };
  const OTHER = { 'elffuss-bridge-mac-arm64': 'Mac (Apple Silicon)', 'elffuss-bridge-mac-intel': 'Mac (Intel)', 'elffuss-bridge-windows.exe': 'Windows', 'elffuss-bridge-linux': 'Linux (x64)', 'elffuss-bridge-linux-arm64': 'Linux (ARM)' };
  const primary = guessOS();
  brCard.innerHTML =
    `<div class="prov-head"><span id="br-dot" class="dot off"></span><b>Bridge local</b><span id="br-status" class="muted" style="margin-left:auto;font-size:.72rem">desconectado</span></div>` +
    `<p class="muted" style="font-size:.72rem;margin:6px 0">Un pequeño programa que TÚ ejecutas en tu ordenador — le da a la elfa ejecución real (node, npm, python…) sin salir de tu máquina. Nada se instala en el navegador.</p>` +
    `<a class="prov-use" style="text-decoration:none;display:inline-block" href="bridge-dl/${primary}" download>⬇ Descargar para ${OTHER[primary]}</a>` +
    `<details style="margin-top:6px"><summary class="muted" style="font-size:.7rem;cursor:pointer">otro sistema operativo</summary>` +
    Object.entries(OTHER).filter(([f]) => f !== primary).map(([f, label]) => `<div><a href="bridge-dl/${f}" download style="color:var(--accent2);font-size:.72rem">${label}</a></div>`).join('') +
    `</details>` +
    `<div class="field" style="margin-top:8px"><label class="muted" style="font-size:.68rem">Token (lo imprime el programa al arrancarlo)</label><input id="br-token" placeholder="pega aquí el token…"></div>` +
    `<div class="field" style="margin-top:6px"><label class="muted" style="font-size:.68rem">Carpeta de trabajo (opcional — si no, usa una temporal)</label><input id="br-folder" placeholder="/ruta/completa/a/tu/proyecto"></div>` +
    `<button id="br-connect" class="prov-use" style="margin-top:8px">Conectar</button>`;
  box.appendChild(brCard);
  brCard.querySelector('#br-folder').value = bridge.getFolder();
  brCard.querySelector('#br-token').value = localStorage.getItem('elffusscode.bridgeToken') || '';
  const paintBridge = () => {
    // el panel puede haberse cerrado entre sondeos de fondo — si ya no está
    // en el DOM, nos desuscribimos en vez de tocar nodos huérfanos.
    if (!document.body.contains(brCard)) { bridge.onStatusChange(() => {}); return; }
    const on = bridge.isConnected();
    brCard.querySelector('#br-dot').className = 'dot ' + (on ? 'on' : 'off');
    brCard.querySelector('#br-status').textContent = on ? '✓ conectado — ejecución real activa' : 'desconectado';
    if (on) brCard.querySelector('#br-token').value = localStorage.getItem('elffusscode.bridgeToken') || '';
  };
  paintBridge();
  bridge.onStatusChange(paintBridge); // repinta solo si el bridge conecta/cae mientras Ajustes está abierto
  brCard.querySelector('#br-connect').onclick = async () => {
    const btn = brCard.querySelector('#br-connect');
    bridge.setFolder(brCard.querySelector('#br-folder').value);
    const token = brCard.querySelector('#br-token').value.trim();
    if (!token) return showBridgeMsg(brCard, '⚠️ pega el token que imprimió el programa al arrancarlo', true);
    btn.disabled = true; btn.textContent = 'Conectando…';
    try { await bridge.connect(token); paintBridge(); showBridgeMsg(brCard, '✔ conectado — ejecución real en tu máquina'); fireworks(); }
    catch (e) { showBridgeMsg(brCard, '⚠️ ' + e.message, true); }
    finally { btn.disabled = false; btn.textContent = 'Conectar'; }
  };

  // --- Permisos de ejecución (mismo interruptor que </> Auto de la barra) ---
  box.append(el('div', 'sk-h', '✅ Permisos de ejecución'));
  const permCard = el('div', 'prov-card');
  permCard.innerHTML =
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">` +
    `<input type="checkbox" id="perm-autoedit"> ` +
    `<span>Ejecutar todo automáticamente (escribir/editar ficheros y comandos de terminal), sin pedir confirmación</span>` +
    `</label>` +
    `<p class="muted" style="font-size:.7rem;margin:6px 0 0">terminal.run ya se ejecuta siempre sin preguntar. Esto controla solo la escritura de ficheros (code.write/code.edit) — desmárcalo si prefieres revisar cada cambio antes de aplicarlo.</p>`;
  box.appendChild(permCard);
  const permCheckbox = permCard.querySelector('#perm-autoedit');
  permCheckbox.checked = autoEdit;
  permCheckbox.onchange = () => {
    autoEdit = permCheckbox.checked;
    localStorage.setItem('elffusscode.autoedit', autoEdit ? '1' : '0');
    paintAuto();
  };

  // --- 🎯 Modo Objetivo (planificador + ejecutor, mismo patrón que Auto) ---
  box.append(el('div', 'sk-h', '🎯 Modo Objetivo'));
  const goalCard = el('div', 'prov-card');
  goalCard.innerHTML =
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">` +
    `<input type="checkbox" id="perm-goalmode"> ` +
    `<span>Tratar el próximo mensaje como un objetivo: lo descompone en tareas y las ejecuta una a una</span>` +
    `</label>` +
    `<p class="muted" style="font-size:.7rem;margin:6px 0 0">Igual que el botón 🎯 Goal de la barra — un planificador crea la lista de tareas y un ejecutor las va cumpliendo, marcando cada una como hecha o fallida (si una falla, las siguientes se saltan en vez de seguir a ciegas).</p>`;
  box.appendChild(goalCard);
  const goalCheckbox = goalCard.querySelector('#perm-goalmode');
  goalCheckbox.checked = goalMode;
  goalCheckbox.onchange = () => {
    goalMode = goalCheckbox.checked;
    localStorage.setItem('elffusscode.goalmode', goalMode ? '1' : '0');
    paintGoal();
  };

  // --- 📨 Errores y feedback (opt-in — apagado no sale NADA de tu máquina) ---
  box.append(el('div', 'sk-h', '📨 Errores y feedback'));
  const telCard = el('div', 'prov-card');
  telCard.innerHTML =
    `<label style="display:flex;align-items:center;gap:8px;cursor:pointer">` +
    `<input type="checkbox" id="tel-enabled"> ` +
    `<span>Enviar automáticamente los errores técnicos que ocurran, para poder arreglarlos</span>` +
    `</label>` +
    `<p class="muted" style="font-size:.7rem;margin:6px 0 10px">Apagado por defecto — tu código y el contenido de tus proyectos NUNCA se incluyen, solo el mensaje de error técnico, la pila y datos del navegador.</p>` +
    `<label class="muted" style="font-size:.68rem">O manda algo tú directamente (un fallo que viste, algo que eches en falta…)</label>` +
    `<textarea id="tel-feedback" rows="2" style="width:100%;margin-top:4px;resize:vertical;background:var(--bg2);border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:6px 8px;font:inherit" placeholder="Cuéntanos qué ha pasado o qué te gustaría que hiciera…"></textarea>` +
    `<button id="tel-send" class="prov-use" style="margin-top:6px">Enviar</button>` +
    `<span id="tel-msg" class="muted" style="font-size:.7rem;margin-left:8px"></span>`;
  box.appendChild(telCard);
  const telCheckbox = telCard.querySelector('#tel-enabled');
  telCheckbox.checked = telemetry.isEnabled();
  telCheckbox.onchange = () => telemetry.setEnabled(telCheckbox.checked);
  telCard.querySelector('#tel-send').onclick = async () => {
    const ta = telCard.querySelector('#tel-feedback');
    const msg = telCard.querySelector('#tel-msg');
    const text = ta.value.trim();
    if (!text) { msg.textContent = 'escribe algo primero'; return; }
    const wasEnabled = telemetry.isEnabled();
    if (!wasEnabled) telemetry.setEnabled(true); // el envío manual es explícito, se permite aunque el automático esté apagado
    await telemetry.sendFeedback(text);
    if (!wasEnabled) telemetry.setEnabled(false); // no activa el automático de fondo si no lo pidió
    ta.value = '';
    msg.textContent = '¡enviado, gracias!';
    setTimeout(() => { msg.textContent = ''; }, 4000);
  };

  // --- Proveedores externos (API keys) ---
  box.append(el('div', 'sk-h', 'Proveedores externos (opcional · la clave se queda en tu navegador)'));
  for (const [id, c] of Object.entries(settings.configs())) {
    const card = el('div', 'prov-card' + (c.enabled ? ' on' : ''));
    const head = el('div', 'prov-head');
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = c.enabled;
    const title = el('b', null, c.label);
    const use = el('button', 'prov-use', 'Usar');
    use.hidden = !c.enabled || activeModel === 'ext:' + id;
    use.onclick = () => { changeModel('ext:' + id); renderSettings(); };
    head.append(toggle, title, use);
    const fields = el('div', 'prov-fields' + (c.enabled ? '' : ' hide'));
    const model = document.createElement('input'); model.value = c.model || ''; model.placeholder = 'modelo (p. ej. gpt-4o-mini)';
    const key = document.createElement('input'); key.type = 'password'; key.value = c.apiKey || '';
    key.placeholder = c.kind === 'anthropic' ? 'sk-ant-…' : (id === 'ollama' || id === 'server' ? 'clave (no necesaria)' : 'sk-…');
    fields.append(labeled('Modelo', model), labeled('API key', key));
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
  skBtn.textContent = 'Gestionar skills de Claude Code';
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
  addMsg('sys', `Привіт 👋 Proyecto «${name}» abierto. Pregúntame por el código, pídeme cambios o dime «árbol». Todo se queda en tu máquina.`);
  refreshGit();
  preloadModel(); // por si el arranque en la landing no llegó a dispararse
}

async function boot() {
  // Caché de modelos (persistente + service worker) ANTES de descargar nada,
  // para que hasta la primera descarga de pesos quede cacheada y no se repita.
  ensureModelCache().finally(() => preloadModel());
  bridge.tryAutoConnect(); // reconecta en silencio si ya se conectó antes (mismo token)
  bridge.startAutoDetect(); // sigue sondeando en 2º plano: detecta el bridge si se arranca/reinicia más tarde
  // galaxia en la landing (misma técnica que Elffuss)
  import('./splash-gl.js').then(m => { galaxy = m.startGalaxy($('landing')); }).catch(() => {});

  $('open-project').onclick = async () => {
    try { await enterIDE(await window.showDirectoryPicker({ mode: 'readwrite' })); }
    catch { /* cancelado */ }
  };

  // clonar un repo público (GitHub/Bitbucket): elige carpeta destino, se
  // descarga ahí (fichero a fichero, sin git) y se abre como proyecto.
  // RESUMIBLE: el trabajo (lista de ficheros + cuáles ya se bajaron + el
  // handle de la carpeta) se persiste en IndexedDB — si el usuario navega
  // atrás, cierra la pestaña o recarga a medias, al volver se ofrece
  // «Reanudar» en vez de forzar a empezar de cero.
  const cloneUrl = $('clone-url'), cloneBtn = $('clone-btn'), cloneStatus = $('clone-status');
  const showCloneStatus = (text, isErr) => { cloneStatus.textContent = text; cloneStatus.hidden = !text; cloneStatus.classList.toggle('err', !!isErr); };
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
    if (!url) return;
    let handle;
    try { handle = await window.showDirectoryPicker({ mode: 'readwrite' }); }
    catch { return; } // cancelado, sin error
    showCloneStatus('Listando el repo…');
    try {
      const clone = await import('./tools/clone.js');
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
    banner.querySelector('.rc-text').textContent = `Descarga a medias de ${job.owner}/${job.repo} (${job.done.length}/${job.files.length} ficheros)`;
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
    btn.textContent = `Reabrir «${prev.name}»`;
    btn.onclick = async () => {
      try { await codeTools.regrant(prev.handle); await enterIDE(prev.handle); }
      catch (e) { $('statusbar').textContent = '⚠️ ' + e.message; }
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
  const text = $('prompt').value.trim();
  if (!text) return;
  $('prompt').value = '';
  pushPromptHistory(text);
  send(text);
});
$('model-select').addEventListener('change', e => changeModel(e.target.value));
// móvil: conmutar chat ↔ editor
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
  body.innerHTML = '<div class="view-loading">Construyendo…</div>';
  overlay.hidden = false;
  document.querySelectorAll('#activity button').forEach(b => b.classList.toggle('on', b.id === 'act-' + kind));
  // esperar a que el layout dé tamaño real al overlay (si no, canvas 0×0/mal aspect)
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (seq !== viewRenderSeq) return; // el usuario cambió de vista mientras tanto
  try {
    if (kind === 'arch') { const m = await import('./arch.js'); await m.renderArchitecture(body, p => { closeView(); openFile(p); }); }
    else { const m = await import('./city.js'); await m.renderCity(body, p => { closeView(); openFile(p); }); }
  } catch (e) { body.innerHTML = '<div class="view-loading">No pude construir la vista: ' + (e?.message || e) + '</div>'; }
}
function closeView() {
  $('view-overlay').hidden = true;
  import('./city.js').then(m => m.disposeCity()).catch(() => {});
  import('./arch.js').then(m => m.disposeArch()).catch(() => {});
  document.querySelectorAll('#activity button').forEach(b => b.classList.toggle('on', b.id === 'act-files'));
}
$('act-arch').addEventListener('click', () => openView('arch'));
$('act-city').addEventListener('click', () => openView('city'));
$('view-close').addEventListener('click', closeView);

// ── Cerebro CEO autónomo + Mente de Elffuss ───────────────────────────────
// Cuando NO estás pidiendo nada, la elfa trabaja: revisa el proyecto y propone
// mejoras (en elffuss-mind/, sin tocar tu código). Clic en la elfa → abre la
// «Mente» (mundo trance + pensamientos paralelos + música) y activa el cerebro.
mind.setOpenFile(openFile);
mind.init({ buildCity: buildCityAdapter, loadThoughts: loadThoughtsAdapter });
// «Ejecutar esta propuesta»: la manda a la MISMA cola/agente del chat normal
// (mismas herramientas reales, mismo gate de Auto-edit) — no un auto-apply
// aparte sin supervisión.
mind.setExecuteProposal(md => { mind.closeMind(); send('Implementa esta propuesta de mejora con cambios reales en el código:\n\n' + md); });
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
  provider: () => conv.getProvider(),
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
function executeProposal(md) { send('Implementa esta propuesta de mejora con cambios reales en el código:\n\n' + md); }

export function reportImprovements(ev) {
  const props = ev.proposals || [];
  if (!props.length) return;
  const firstLine = t => (t || '').split('\n').find(l => l.trim())?.trim().slice(0, 160) || '';
  const body = `💡 **Mientras estabas fuera revisé el proyecto y encontré ${props.length} mejora${props.length === 1 ? '' : 's'}:**\n\n` +
    props.map(p => `**${p.dept}** — ${firstLine(p.text)}`).join('\n\n') +
    (ev.path ? `\n\n_Guardado en \`${ev.path}\`. Dale a la elfa para verlo en la Mente, o ábrelo en el editor._` : '');
  const div = addMsg('assistant', body);
  // se guarda en el historial REAL de la conversación activa — si no, el
  // aviso vive solo en el DOM y desaparece al cambiar de pestaña o recargar
  const active = conv.getActive();
  if (active) conv.appendMessage(active.id, 'assistant', body);
  // botón REAL para ejecutar la propuesta desde el propio chat (antes solo
  // se podía desde el panel de la Mente, había que ir a buscarlo)
  const md = ev.md || body;
  if (div) {
    const btn = document.createElement('button');
    btn.className = 'proposal-exec-btn';
    btn.textContent = '▶ Ejecutar esta propuesta';
    btn.onclick = () => { btn.disabled = true; btn.textContent = '▶ enviado a la cola…'; executeProposal(md); };
    div.appendChild(btn);
  }
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
          actions: [{ action: 'execute', title: '▶ Ejecutar' }, { action: 'open', title: 'Ver en la Mente' }],
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
const elfAvatar = document.querySelector('#activity img');
if (elfAvatar) {
  elfAvatar.style.cursor = 'pointer';
  elfAvatar.title = 'Mente de Elffuss — cerebro autónomo';
  elfAvatar.addEventListener('click', () => {
    // auto-activa SOLO la primera vez (nunca decidiste play/stop); si lo
    // pausaste a propósito, abrir la Mente NO debe reactivarlo por sorpresa.
    if (!ceo.isEnabled() && !ceo.hasDecided()) ceo.enable();
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* */ }
    mind.openMind();
  });
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
    const cap = shell.capabilities();
    $('term-caps').textContent = cap.bridge ? '🔌 Bridge local: node/npm/python reales' : 'shell del proyecto · node/npm/python → Bridge local (⚙ Ajustes)';
    await terminal.mount($('terminal-host'));
    terminal.refit();
  }
}
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
  const move = e => { const h = Math.max(120, Math.min(window.innerHeight - 160, sh + (sy - e.clientY))); panel.style.height = h + 'px'; terminal.refit(); };
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
const paintFlip = editor => { $('code-flip').innerHTML = (editor ? UI.chat : UI.editor) + `<span>${editor ? 'Chat' : 'Editor'}</span>`; };
paintFlip(false);

// barra de actividad estilo VS Code
$('act-files').innerHTML = ACTIVITY.files;
$('act-search').innerHTML = ACTIVITY.search;
$('act-settings').innerHTML = ACTIVITY.gear;
$('act-files').addEventListener('click', () => {
  document.body.classList.toggle('hide-tree');
  $('act-files').classList.toggle('on');
});
$('act-search').addEventListener('click', () => {
  $('prompt').value = 'busca ';
  $('prompt').focus();
});
$('act-settings').addEventListener('click', () => $('btn-settings').click());

$('btn-history').addEventListener('click', () => {
  const panel = $('history-panel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) renderHistoryPanel();
});
document.addEventListener('pointerdown', e => {
  const p = $('history-panel');
  if (p.hidden) return;
  if (p.contains(e.target) || e.target.closest('#btn-history')) return;
  p.hidden = true;
}, true);
$('btn-settings').addEventListener('click', () => {
  const p = $('settings-panel');
  p.hidden = !p.hidden;
  if (!p.hidden) renderSettings();
});
// clic fuera del panel (o ir a Archivo/chat) lo cierra — antes solo la X lo hacía
document.addEventListener('pointerdown', e => {
  const p = $('settings-panel');
  if (p.hidden) return;
  if (p.contains(e.target) || e.target.closest('#btn-settings, #act-settings')) return;
  p.hidden = true;
}, true);

// ---------- composer estilo plugin: +, /, medidor de contexto, Auto ----------

// medidor de contexto: chars del historial / presupuesto (~4 chars/token)
// Al máximo del modelo de serie: LFM2.5-1.2B soporta 32K nativo; reservamos
// ~2K de sistema + 2K de generación → 28K para historial.
const CTX_BUDGET_TOK = 28000;
function updateCtxMeter() {
  if (!$('ctx-text')) return; // aún en la landing
  const chars = (conv.getActive()?.agent.history || []).reduce((s, m) => s + (m.content || '').length, 0);
  const tok = Math.round(chars / 4);
  const pct = Math.min(100, Math.round(tok / CTX_BUDGET_TOK * 100));
  const k = n => n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : n;
  $('ctx-text').textContent = `ctx ${k(tok)} / ${k(CTX_BUDGET_TOK)}`;
  $('ctx-bar').style.width = pct + '%';
  $('ctx-bar').className = pct > 85 ? 'hot' : '';
  $('ctx-meter').title = pct > 85
    ? `Contexto casi lleno (${pct}%). Los mensajes viejos se comprimen solos; usa 🧹 para empezar limpio.`
    : `Contexto: ${tok} de ~${CTX_BUDGET_TOK} tokens (${100 - pct}% libre)`;
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
    menu.appendChild(row);
  }
  menu.hidden = false;
}
document.addEventListener('click', e => {
  if (!e.target.closest('#menu, #btn-slash, #btn-plus')) $('menu').hidden = true;
});

// [/] comandos
$('btn-slash').addEventListener('click', () => openMenu([
  { sep: 'Comandos' },
  { label: '/tree', hint: 'árbol del proyecto', run: () => send('árbol') },
  { label: '/search', hint: 'buscar en el código', run: () => { $('prompt').value = 'busca '; $('prompt').focus(); } },
  { label: '/skills', hint: 'gestionar skills', run: () => openSkillsPanel() },
  { label: '/model', hint: 'proveedores y modelo', run: () => $('btn-settings').click() },
  { label: '/clear', hint: 'nueva conversación', run: () => conv.create() },
]));

// [+] adjuntar archivo del proyecto como @ruta
$('btn-plus').addEventListener('click', async () => {
  let tree = '';
  try { tree = await codeTools.tree({ depth: 3 }); } catch { /* sin proyecto */ }
  const files = tree.split('\n').filter(l => l.trim() && !l.includes('📁')).map(l => l.trim()).slice(0, 40);
  const { currentFile } = codeTools.current();
  const items = [{ sep: 'Adjuntar al mensaje (@)' }];
  if (currentFile) items.push({ label: '@' + currentFile, hint: 'archivo abierto', run: () => attach(currentFile) });
  for (const f of files.filter(f => f !== currentFile).slice(0, 20))
    items.push({ label: '@' + f, run: () => attach(f) });
  openMenu(items.length > 1 ? items : [{ sep: 'Abre un proyecto primero' }]);
});
function attach(path) {
  const p = $('prompt');
  p.value = (p.value + ' @' + path).trim() + ' ';
  p.focus();
}

// </> Auto (Edit automatically): si off, pide confirmación antes de escribir
let autoEdit = localStorage.getItem('elffusscode.autoedit') !== '0';
function paintAuto() {
  const b = $('btn-autoedit');
  b.classList.toggle('on', autoEdit);
  b.querySelector('.ae-txt').textContent = autoEdit ? 'Auto' : 'Revisar';
  b.title = autoEdit ? 'Editar archivos automáticamente (clic para revisar antes)' : 'Pedir confirmación antes de escribir (clic para automático)';
}
$('btn-autoedit').addEventListener('click', () => {
  autoEdit = !autoEdit;
  localStorage.setItem('elffusscode.autoedit', autoEdit ? '1' : '0');
  paintAuto();
});
paintAuto();
codeTools.setWriteApprover(async (path, content) => {
  if (autoEdit) return true;
  return confirm(`Elffuss quiere escribir en «${path}» (${content.split('\n').length} líneas).\n\n¿Aplicar el cambio?`);
});

// 🎯 Goal: el siguiente mensaje que mandes se trata como un OBJETIVO — se
// planifica en tareas y se ejecutan una a una (goal.js), en vez del turno de
// chat normal. Mismo patrón (interruptor persistente en localStorage) que
// </> Auto de arriba.
let goalMode = localStorage.getItem('elffusscode.goalmode') === '1';
function paintGoal() {
  $('btn-goal').classList.toggle('on', goalMode);
}
$('btn-goal').addEventListener('click', () => {
  goalMode = !goalMode;
  localStorage.setItem('elffusscode.goalmode', goalMode ? '1' : '0');
  paintGoal();
});
paintGoal();

// resolver @rutas del mensaje: se leen y se adjuntan como contexto
const _send = send;
send = async (text) => {
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
async function openSkillsPanel() {
  const box = $('settings-panel');
  box.hidden = false;
  box.replaceChildren();
  const close = document.createElement('button');
  close.id = 'settings-close'; close.textContent = '✕'; close.onclick = () => { box.hidden = true; };
  box.appendChild(close);

  const wrap = document.createElement('div');
  wrap.className = 'skills-panel';
  wrap.innerHTML = `<h3>🧩 Skills de Claude Code</h3>
    <p class="muted">Instala instrucciones especializadas (formato SKILL.md) desde repos públicos.
    Todo se guarda en tu navegador. Se ve el repo y lo que se inyecta.</p>`;
  box.appendChild(wrap);

  // instaladas
  const inst = skills.installed();
  const instBox = document.createElement('div');
  instBox.innerHTML = `<div class="sk-h">Instaladas (${inst.length})</div>`;
  for (const s of inst) {
    const row = document.createElement('div');
    row.className = 'sk-row';
    row.innerHTML = `<b>${s.name}</b><span class="muted">${s.repo || 'local'}</span>`;
    const rm = document.createElement('button');
    rm.className = 'ghost'; rm.textContent = 'Quitar';
    rm.onclick = async () => { await skills.remove(s.name); openSkillsPanel(); };
    row.appendChild(rm);
    instBox.appendChild(row);
  }
  if (!inst.length) instBox.innerHTML += '<p class="muted">Ninguna todavía.</p>';
  box.appendChild(instBox);

  // fuentes + añadir repo
  const srcs = await skills.sources();
  const srcBox = document.createElement('div');
  srcBox.innerHTML = `<div class="sk-h">Catálogos (repos)</div>`;
  for (const s of srcs) {
    const row = document.createElement('div');
    row.className = 'sk-row';
    row.innerHTML = `<b>${s.label}</b><a href="https://github.com/${s.repo}" target="_blank" rel="noopener">${s.repo} ↗</a>`;
    const browse = document.createElement('button');
    browse.className = 'primary'; browse.textContent = 'Explorar';
    browse.onclick = () => browseRepo(s.repo, box);
    row.appendChild(browse);
    if (!s.official) {
      const rm = document.createElement('button');
      rm.className = 'ghost'; rm.textContent = '🗑';
      rm.onclick = async () => { await skills.removeSource(s.repo); openSkillsPanel(); };
      row.appendChild(rm);
    }
    srcBox.appendChild(row);
  }
  const addRow = document.createElement('div');
  addRow.className = 'sk-row';
  const inp = document.createElement('input');
  inp.placeholder = 'owner/repo o URL de GitHub (p. ej. OpenClaude/…)';
  const add = document.createElement('button');
  add.className = 'primary'; add.textContent = 'Añadir repo';
  add.onclick = async () => {
    try { await skills.addSource(inp.value); openSkillsPanel(); }
    catch (e) { alert(e.message); }
  };
  addRow.append(inp, add);
  srcBox.appendChild(addRow);
  box.appendChild(srcBox);
}

async function browseRepo(repo, box) {
  const list = document.createElement('div');
  list.innerHTML = `<div class="sk-h">Cargando ${repo}…</div>`;
  box.appendChild(list);
  try {
    const found = await skills.listFromRepo(repo);
    list.innerHTML = `<div class="sk-h">${repo} — ${found.length} skills</div>`;
    for (const sk of found.slice(0, 120)) {
      const row = document.createElement('div');
      row.className = 'sk-row';
      row.innerHTML = `<b>${sk.name}</b><span class="muted">${sk.dir}</span>`;
      const btn = document.createElement('button');
      const on = skills.isInstalled(sk.repo, sk.path);
      btn.className = on ? 'ghost' : 'primary';
      btn.textContent = on ? 'Instalada ✓' : 'Instalar';
      btn.onclick = async () => {
        btn.textContent = '…';
        try {
          const entry = await skills.installFromRepo(sk);
          btn.textContent = 'Instalada ✓'; btn.className = 'ghost';
          $('settings-panel').hidden = true;            // cierra el panel
          addMsg('assistant', skills.usageMessage(entry)); // «cómo usarla» en el chat
        } catch (e) { btn.textContent = 'Instalar'; alert(e.message); }
      };
      row.appendChild(btn);
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = `<div class="sk-h">⚠️ ${e.message}</div>`;
  }
}

// ---------- command palette (Cmd/Ctrl+P) ----------
let palItems = [], palSel = 0;
const COMMANDS = [
  { label: 'Nueva conversación', run: () => conv.create() },
  { label: 'Historial de conversaciones', run: () => $('btn-history').click() },
  { label: 'Buscar en el código…', run: () => { closePalette(); $('prompt').value = 'busca '; $('prompt').focus(); } },
  { label: 'Gestionar skills', run: () => { closePalette(); openSkillsPanel(); } },
  { label: 'Ajustes y modelo', run: () => { closePalette(); renderSettings(); } },
  { label: 'Alternar explorador', run: () => $('act-files').click() },
  { label: 'Alternar terminal', hint: 'Ctrl+`', run: () => { closePalette(); toggleTerminal(); } },
  { label: 'Guardar (Ctrl+S)', run: () => triggerEditor('') || (hasEditor() && triggerEditor('workbench.action.files.save')) },
];

function openPalette(prefix = '') {
  $('palette').hidden = false;
  const inp = $('pal-input');
  inp.value = prefix;
  inp.focus();
  renderPalette();
}
function closePalette() { $('palette').hidden = true; }

function fuzzy(q, s) {
  q = q.toLowerCase(); s = s.toLowerCase();
  let i = 0, score = 0, streak = 0;
  for (const ch of s) {
    if (i < q.length && ch === q[i]) { i++; streak++; score += streak; }
    else streak = 0;
  }
  return i === q.length ? score + (s.endsWith(q) ? 20 : 0) : -1;
}

async function renderPalette() {
  const raw = $('pal-input').value;
  const list = $('pal-list');
  list.replaceChildren();
  palItems = [];

  if (raw.startsWith('>')) {                       // comandos
    const q = raw.slice(1).trim().toLowerCase();
    palItems = COMMANDS.filter(c => c.label.toLowerCase().includes(q)).map(c => ({ label: c.label, hint: 'comando', run: c.run }));
  } else if (raw.startsWith('@')) {                // símbolos del archivo abierto (Monaco)
    palItems = [{ label: 'Ir a símbolo en el editor…', hint: '@', run: () => { closePalette(); triggerEditor('editor.action.quickOutline'); } }];
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
  palSel = 0;
  palItems.forEach((it, i) => {
    const row = el('button', 'pal-item' + (i === 0 ? ' sel' : ''));
    row.innerHTML = `<span class="pi-name">${it.label}</span><span class="pi-hint">${it.hint || ''}</span>`;
    row.onmouseenter = () => { palSel = i; paintPalSel(); };
    row.onclick = () => it.run();
    list.appendChild(row);
  });
  if (!palItems.length) list.appendChild(el('div', 'pal-empty', 'Sin resultados'));
}
function paintPalSel() {
  [...$('pal-list').children].forEach((c, i) => c.classList.toggle('sel', i === palSel));
  $('pal-list').children[palSel]?.scrollIntoView({ block: 'nearest' });
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
document.addEventListener('click', e => { if (!e.target.closest('#palette')) closePalette(); });

// ---------- barra de menú File/Edit/View/Git ----------
async function menuFor(which) {
  if (which === 'file') return [
    { label: 'Nuevo archivo…', run: () => { const p = prompt('Ruta del nuevo archivo:'); if (p) codeTools.write({ path: p, content: '' }).then(() => { openFile(p); refreshTree(); }); } },
    { label: 'Guardar', hint: 'Ctrl+S', run: () => triggerEditor('workbench.action.files.save') },
    { label: 'Abrir carpeta…', run: async () => { try { await enterIDE(await window.showDirectoryPicker({ mode: 'readwrite' })); } catch {} } },
  ];
  if (which === 'edit') return [
    { label: 'Buscar en el código', run: () => { $('prompt').value = 'busca '; $('prompt').focus(); } },
    { label: 'Ir a archivo…', hint: 'Cmd+P', run: () => openPalette('') },
    { label: 'Ir a símbolo…', run: () => triggerEditor('editor.action.quickOutline') },
  ];
  if (which === 'view') return [
    { label: 'Explorador', run: () => $('act-files').click() },
    { label: 'Terminal', hint: 'Ctrl+`', run: () => toggleTerminal(true) },
    { label: 'Arquitectura', run: () => openView('arch') },
    { label: 'Ciudad 3D', run: () => openView('city') },
    { label: 'Command Palette', hint: 'Cmd+Shift+P', run: () => openPalette('>') },
    { label: 'Skills', run: () => openSkillsPanel() },
    { label: 'Acerca de Elffuss Code (GitHub)', hint: '↗', run: () => window.open('https://github.com/KikoCis/elffuss-code', '_blank', 'noopener') },
  ];
  if (which === 'git') {
    const g = await codeTools.gitInfo();
    if (!g.isRepo) return [{ label: 'No es un repositorio git', hint: '', run: () => {} }];
    const items = [{ label: 'Rama: ' + g.branch, hint: 'git', run: () => {} }];
    if (g.lastCommit) items.push({ label: 'Último: ' + g.lastCommit.msg.slice(0, 40), hint: g.lastCommit.author, run: () => {} });
    items.push({ label: 'Pídele a Elffuss que commitee', run: () => { $('prompt').value = 'resume los cambios y prepárame el mensaje de commit'; $('prompt').focus(); } });
    return items;
  }
  return [];
}
document.querySelectorAll('#menubar button').forEach(b => {
  b.addEventListener('click', async () => {
    document.querySelectorAll('#menubar button').forEach(x => x.classList.toggle('open', x === b));
    openMenuAt(await menuFor(b.dataset.menu), b);
  });
});
function openMenuAt(items, anchor) {
  const menu = $('topmenu');
  const r = anchor.getBoundingClientRect();
  menu.style.left = r.left + 'px';
  menu.style.top = (r.bottom + 3) + 'px';
  menu.replaceChildren();
  for (const it of items) {
    const row = el('button', 'menu-item');
    row.innerHTML = `<b>${it.label}</b>${it.hint ? `<span>${it.hint}</span>` : ''}`;
    row.onclick = () => { menu.hidden = true; it.run(); };
    menu.appendChild(row);
  }
  menu.hidden = false;
}
document.addEventListener('click', e => {
  if (!e.target.closest('#menubar, #topmenu')) {
    document.querySelectorAll('#menubar button').forEach(x => x.classList.remove('open'));
    $('topmenu').hidden = true;
  }
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

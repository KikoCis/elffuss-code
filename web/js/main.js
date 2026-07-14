// Elffuss Code: landing («abre tu carpeta») → IDE con la elfa integrada.
import { Agent, parseToolCall } from './agent.js';
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

const $ = id => document.getElementById(id);
const agent = new Agent(rules);
let activeModel = 'rules';

// ---------- chat ----------
function addMsg(cls, text) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  // las respuestas se renderizan como markdown (estilo plugin de Claude Code);
  // lo del usuario y los errores, como texto plano
  if (/^(assistant$|sys)/.test(cls)) {
    div.classList.add('md');
    // cap defensivo: no volcar miles de nodos si una respuesta trae un archivo entero
    div.innerHTML = renderMarkdown(text.length > 8000 ? text.slice(0, 8000) + '\n… (recortado)' : text);
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

function thinkingBubble() {
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
      label.textContent = `Elffuss escribe · ${buf.length}`;
      gen.textContent = (buf.length > 200 ? '…' : '') + buf.slice(-200);
      $('chat-log').scrollTop = $('chat-log').scrollHeight;
    },
    tool(name) { buf = ''; gen.textContent = ''; label.textContent = `Elffuss usa ${name}`; },
    remove() { div.remove(); },
  };
}

// Cola persistente (mismo esquema anti-pérdida que Elffuss): el mensaje solo
// sale de la cola cuando su turno TERMINA y el histórico ya está commiteado.
const queue = [];
let pumping = false;
const persistQueue = () => db.set('kv', 'queue', queue.map(q => q.text)).catch(() => {});

function send(text) {
  const el = addMsg('user queued', text);
  queue.push({ text, el });
  persistQueue();
  pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const item = queue[0];
    item.el?.classList.remove('queued');
    const th = thinkingBubble();
    try {
      await agent.handle(item.text, ev => {
        if (ev.type === 'token') th.tick(ev.text);
        if (ev.type === 'text') addMsg('assistant', ev.text);
        if (ev.type === 'tool') { th.tool(ev.call.tool); addTool(ev.call.tool, ev.call.args?.path || ev.call.args?.query || ''); }
        if (ev.type === 'tool_result') addToolResult(ev.result);
        if (ev.type === 'error') addMsg('assistant err', ev.text);
      });
    } finally { th.remove(); }
    await db.set('kv', 'history', agent.history.slice(-60)).catch(() => {});
    await db.set('kv', 'lastDone', item.text).catch(() => {});
    queue.shift();
    await persistQueue();
  }
  pumping = false;
}

// Restaurar conversación y cola al refrescar.
async function restoreHistory() {
  const saved = await db.get('kv', 'history').catch(() => null);
  if (!saved?.length) return;
  agent.history = saved;
  for (const m of saved) {
    if (m.role === 'user') {
      if (m.content.startsWith('[resultado ')) {
        const nl = m.content.indexOf('\n');
        addToolResult(nl > 0 ? m.content.slice(nl + 1) : '');
      } else if (!m.content.startsWith('[…')) {
        addMsg('user', m.content);
      }
    } else {
      const call = parseToolCall(m.content);
      if (call) addTool(call.tool, call.args?.path || call.args?.query || '');
      else addMsg('assistant', m.content);
    }
  }
}

async function restoreQueue() {
  let pending = await db.get('kv', 'queue').catch(() => null);
  if (!pending?.length) return;
  const lastDone = await db.get('kv', 'lastDone').catch(() => null);
  if (lastDone && pending[0] === lastDone) pending = pending.slice(1);
  if (!pending.length) { db.set('kv', 'queue', []).catch(() => {}); return; }
  for (const text of pending) {
    const el = addMsg('user queued', text);
    queue.push({ text, el });
  }
  pump();
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
const defaultBrain = () => !navigator.gpu ? 'onnx' : (isMobile() ? 'litert:gemma-e2b' : 'litert:gemma-e4b');

function modelOptions() {
  const opts = [];
  if (navigator.gpu) opts.push({ id: 'litert:gemma-e4b', label: 'Gemma-4 E4B · LiteRT-LM (~4 GB) ★' });
  if (navigator.gpu) opts.push({ id: 'litert:gemma-e2b', label: 'Gemma-4 E2B · LiteRT-LM (~2 GB)' });
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
    agent.setProvider(rules);
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
    agent.setProvider(mod);
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
    agent.setProvider(rules);
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
    if (m.need === 'gpu' && !navigator.gpu) continue;
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
  addMsg('sys', `Привіт 👋 Proyecto «${name}» abierto. Pregúntame por el código, pídeme cambios o dime «árbol». Todo se queda en tu máquina.`);
  await restoreHistory();
  await restoreQueue();
  refreshGit();
  preloadModel(); // por si el arranque en la landing no llegó a dispararse
}

async function boot() {
  // Caché de modelos (persistente + service worker) ANTES de descargar nada,
  // para que hasta la primera descarga de pesos quede cacheada y no se repita.
  ensureModelCache().finally(() => preloadModel());
  // galaxia en la landing (misma técnica que Elffuss)
  import('./splash-gl.js').then(m => { galaxy = m.startGalaxy($('landing')); }).catch(() => {});

  $('open-project').onclick = async () => {
    try { await enterIDE(await window.showDirectoryPicker({ mode: 'readwrite' })); }
    catch { /* cancelado */ }
  };

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
async function openView(kind) {
  const overlay = $('view-overlay'), body = $('view-body');
  overlay.hidden = false;
  document.querySelectorAll('#activity button').forEach(b => b.classList.toggle('on', b.id === 'act-' + kind));
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
ceo.init({ provider: () => agent.provider, onEvent: (ch, ev) => {
  mind.pushThought(ch, ev);
  if (ch === 'ceo' && ev.type === 'built') reportImprovements(ev);
} });
// Reporta las mejoras encontradas de forma VISUAL en el chat + notificación del navegador.
function reportImprovements(ev) {
  const props = ev.proposals || [];
  if (!props.length) return;
  const firstLine = t => (t || '').split('\n').find(l => l.trim())?.trim().slice(0, 160) || '';
  const body = `💡 **Mientras estabas fuera revisé el proyecto y encontré ${props.length} mejora${props.length === 1 ? '' : 's'}:**\n\n` +
    props.map(p => `**${p.dept}** — ${firstLine(p.text)}`).join('\n\n') +
    (ev.path ? `\n\n_Guardado en \`${ev.path}\`. Dale a la elfa para verlo en la Mente, o ábrelo en el editor._` : '');
  addMsg('assistant', body);
  notify(`Elffuss encontró ${props.length} mejora${props.length === 1 ? '' : 's'}`, props.map(p => p.dept).join(' · '));
}
function notify(title, body) {
  try {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') new Notification(title, { body, icon: 'img/elffuss-code.svg' });
    else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') new Notification(title, { body }); });
  } catch { /* */ }
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
    if (!ceo.isEnabled()) { ceo.enable(); localStorage.setItem('elffusscode.ceo', '1'); }
    try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* */ }
    mind.openMind();
  });
}
// si lo dejaste activado, el cerebro sigue de guardia al volver
if (localStorage.getItem('elffusscode.ceo') === '1') ceo.enable();

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
    $('term-caps').textContent = cap.webcontainers ? 'node/npm reales (WebContainers)' : 'shell del proyecto · node/npm → WebContainers';
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
$('btn-clear').innerHTML = UI.clear;
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

$('btn-clear').addEventListener('click', async () => {
  await db.del('kv', 'history').catch(() => {});
  await db.del('kv', 'queue').catch(() => {});
  agent.history = [];
  location.reload();
});
$('btn-settings').addEventListener('click', () => {
  const p = $('settings-panel');
  p.hidden = !p.hidden;
  if (!p.hidden) renderSettings();
});

// ---------- composer estilo plugin: +, /, medidor de contexto, Auto ----------

// medidor de contexto: chars del historial / presupuesto (~4 chars/token)
// Al máximo del modelo de serie: LFM2.5-1.2B soporta 32K nativo; reservamos
// ~2K de sistema + 2K de generación → 28K para historial.
const CTX_BUDGET_TOK = 28000;
function updateCtxMeter() {
  if (!$('ctx-text')) return; // aún en la landing
  const chars = agent.history.reduce((s, m) => s + (m.content || '').length, 0);
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
  { label: '/clear', hint: 'nueva conversación', run: () => $('btn-clear').click() },
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
  { label: 'Nueva conversación', run: () => $('btn-clear').click() },
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
window.elffussClaw = { agent, send, openFile, parseToolCall, skills };

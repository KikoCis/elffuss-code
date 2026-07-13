// Elffuss Claw: landing («abre tu carpeta») → IDE con la elfa integrada.
import { Agent, parseToolCall } from './agent.js';
import * as rules from './providers/rules.js';
import * as codeTools from './tools/code.js';
import * as db from './db.js';
import * as settings from './settings.js';
import { initEditor, refreshTree, openFile } from './ide.js';
import { ACTIVITY } from './icons.js';
import { renderMarkdown } from './md.js';
import * as skills from './skills.js';

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
    div.innerHTML = renderMarkdown(text);
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
  if (id.startsWith('ext:')) {
    const cfg = settings.get(id.slice(4));
    const mod = await import('./providers/api.js');
    mod.configure(cfg);
    return mod;
  }
  return null;
}

function modelOptions() {
  const opts = [];
  if (navigator.gpu) opts.push({ id: 'litert', label: 'Local · Elffuss Gemma-4 E4B (healed) ★' });
  if (navigator.gpu) opts.push({ id: 'onnx', label: 'Local · LFM2.5 (WebGPU, ligero)' });
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
  if (pct != null) $('model-bar').style.width = pct + '%';
}

let loadingId = null;
async function changeModel(id) {
  if (id === 'rules') {
    agent.setProvider(rules);
    activeModel = 'rules';
    localStorage.setItem('elffussclaw.model', 'rules');
    $('model-dot').className = 'dot off';
    return true;
  }
  if (loadingId === id || activeModel === id) return true; // un solo modelo, una sola carga
  loadingId = id;
  $('model-dot').className = 'dot loading';
  showModelProgress('Preparando el cerebro local…', 4);
  try {
    const mod = await resolveProvider(id);
    await mod.load(p => {
      if (typeof p === 'string') return showModelProgress(p);
      if (p?.status === 'progress' && p.total) {
        const pct = Math.round(p.loaded / p.total * 100);
        showModelProgress(`Descargando el cerebro local · ${pct}% · ${(p.loaded / 1e6 | 0)}/${(p.total / 1e6 | 0)} MB`, pct);
      }
    });
    agent.setProvider(mod);
    activeModel = id;
    localStorage.setItem('elffussclaw.model', id);
    $('model-dot').className = 'dot on';
    showModelProgress(mod.name + ' listo · готово ✳', 100);
    setTimeout(() => showModelProgress(null), 2500);
    $('statusbar').textContent = mod.name + ' listo';
    rebuildSelect();
    return true;
  } catch (e) {
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

// El cerebro empieza a descargarse desde el PRIMER segundo, en segundo plano,
// mientras el usuario elige la carpeta. Solo el modelo local — los externos
// jamás se activan solos.
function preloadModel() {
  const saved = localStorage.getItem('elffussclaw.model');
  if (saved === 'rules') return;
  if (saved && saved !== 'onnx') { changeModel(saved); return; } // externo ya elegido antes
  if (navigator.gpu) changeModel('litert');
}

// ---------- panel ⚙️ (proveedores externos) ----------
function renderSettings() {
  const box = $('settings-panel');
  box.replaceChildren();
  const close = document.createElement('button');
  close.id = 'settings-close';
  close.textContent = '✕';
  close.title = 'cerrar';
  close.onclick = () => { box.hidden = true; };
  box.appendChild(close);
  for (const [id, c] of Object.entries(settings.configs())) {
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('label');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = c.enabled;
    head.append(toggle, document.createTextNode(' ' + c.label));
    const model = document.createElement('input');
    model.value = c.model;
    model.placeholder = 'modelo';
    const key = document.createElement('input');
    key.type = 'password';
    key.value = c.apiKey || '';
    key.placeholder = 'API key';
    const save = () => { settings.update(id, { enabled: toggle.checked, model: model.value.trim(), apiKey: key.value }); rebuildSelect(); };
    toggle.onchange = save;
    model.onchange = save;
    key.onchange = save;
    card.append(head, model, key);
    box.appendChild(card);
  }
}

// ---------- arranque ----------
let galaxy = null;
async function enterIDE(handle) {
  const name = await codeTools.openProject(handle);
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
  preloadModel(); // por si el arranque en la landing no llegó a dispararse
}

async function boot() {
  preloadModel(); // descarga en background desde el primer segundo
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

$('composer').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('prompt').value.trim();
  if (!text) return;
  $('prompt').value = '';
  send(text);
});
$('model-select').addEventListener('change', e => changeModel(e.target.value));
// móvil: conmutar chat ↔ editor
$('code-flip').addEventListener('click', () => {
  const showEditor = !document.body.classList.contains('show-editor');
  document.body.classList.toggle('show-editor', showEditor);
  $('code-flip').textContent = showEditor ? '💬 Chat' : '📝 Editor';
});

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
const CTX_BUDGET_TOK = 6000;
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
let autoEdit = localStorage.getItem('elffussclaw.autoedit') !== '0';
function paintAuto() {
  const b = $('btn-autoedit');
  b.classList.toggle('on', autoEdit);
  b.querySelector('.ae-txt').textContent = autoEdit ? 'Auto' : 'Revisar';
  b.title = autoEdit ? 'Editar archivos automáticamente (clic para revisar antes)' : 'Pedir confirmación antes de escribir (clic para automático)';
}
$('btn-autoedit').addEventListener('click', () => {
  autoEdit = !autoEdit;
  localStorage.setItem('elffussclaw.autoedit', autoEdit ? '1' : '0');
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
        try { await skills.installFromRepo(sk); btn.textContent = 'Instalada ✓'; btn.className = 'ghost'; }
        catch (e) { btn.textContent = 'Instalar'; alert(e.message); }
      };
      row.appendChild(btn);
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = `<div class="sk-h">⚠️ ${e.message}</div>`;
  }
}

rebuildSelect();
skills.initSkills();
boot();
window.elffussClaw = { agent, send, openFile, parseToolCall, skills };

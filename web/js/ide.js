// IDE: Monaco (el editor de VS Code) + árbol de archivos + pestañas.
import * as code from './tools/code.js';
import { fileIcon, folderIcon } from './icons.js';

let editor = null;
let monacoRef = null;
const tabs = [];              // { path, model, dirty }
let active = null;
let onDirtyChange = () => {};

const LANG = {
  js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  jsx: 'javascript', json: 'json', html: 'html', css: 'css', md: 'markdown',
  py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', sh: 'shell', yml: 'yaml', yaml: 'yaml', toml: 'ini',
  svg: 'xml', xml: 'xml', sql: 'sql', txt: 'plaintext',
};
const langOf = p => LANG[p.split('.').pop().toLowerCase()] || 'plaintext';
const $ = id => document.getElementById(id);

export async function initEditor() {
  await new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js';
    s.onload = res;
    document.head.appendChild(s);
  });
  window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' } });
  await new Promise(res => window.require(['vs/editor/editor.main'], res));
  monacoRef = window.monaco;
  editor = monacoRef.editor.create($('editor'), {
    theme: 'vs-dark',
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: false },
    padding: { top: 8 },
  });
  editor.addCommand(monacoRef.KeyMod.CtrlCmd | monacoRef.KeyCode.KeyS, saveActive);
  editor.onDidChangeModelContent(() => {
    const tab = tabs.find(t => t.path === active);
    if (tab && !tab.dirty) { tab.dirty = true; renderTabs(); }
  });
  // los cambios del agente se reflejan al instante en el editor
  code.setOnFileWritten((path, content) => {
    const tab = tabs.find(t => t.path === path);
    if (tab && tab.model.getValue() !== content) {
      tab.model.setValue(content);
      tab.dirty = false;
      renderTabs();
    }
    refreshTree();
  });
}

export function gotoLine(n) {
  if (!editor || !n) return;
  editor.revealLineInCenter(n);
  editor.setPosition({ lineNumber: n, column: 1 });
  editor.focus();
}
export function triggerEditor(actionId) {
  editor?.getAction(actionId)?.run();
  editor?.focus();
}
export function hasEditor() { return !!editor; }

export async function openFile(path) {
  let tab = tabs.find(t => t.path === path);
  if (!tab) {
    let content;
    try { content = await code.read({ path }); }
    catch (e) { return alertBar('No pude abrir ' + path + ': ' + e.message); }
    tab = { path, model: monacoRef.editor.createModel(content, langOf(path)), dirty: false };
    tabs.push(tab);
  }
  active = path;
  code.setCurrentFile(path);
  editor.setModel(tab.model);
  renderTabs();
}

async function saveActive() {
  const tab = tabs.find(t => t.path === active);
  if (!tab) return;
  await code.write({ path: tab.path, content: tab.model.getValue() });
  tab.dirty = false;
  renderTabs();
  alertBar('💾 ' + tab.path + ' guardado');
}

function closeTab(path) {
  const i = tabs.findIndex(t => t.path === path);
  if (i < 0) return;
  tabs[i].model.dispose();
  tabs.splice(i, 1);
  if (active === path) {
    active = tabs[i - 1]?.path || tabs[0]?.path || null;
    code.setCurrentFile(active);
    if (active) editor.setModel(tabs.find(t => t.path === active).model);
    else editor.setModel(monacoRef.editor.createModel('', 'plaintext'));
  }
  renderTabs();
}

function renderTabs() {
  const bar = $('tabs-bar');
  bar.replaceChildren();
  for (const t of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.path === active ? ' active' : '');
    const ico = document.createElement('span');
    ico.className = 'tab-ico';
    ico.innerHTML = fileIcon(t.path.split('/').pop());
    const name = document.createElement('span');
    name.textContent = t.path.split('/').pop();
    name.title = t.path;
    // como VS Code: punto ● si hay cambios sin guardar; × al pasar el ratón
    const x = document.createElement('b');
    x.className = t.dirty ? 'dirty' : '';
    x.textContent = t.dirty ? '●' : '×';
    x.onclick = e => { e.stopPropagation(); closeTab(t.path); };
    el.append(ico, name, x);
    el.onclick = () => openFile(t.path);
    bar.appendChild(el);
  }
}

let alertTimer;
function alertBar(msg) {
  const el = $('statusbar');
  el.textContent = msg;
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => { el.textContent = ''; }, 4000);
}

// ---------- árbol lateral ----------
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.next', 'venv', '.venv', '.DS_Store']);

export async function refreshTree(handle = null) {
  const rootHandle = handle || window.__elffussProject;
  if (!rootHandle) return;
  window.__elffussProject = rootHandle;
  const cont = $('tree');
  cont.replaceChildren(await renderDir(rootHandle, ''));
}

async function renderDir(dir, prefix) {
  const ul = document.createElement('ul');
  const entries = [];
  for await (const e of dir.values()) if (!IGNORE.has(e.name)) entries.push(e);
  entries.sort((a, b) => (a.kind !== b.kind) ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
  for (const e of entries.slice(0, 200)) {
    const li = document.createElement('li');
    const p = prefix ? prefix + '/' + e.name : e.name;
    if (e.kind === 'directory') {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.innerHTML = folderIcon();
      sum.appendChild(document.createTextNode(e.name));
      det.appendChild(sum);
      det.addEventListener('toggle', async () => {
        if (det.open && det.children.length === 1)
          det.appendChild(await renderDir(e, p));
      }, { once: false });
      li.appendChild(det);
    } else {
      const a = document.createElement('span');
      a.className = 'file';
      a.innerHTML = fileIcon(e.name);
      a.appendChild(document.createTextNode(e.name));
      a.onclick = () => openFile(p);
      li.appendChild(a);
    }
    ul.appendChild(li);
  }
  return ul;
}

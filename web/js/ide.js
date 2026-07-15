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
    catch (e) {
      // la ruta exacta no existe (típico: un enlace del chat solo mencionaba
      // el NOMBRE, «config.py», y el fichero real vive en una subcarpeta) →
      // si hay una única coincidencia por nombre en el proyecto, ábrela ella
      // en vez de rendirte; con varias o ninguna, el error de siempre.
      const base = path.split('/').pop();
      const hits = await code.findByName?.(base, 2).catch(() => []) || [];
      if (hits.length === 1 && hits[0] !== path) return openFile(hits[0]);
      return alertBar('No pude abrir ' + path + ': ' + e.message);
    }
    tab = { path, model: monacoRef.editor.createModel(content, langOf(path)), dirty: false };
    tabs.push(tab);
  }
  active = path;
  code.setCurrentFile(path);
  editor.setModel(tab.model);
  setEmptyState(false);
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
    if (active) { editor.setModel(tabs.find(t => t.path === active).model); setEmptyState(false); }
    else { editor.setModel(monacoRef.editor.createModel('', 'plaintext')); setEmptyState(true); }
  }
  renderTabs();
}

// Estado vacío: cuando no hay ningún fichero abierto, en vez de dejar el Monaco
// en blanco con un «1», mostramos un placeholder limpio.
export function setEmptyState(on) {
  let el = document.getElementById('editor-empty');
  if (!el) {
    el = document.createElement('div');
    el.id = 'editor-empty';
    el.innerHTML = '<img src="img/elffuss-code.svg" alt=""><p>Abre un fichero del explorador,<br>o pídele algo a la elfa.</p>';
    $('editor').parentElement.appendChild(el);
  }
  el.style.display = on ? 'flex' : 'none';
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
  setupTreeMenu();
}

// ---------- menú contextual del árbol (botón derecho, estilo VS Code) ----------
let treeMenuWired = false;
function setupTreeMenu() {
  if (treeMenuWired) return;
  treeMenuWired = true;
  const tree = $('tree');
  tree.addEventListener('contextmenu', e => {
    e.preventDefault();
    const node = e.target.closest('[data-path]');
    const path = node ? node.dataset.path : '';
    const kind = node ? node.dataset.kind : 'directory'; // vacío = raíz
    openTreeMenu(e.clientX, e.clientY, path, kind);
  });
}

// resuelve el handle de un directorio por su ruta (segmentos desde la raíz)
async function dirByPath(path) {
  let dir = code.handle();
  for (const s of (path || '').split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(s);
  return dir;
}
const parentOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
const baseOf = p => p.split('/').pop();

async function fsCreate(parentPath, name, isDir) {
  const dir = await dirByPath(parentPath);
  if (isDir) await dir.getDirectoryHandle(name, { create: true });
  else { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.close(); }
}
async function fsDelete(path, kind) {
  const dir = await dirByPath(parentOf(path));
  await dir.removeEntry(baseOf(path), { recursive: kind === 'directory' });
}
// copia recursiva (la File System API no tiene rename nativo)
async function fsCopy(srcDir, name, dstDir, newName) {
  const src = await (srcDir.getDirectoryHandle(name).catch(() => null));
  if (src) { // directorio
    const nd = await dstDir.getDirectoryHandle(newName, { create: true });
    for await (const e of src.values()) await fsCopy(src, e.name, nd, e.name);
  } else { // fichero
    const text = await (await (await srcDir.getFileHandle(name)).getFile()).text();
    const fh = await dstDir.getFileHandle(newName, { create: true });
    const w = await fh.createWritable(); await w.write(text); await w.close();
  }
}
async function fsRename(path, kind, newName) {
  const parent = await dirByPath(parentOf(path));
  await fsCopy(parent, baseOf(path), parent, newName);
  await parent.removeEntry(baseOf(path), { recursive: kind === 'directory' });
}

function openTreeMenu(x, y, path, kind) {
  document.getElementById('tree-menu')?.remove();
  const menu = document.createElement('div');
  menu.id = 'tree-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200`;
  // en un fichero, el "aquí dentro" es su carpeta; en carpeta/raíz, ella misma
  const container = kind === 'file' ? parentOf(path) : path;
  const items = [];
  items.push(['Nuevo archivo…', async () => {
    const name = prompt('Nombre del nuevo archivo:'); if (!name) return;
    await fsCreate(container, name.trim(), false); code.invalidateFileList?.();
    await refreshTree(); openFile(container ? container + '/' + name.trim() : name.trim());
  }]);
  items.push(['Nueva carpeta…', async () => {
    const name = prompt('Nombre de la nueva carpeta:'); if (!name) return;
    await fsCreate(container, name.trim(), true); code.invalidateFileList?.(); await refreshTree();
  }]);
  if (path) {
    if (kind === 'file') items.push(['Abrir', () => openFile(path)]);
    items.push(['Renombrar…', async () => {
      const name = prompt('Nuevo nombre:', baseOf(path)); if (!name || name === baseOf(path)) return;
      await fsRename(path, kind, name.trim()); code.invalidateFileList?.(); await refreshTree();
    }]);
    items.push(['Eliminar', async () => {
      if (!confirm(`¿Eliminar «${baseOf(path)}»?`)) return;
      await fsDelete(path, kind); code.invalidateFileList?.(); await refreshTree();
    }, 'danger']);
  }
  for (const [label, fn, cls] of items) {
    const b = document.createElement('button');
    b.className = 'tm-item' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.onclick = async () => { menu.remove(); try { await fn(); } catch (err) { alert('No se pudo: ' + err.message); } };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const close = ev => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', close); } };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
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
      sum.dataset.path = p; sum.dataset.kind = 'directory';
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
      a.dataset.path = p; a.dataset.kind = 'file';
      a.onclick = () => openFile(p);
      li.appendChild(a);
    }
    ul.appendChild(li);
  }
  return ul;
}

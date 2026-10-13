// IDE: Monaco (el editor de VS Code) + árbol de archivos + pestañas.
import * as code from './tools/code.js';
import * as db from './db.js';
import { fileIcon, folderIcon } from './icons.js';
import { renderMarkdown } from './md.js';
import { t } from './i18n.js';

let editor = null;
let monacoRef = null;
let ext = null;               // extensiones de VS Code (js/ext/host.js), ver loadExt()
const tabs = [];              // { path, model, dirty, preview }
let active = null;
let onDirtyChange = () => {};

const LANG = {
  js: 'javascript', mjs: 'javascript', ts: 'typescript', tsx: 'typescript',
  jsx: 'javascript', json: 'json', html: 'html', css: 'css', md: 'markdown',
  py: 'python', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', sh: 'shell', yml: 'yaml', yaml: 'yaml', toml: 'ini',
  svg: 'xml', xml: 'xml', sql: 'sql', txt: 'plaintext',
};
// las extensiones instaladas mandan (p. ej. .toml → toml en vez de ini)
const porNombre = p => ext?.languageForPath(p) || LANG[p.split('.').pop().toLowerCase()] || null;
const langOf = p => porNombre(p) || 'plaintext';
// …y, como en VS Code, la primera línea (firstLine de una extensión) solo
// cuenta si nadie reclama el fichero por su nombre. Va en un Worker con tiempo
// tope: una expresión de un paquete puede no terminar nunca.
const langDe = async (p, primeraLinea) => porNombre(p) || (ext && primeraLinea ? await ext.languageForFirstLine(primeraLinea) : null) || 'plaintext';
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
  ext = await loadExt(false);
  editor = monacoRef.editor.create($('editor'), {
    theme: ext ? ext.themeId() : 'vs-dark',
    automaticLayout: true,
    fontSize: 13,
    minimap: { enabled: false },
    padding: { top: 8 },
  });
  // Al arrancar no hay ningún fichero abierto, y Monaco enseña su documento
  // vacío con un «1» suelto. El aviso de «sin ficheros» solo se ponía al CERRAR
  // la última pestaña, nunca al empezar. Abrir un fichero lo quita (openFile).
  if (!tabs.length) setEmptyState(true);
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
      if (path === active) applyView();
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
  // El foco va ANTES de lanzar la acción, no después. Muchas acciones de Monaco
  // abren un widget que toma el foco (quickOutline, por ejemplo), así que un
  // `focus()` posterior se lo quitaba y lo cerraba al instante: «Go to symbol»
  // no hacía nada visible. Y además varias acciones necesitan que el editor
  // tenga el foco para ejecutarse, cosa que no pasa si vienes de pulsar un
  // item de menú.
  editor?.focus();
  editor?.getAction(actionId)?.run();
}
export function hasEditor() { return !!editor; }
// Llevar el foco al editor (p. ej. tras «Abrir en el editor» desde la Mente).
export function focusEditor() { try { editor?.focus(); } catch { /* sin editor */ } }
// La ruta del fichero activo (o null): el menú la usa para no lanzar acciones
// del editor que no hacen nada sin un fichero abierto.
export function activeFile() { return active; }
// Las pestañas abiertas y su lenguaje, y el lenguaje que tendría una ruta: el
// panel de extensiones los usa para decir qué ficheros ya se ven distintos.
export function openTabs() {
  return tabs.filter(t => !t.model.isDisposed()).map(t => ({ path: t.path, language: t.model.getLanguageId(), active: t.path === active }));
}
export const languageOfPath = p => langOf(p);

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
      return alertBar(t('openFailed', { path, e: e.message }));
    }
    const lang = await langDe(path, content.slice(0, 500).split('\n')[0]);
    await ext?.prepareLanguage(lang);       // la gramática, antes de que exista el modelo
    tab = tabs.find(t => t.path === path);  // otra llamada pudo abrirla mientras tanto
    if (!tab) {
      tab = { path, model: monacoRef.editor.createModel(content, lang), dirty: false, preview: false };
      tabs.push(tab);
    }
  }
  active = path;
  code.setCurrentFile(path);
  editor.setModel(tab.model);
  setEmptyState(false);
  renderTabs();
  await applyView();
}

// modo «Vista previa» de un tab .md/.html: en vez del código fuente en
// Monaco, muestra el markdown renderizado (mismo motor que el chat y la
// Mente) o el HTML en un iframe real.
const PREVIEWABLE = new Set(['markdown', 'html']);

// resuelve una ruta relativa (href/src) contra la carpeta del propio fichero
function resolveRelative(ownPath, rel) {
  if (/^([a-z][\w+.-]*:)?\/\//i.test(rel) || rel.startsWith('data:') || rel.startsWith('#')) return null; // externa/absoluta: no tocar
  const baseDir = ownPath.includes('/') ? ownPath.slice(0, ownPath.lastIndexOf('/')) : '';
  const segs = (baseDir ? baseDir.split('/') : []).concat(rel.split('/'));
  const out = [];
  for (const s of segs) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
  return out.join('/');
}
// un iframe con srcdoc no tiene base URL propia: <link href="style.css"> o
// <script src="app.js"> del proyecto real NUNCA se resuelven (por eso salía
// sin CSS) — se leen del proyecto de verdad y se incrustan antes de mostrarlo.
// El iframe de Vista previa va con sandbox="allow-scripts" A PROPÓSITO, SIN
// allow-same-origin (aislado de tu proyecto real — ver applyView). Pero eso
// hace que referenciar `localStorage`/`sessionStorage` LANCE una excepción
// síncrona — y como suele ser la primera línea de un script (guardar datos
// es de lo más común), el resto del fichero entero se queda sin ejecutar,
// sin aviso: los botones no hacen nada y parece que la app está rota. Se
// incrusta un shim en memoria (nunca toca almacenamiento real, se pierde al
// cerrar la vista previa) SOLO si de verdad hace falta — si el sandbox
// permitiera acceso real, no se toca nada.
const STORAGE_SHIM = `<script>(()=>{try{window.localStorage;return}catch(e){}` +
  `const m=()=>{const d=new Map();return{getItem:k=>d.has(''+k)?d.get(''+k):null,` +
  `setItem:(k,v)=>{d.set(''+k,''+v)},removeItem:k=>{d.delete(''+k)},clear:()=>{d.clear()},` +
  `key:i=>[...d.keys()][i]??null,get length(){return d.size}}};` +
  `for(const p of ['localStorage','sessionStorage'])` +
  `try{Object.defineProperty(window,p,{value:m(),configurable:true})}catch(e){}})()<\/script>`;

async function inlineLocalAssets(html, ownPath) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  (doc.head || doc.documentElement).insertAdjacentHTML('afterbegin', STORAGE_SHIM);
  for (const link of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const path = resolveRelative(ownPath, link.getAttribute('href'));
    if (!path) continue;
    try {
      const style = doc.createElement('style');
      style.textContent = await code.read({ path });
      link.replaceWith(style);
    } catch { /* no se pudo leer: se deja el link (el navegador lo ignorará sin más) */ }
  }
  for (const script of doc.querySelectorAll('script[src]')) {
    const path = resolveRelative(ownPath, script.getAttribute('src'));
    if (!path) continue;
    try {
      const inline = doc.createElement('script');
      if (script.type) inline.type = script.type;
      inline.textContent = await code.read({ path });
      script.replaceWith(inline);
    } catch { /* deja el script tal cual */ }
  }
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

async function applyView() {
  const tab = tabs.find(t => t.path === active);
  const lang = tab ? langOf(tab.path) : null;
  const showPreview = !!(tab && tab.preview && PREVIEWABLE.has(lang));
  $('editor').style.display = showPreview ? 'none' : '';
  let pane = document.getElementById('md-preview-pane');
  if (showPreview) {
    if (!pane) {
      pane = document.createElement('div');
      pane.id = 'md-preview-pane';
      $('editor').parentElement.appendChild(pane);
    }
    pane.classList.toggle('html-preview', lang === 'html');
    if (lang === 'html') {
      pane.replaceChildren();
      const frame = document.createElement('iframe');
      frame.sandbox = 'allow-scripts'; // sin allow-same-origin: aislado de tu proyecto real
      frame.srcdoc = await inlineLocalAssets(tab.model.getValue(), tab.path);
      pane.appendChild(frame);
    } else {
      pane.innerHTML = renderMarkdown(tab.model.getValue());
    }
    pane.style.display = '';
  } else if (pane) {
    pane.style.display = 'none';
  }
}
async function togglePreview(path) {
  // el fichero puede no tener pestaña abierta todavía (p.ej. desde el menú
  // del EXPLORADOR, no el de una pestaña ya abierta) — se abre primero.
  if (active !== path || !tabs.find(t => t.path === path)) await openFile(path);
  const tab = tabs.find(t => t.path === path);
  if (!tab) return; // openFile no pudo (fichero borrado, etc.)
  tab.preview = !tab.preview;
  renderTabs();
  await applyView();
}

// Guardar lo que TÚ has escrito va directo al fichero, no por code.write: esa
// es la vía del agente, con su aprobación («Elffuss quiere escribir…», que
// salía al guardar tu propio fichero con Auto apagado) y sus guardas contra
// reescrituras que recortan medio fichero, que bloqueaban un guardado tuyo
// legítimo sin decir nada.
async function writeOwn(path, content) {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop();
  let dir = code.handle();
  for (const s of parts) dir = await dir.getDirectoryHandle(s, { create: true });
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(content);
  await w.close();
  code.invalidateFileList?.();
}
async function saveTab(tab) {
  const recreado = !!tab.deleted;
  try {
    await writeOwn(tab.path, tab.model.getValue());
  } catch (e) {
    alertBar(t('saveFailed', { path: tab.path, e: e?.message || e }));
    return false;
  }
  tab.dirty = false;
  tab.deleted = false;
  renderTabs();
  // Guardar una pestaña cuyo fichero se había borrado lo vuelve a crear, y el
  // explorador tiene que enseñarlo: writeOwn no pasa por code.write, que era
  // quien avisaba al árbol (onFileWritten → refreshTree).
  if (recreado) await refreshTree();
  alertBar(t('saved', { path: tab.path }));
  return true;
}
// Exportada: la usan el menú File › Guardar y la paleta. Antes ellos lanzaban
// la acción 'workbench.action.files.save', que no existe en el Monaco suelto,
// y no pasaba nada.
export async function saveActive() {
  const tab = tabs.find(t => t.path === active);
  if (!tab) { alertBar(t('noFileOpen')); return false; }
  return saveTab(tab);
}

// Cerrar una pestaña con cambios sin guardar PREGUNTA: Guardar, No guardar o
// Cancelar. Antes se cerraba y los cambios se perdían sin aviso.
function askDirty(tab) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.id = 'dirty-dialog';
    dlg.setAttribute('aria-labelledby', 'dirty-title');
    const h = document.createElement('p'); h.id = 'dirty-title'; h.className = 'dd-title';
    h.textContent = t('dirtyTitle', { name: baseOf(tab.path) });
    const sub = document.createElement('p'); sub.className = 'dd-sub'; sub.textContent = t('dirtyBody');
    const row = document.createElement('div'); row.className = 'dd-row';
    let answer = 'cancel';
    const mk = (label, val, cls) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.val = val;
      if (cls) b.className = cls;
      b.onclick = () => { answer = val; dlg.close(); };
      row.appendChild(b); return b;
    };
    const save = mk(t('dirtySave'), 'save', 'dd-primary');
    mk(t('dirtyDiscard'), 'discard');
    mk(t('dirtyCancel'), 'cancel');
    dlg.append(h, sub, row);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); }, { once: true });
    document.body.appendChild(dlg);
    dlg.showModal();
    save.focus();
  });
}

// Devuelve false si el usuario canceló (la pestaña sigue abierta).
async function closeTab(path) {
  const i = tabs.findIndex(t => t.path === path);
  if (i < 0) return true;
  if (tabs[i].dirty) {
    const r = await askDirty(tabs[i]);
    if (r === 'cancel') return false;
    if (r === 'save' && !(await saveTab(tabs[i]))) return false;
  }
  const j = tabs.findIndex(t => t.path === path);   // el diálogo es asíncrono
  if (j < 0) return true;
  closeTabNow(j);
  renderTabs();
  await applyView();
  return true;
}
// Cerrar desde la barra de pestañas (Supr, Cmd/Ctrl+W, la ✕, o «No guardar» en
// el diálogo): el foco va a la pestaña que queda activa, o al aviso de «sin
// ficheros abiertos» si no queda ninguna. Antes caía a <body> (las pestañas de
// conversación ya lo hacían bien; las del editor no).
async function closeTabYEnfoca(path) {
  if (!(await closeTab(path))) return false;     // cancelado: el diálogo devuelve el foco a la pestaña
  const activa = $('tabs-bar')?.querySelector('.tab.active');
  if (activa) activa.focus();
  else {
    const vacio = document.getElementById('editor-empty');
    if (vacio) { vacio.tabIndex = -1; vacio.focus(); } else editor?.focus();
  }
  return true;
}
// Varias seguidas («Cerrar otras/todas»): se para en la primera que cancelas.
async function closeTabs(paths) {
  for (const p of paths) if (!(await closeTab(p))) return false;
  return true;
}

function closeTabNow(i) {
  const path = tabs[i].path;
  tabs[i].model.dispose();
  tabs.splice(i, 1);
  if (active === path) {
    active = tabs[i - 1]?.path || tabs[0]?.path || null;
    code.setCurrentFile(active);
    if (active) { editor.setModel(tabs.find(t => t.path === active).model); setEmptyState(false); }
    else { editor.setModel(monacoRef.editor.createModel('', 'plaintext')); setEmptyState(true); }
  }
}

// Estado vacío: cuando no hay ningún fichero abierto, en vez de dejar el Monaco
// en blanco con un «1», mostramos un placeholder limpio.
export function setEmptyState(on) {
  let el = document.getElementById('editor-empty');
  if (!el) {
    el = document.createElement('div');
    el.id = 'editor-empty';
    el.innerHTML = '<img src="img/elffuss-code.svg" alt=""><p></p>';
    el.querySelector('p').textContent = t('editorEmpty');
    $('editor').parentElement.appendChild(el);
  }
  el.style.display = on ? 'flex' : 'none';
}

function renderTabs() {
  const bar = $('tabs-bar');
  bar.replaceChildren();
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', t('editorTabs'));
  for (const tb of tabs) {
    const el = document.createElement('div');
    const on = tb.path === active;
    el.className = 'tab' + (on ? ' active' : '') + (tb.preview ? ' tab-preview' : '');
    el.dataset.path = tb.path;
    // Pestañas de verdad para el teclado y los lectores de pantalla: antes eran
    // <div> sin foco. La activa entra con Tab; ←/→ se mueven entre ellas.
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', on ? 'true' : 'false');
    // Nombre propio: sin él, el de la pestaña era el fichero MÁS el botón × que
    // lleva dentro («app.js Cerrar app.js»).
    el.setAttribute('aria-label', baseOf(tb.path) + (tb.dirty ? ' ' + t('tabUnsaved') : '') + (tb.deleted ? ' — ' + t('fileDeletedDirty') : ''));
    el.tabIndex = on ? 0 : -1;
    const ico = document.createElement('span');
    ico.className = 'tab-ico';
    ico.innerHTML = fileIcon(tb.path.split('/').pop());
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = tb.path.split('/').pop();
    name.title = tb.deleted ? tb.path + ' · ' + t('fileDeletedDirty') : tb.path;
    if (tb.deleted) name.classList.add('deleted');
    // como VS Code: punto ● si hay cambios sin guardar; × al pasar el ratón.
    // Un <button> con nombre accesible (antes un <b> que no recibía el foco).
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tab-x' + (tb.dirty ? ' dirty' : '');
    x.textContent = tb.dirty ? '●' : '×';
    x.tabIndex = -1;
    x.setAttribute('aria-label', t(tb.dirty ? 'closeFileDirty' : 'closeFile', { name: baseOf(tb.path) }));
    x.title = x.getAttribute('aria-label');
    x.onclick = e => { e.stopPropagation(); closeTabYEnfoca(tb.path); };
    el.append(ico, name, x);
    el.onclick = () => openFile(tb.path);
    el.oncontextmenu = e => { e.preventDefault(); openTabMenu(e.clientX, e.clientY, tb.path); };
    el.onkeydown = e => {
      const i = tabs.indexOf(tb);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        if (next) openFile(next.path).then(() => bar.querySelector('.tab.active')?.focus());
      } else if (e.key === 'Delete' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w')) {
        e.preventDefault(); closeTabYEnfoca(tb.path);
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault(); const r = el.getBoundingClientRect(); openTabMenu(r.left, r.bottom, tb.path);
      }
    };
    bar.appendChild(el);
  }
  markActive();
}

// ---------- menús contextuales (pestañas y árbol): teclado y Escape ----------
// Escape los cierra y el foco vuelve a donde estaba; ↑/↓ recorren las opciones.
function wireMenu(menu, returnFocus) {
  menu.setAttribute('role', 'menu');
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')];
  const close = () => { menu.remove(); document.removeEventListener('mousedown', outside); returnFocus?.focus?.(); };
  const outside = ev => { if (!menu.contains(ev.target)) close(); };
  menu.addEventListener('keydown', e => {
    const list = items(), i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
  });
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  // dentro de la ventana aunque se abra pegado al borde
  const r = menu.getBoundingClientRect();
  if (r.right > innerWidth) menu.style.left = Math.max(4, innerWidth - r.width - 4) + 'px';
  if (r.bottom > innerHeight) menu.style.top = Math.max(4, innerHeight - r.height - 4) + 'px';
  items()[0]?.focus();
  return close;
}
function menuButton(label, fn, cls) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tm-item' + (cls ? ' ' + cls : '');
  b.setAttribute('role', 'menuitem');
  b.textContent = label;
  b.dataset.run = '1';
  b._run = fn;
  return b;
}

// ---------- menú contextual de las pestañas (botón derecho, estilo VS Code) ----------
function openTabMenu(x, y, path) {
  document.getElementById('tab-menu')?.remove();
  const volver = document.activeElement;
  const menu = document.createElement('div');
  menu.id = 'tab-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200`;
  const i = tabs.findIndex(tb => tb.path === path);
  const tab = tabs[i];
  const items = [];
  items.push([t('tmClose'), () => closeTab(path)]);
  items.push([t('tmCloseOthers'), () => closeTabs(tabs.filter(tb => tb.path !== path).map(tb => tb.path))]);
  const toTheRight = tabs.slice(i + 1).map(tb => tb.path);
  if (toTheRight.length) items.push([t('tmCloseRight'), () => closeTabs(toTheRight)]);
  items.push([t('tmCloseAll'), () => closeTabs(tabs.map(tb => tb.path))]);
  items.push(['sep']);
  items.push([t('tmCopyPath'), () => copyPath(path)]);
  if (PREVIEWABLE.has(langOf(path))) {
    items.push([tab?.preview ? t('tmViewSource') : t('tmPreview'), () => togglePreview(path)]);
  }
  let close = () => menu.remove();
  for (const item of items) {
    if (item[0] === 'sep') { menu.appendChild(Object.assign(document.createElement('div'), { className: 'tm-sep', role: 'separator' })); continue; }
    const [label, fn] = item;
    const b = menuButton(label, fn);
    b.onclick = () => { close(); fn(); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  close = wireMenu(menu, volver);
}

// Copiar ruta: antes copiaba sin decir nada.
function copyPath(path) {
  const done = () => alertBar(t('pathCopied', { path }));
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(path).then(done, () => alertBar(t('pathCopyFailed')));
  else alertBar(t('pathCopyFailed'));
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

// Carpetas abiertas, por ruta. refreshTree() reconstruye el árbol entero (cada
// escritura del agente, cada orden del terminal que toca ficheros, crear,
// renombrar o borrar) y antes lo dejaba TODO plegado: perdías el sitio tras
// cada edición. Ahora se vuelven a abrir las que lo estaban.
const openDirs = new Set();

export async function refreshTree(handle = null) {
  const rootHandle = handle || window.__elffussProject;
  if (!rootHandle) return;
  if (handle) openDirs.clear();               // otro proyecto: empieza plegado
  window.__elffussProject = rootHandle;
  const cont = $('tree');
  const scroll = cont.scrollTop;
  const conFoco = cont.contains(document.activeElement) ? document.activeElement.dataset?.path : null;
  const ul = await renderDir(rootHandle, '');
  ul.setAttribute('role', 'tree');
  ul.setAttribute('aria-label', t('explorer'));
  cont.replaceChildren(ul);
  cont.scrollTop = scroll;
  markActive();
  if (conFoco != null) {
    const f = cont.querySelector(`[data-path="${CSS.escape(conFoco)}"]`);
    if (f) { setRoving(f); f.focus(); }
  }
  setupTreeMenu();
}

// El fichero abierto se marca en el árbol (antes no había forma de saber cuál
// era), y es la fila por la que entra el foco con Tab.
function markActive() {
  const cont = $('tree');
  if (!cont) return;
  let fila = null;
  for (const f of cont.querySelectorAll('.file')) {
    const on = f.dataset.path === active;
    f.classList.toggle('active', on);
    f.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) fila = f;
  }
  if (!cont.querySelector('[tabindex="0"]') || fila) setRoving(fila || cont.querySelector('summary, .file'));
}
function setRoving(row) {
  if (!row) return;
  for (const r of $('tree').querySelectorAll('[tabindex="0"]')) if (r !== row) r.tabIndex = -1;
  row.tabIndex = 0;
}
const visibleRows = () => [...$('tree').querySelectorAll('summary, .file')].filter(r => r.offsetParent !== null);

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
  // Teclado, como un árbol de verdad: ↑/↓ entre filas visibles, → abre una
  // carpeta, ← la cierra (o sube a la carpeta madre), Enter abre el fichero,
  // Shift+F10 o la tecla de menú abren el menú contextual. Antes las filas de
  // fichero eran <span> sin foco y el árbol solo se usaba con el ratón.
  tree.addEventListener('keydown', e => {
    const row = e.target.closest?.('summary, .file');
    if (!row) return;
    const rows = visibleRows(), i = rows.indexOf(row);
    const go = r => { if (r) { e.preventDefault(); setRoving(r); r.focus(); } };
    const det = row.tagName === 'SUMMARY' ? row.parentElement : null;
    if (e.key === 'ArrowDown') go(rows[i + 1]);
    else if (e.key === 'ArrowUp') go(rows[i - 1]);
    else if (e.key === 'Home') go(rows[0]);
    else if (e.key === 'End') go(rows[rows.length - 1]);
    else if (e.key === 'ArrowRight' && det) { e.preventDefault(); if (!det.open) det.open = true; else go(rows[i + 1]); }
    else if (e.key === 'ArrowLeft') {
      if (det && det.open) { e.preventDefault(); det.open = false; }
      else go(row.closest('li')?.parentElement?.closest('details')?.querySelector(':scope > summary'));
    }
    else if (e.key === 'Enter' && !det) { e.preventDefault(); openFile(row.dataset.path); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      const r = row.getBoundingClientRect();
      openTreeMenu(r.left + 12, r.bottom, row.dataset.path, row.dataset.kind);
    }
  });
  tree.addEventListener('focusin', e => { const row = e.target.closest?.('summary, .file'); if (row) setRoving(row); });
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
// copia recursiva (la File System API no tiene rename nativo). El fichero se
// copia como Blob, no como texto: pasarlo por .text() estropeaba cualquier
// binario (una imagen, un .zip) al renombrarlo.
async function fsCopy(srcDir, name, dstDir, newName) {
  const src = await (srcDir.getDirectoryHandle(name).catch(() => null));
  if (src) { // directorio
    const nd = await dstDir.getDirectoryHandle(newName, { create: true });
    for await (const e of src.values()) await fsCopy(src, e.name, nd, e.name);
  } else { // fichero
    const file = await (await srcDir.getFileHandle(name)).getFile();
    const fh = await dstDir.getFileHandle(newName, { create: true });
    const w = await fh.createWritable(); await w.write(file); await w.close();
  }
}
async function fsRename(path, kind, newName) {
  const parent = await dirByPath(parentOf(path));
  await fsCopy(parent, baseOf(path), parent, newName);
  await parent.removeEntry(baseOf(path), { recursive: kind === 'directory' });
}

// Lo que cuelga de `path` (el fichero o todo lo que hay dentro de la carpeta).
const under = (p, path, kind) => kind === 'directory' ? p.startsWith(path + '/') : p === path;

// Renombrar mueve también las pestañas abiertas: antes seguían apuntando a la
// ruta vieja, y guardar recreaba el fichero con el nombre antiguo.
function renameTabs(path, nuevo, kind) {
  for (const tb of tabs) if (under(tb.path, path, kind)) {
    const np = kind === 'directory' ? nuevo + tb.path.slice(path.length) : nuevo;
    if (active === tb.path) { active = np; code.setCurrentFile(np); }
    tb.path = np;
  }
  for (const d of [...openDirs]) if (d === path || d.startsWith(path + '/')) { openDirs.delete(d); openDirs.add(nuevo + d.slice(path.length)); }
  renderTabs();
}
// Borrar cierra sus pestañas. Si una tenía cambios sin guardar no se tira: se
// queda abierta y marcada (guardarla vuelve a crear el fichero).
function dropTabs(path, kind) {
  for (let i = tabs.length - 1; i >= 0; i--) {
    if (!under(tabs[i].path, path, kind)) continue;
    if (tabs[i].dirty) tabs[i].deleted = true;
    else closeTabNow(i);
  }
  for (const d of [...openDirs]) if (d === path || d.startsWith(path + '/')) openDirs.delete(d);
  renderTabs();
  applyView();
}

function openTreeMenu(x, y, path, kind) {
  document.getElementById('tree-menu')?.remove();
  const volver = document.activeElement;
  const menu = document.createElement('div');
  menu.id = 'tree-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:200`;
  // en un fichero, el "aquí dentro" es su carpeta; en carpeta/raíz, ella misma
  const container = kind === 'file' ? parentOf(path) : path;
  const items = [];
  items.push([t('tmNewFile'), async () => {
    const name = prompt(t('promptNewFile')); if (!name?.trim()) return;
    if (container) openDirs.add(container);
    await fsCreate(container, name.trim(), false); code.invalidateFileList?.();
    await refreshTree(); openFile(container ? container + '/' + name.trim() : name.trim());
  }]);
  items.push([t('tmNewFolder'), async () => {
    const name = prompt(t('promptNewFolder')); if (!name?.trim()) return;
    if (container) openDirs.add(container);
    await fsCreate(container, name.trim(), true); code.invalidateFileList?.(); await refreshTree();
    alertBar(t('created', { name: name.trim() }));
  }]);
  if (path) {
    if (kind === 'file') items.push([t('tmOpen'), () => openFile(path)]);
    if (kind === 'file' && PREVIEWABLE.has(langOf(path))) items.push([t('tmPreview'), () => togglePreview(path)]);
    items.push([t('tmRename'), async () => {
      const name = prompt(t('promptRename'), baseOf(path))?.trim(); if (!name || name === baseOf(path)) return;
      const nuevo = (parentOf(path) ? parentOf(path) + '/' : '') + name;
      await fsRename(path, kind, name); code.invalidateFileList?.();
      renameTabs(path, nuevo, kind);
      await refreshTree();
      alertBar(t('renamed', { from: baseOf(path), to: name }));
    }]);
    items.push([t('tmDelete'), async () => {
      if (!confirm(t('confirmDelete', { name: baseOf(path) }))) return;
      await fsDelete(path, kind); code.invalidateFileList?.();
      dropTabs(path, kind);
      await refreshTree();
      alertBar(t('deleted', { name: baseOf(path) }));
    }, 'danger']);
  }
  let close = () => menu.remove();
  for (const [label, fn, cls] of items) {
    const b = menuButton(label, fn, cls);
    b.onclick = async () => { close(); try { await fn(); } catch (err) { alert(t('opFailed', { e: err.message })); } };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  close = wireMenu(menu, volver);
}

const TREE_MAX_ENTRIES = 200;
async function renderDir(dir, prefix) {
  const ul = document.createElement('ul');
  if (prefix) ul.setAttribute('role', 'group');
  const entries = [];
  for await (const e of dir.values()) if (!IGNORE.has(e.name)) entries.push(e);
  entries.sort((a, b) => (a.kind !== b.kind) ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
  for (const e of entries.slice(0, TREE_MAX_ENTRIES)) {
    const li = document.createElement('li');
    li.setAttribute('role', 'none');
    const p = prefix ? prefix + '/' + e.name : e.name;
    if (e.kind === 'directory') {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.innerHTML = folderIcon();
      sum.appendChild(document.createTextNode(e.name));
      sum.dataset.path = p; sum.dataset.kind = 'directory';
      sum.setAttribute('role', 'treeitem');
      sum.setAttribute('aria-expanded', 'false');
      sum.tabIndex = -1;
      det.appendChild(sum);
      det.addEventListener('toggle', async () => {
        sum.setAttribute('aria-expanded', det.open ? 'true' : 'false');
        if (det.open) openDirs.add(p); else openDirs.delete(p);
        if (det.open && det.children.length === 1) {
          det.appendChild(await renderDir(e, p));
          markActive();
        }
      });
      // Estaba abierta antes del repintado: se reabre ya con su contenido.
      if (openDirs.has(p)) {
        det.appendChild(await renderDir(e, p));
        det.open = true;
        sum.setAttribute('aria-expanded', 'true');
      }
      li.appendChild(det);
    } else {
      const a = document.createElement('span');
      a.className = 'file';
      a.innerHTML = fileIcon(e.name);
      a.appendChild(document.createTextNode(e.name));
      a.dataset.path = p; a.dataset.kind = 'file';
      a.setAttribute('role', 'treeitem');
      a.tabIndex = -1;
      a.onclick = () => openFile(p);
      li.appendChild(a);
    }
    ul.appendChild(li);
  }
  // Una carpeta con más de 200 entradas se cortaba sin decirlo.
  if (entries.length > TREE_MAX_ENTRIES) {
    const li = document.createElement('li');
    li.className = 'tree-more';
    li.setAttribute('role', 'none');
    li.textContent = t('treeMore', { n: entries.length - TREE_MAX_ENTRIES });
    ul.appendChild(li);
  }
  return ul;
}

// ---------- extensiones de VS Code (js/ext/) ----------
// Temas de color, gramáticas TextMate, snippets y lenguajes. El host solo se
// carga si hay alguna extensión activa o un tema elegido, o al abrir el panel
// de extensiones: sin ellas, Code arranca exactamente igual que siempre.
let extCarga = null;
async function hayExtensiones() {
  try { const p = localStorage.getItem('elffusscode.theme'); if (p && p !== 'vs-dark') return true; } catch { /* sin almacenamiento */ }
  const lista = await db.get('kv', 'extensions').catch(() => null);
  return Array.isArray(lista) && lista.some(e => e && e.enabled);
}
export async function loadExt(force = true) {
  if (ext) return ext;
  if (!monacoRef || (!force && !(await hayExtensiones()))) return null;
  extCarga ??= import('./ext/host.js').then(m => m.init(monacoRef, { onLanguagesChanged: refreshLanguages }));
  try { ext = await extCarga; }
  catch (e) { extCarga = null; console.warn('[elffuss] extensiones no disponibles:', e?.message || e); }
  return ext;
}
// Tras instalar, activar o desactivar: cada pestaña abierta, con su lenguaje y
// su gramática al día (o de vuelta a lo de serie).
async function refreshLanguages() {
  for (const tab of [...tabs]) {
    if (tab.model.isDisposed()) continue;
    const lang = await langDe(tab.path, tab.model.getLineContent(1));
    await ext?.prepareLanguage(lang);
    if (!tab.model.isDisposed() && tab.model.getLanguageId() !== lang) monacoRef.editor.setModelLanguage(tab.model, lang);
  }
}

// Herramientas de proyecto: el único mundo que toca Elffuss Code es la
// carpeta de código que el usuario abre con el picker nativo.
import * as db from '../db.js';

let projectHandle = null;
let projectName = '';
let currentFile = null;              // ruta abierta en el editor
let onFileWritten = () => {};        // el IDE refresca pestañas/árbol

export function setOnFileWritten(fn) { onFileWritten = fn; }
export function setCurrentFile(path) { currentFile = path; }
export function current() { return { projectName, currentFile }; }
export function handle() { return projectHandle; }

// Lee un archivo de texto dentro de un dir handle por ruta (soporta subdirs).
async function readIn(dir, path) {
  const parts = path.split('/'); const name = parts.pop();
  for (const p of parts) dir = await dir.getDirectoryHandle(p);
  return (await (await dir.getFileHandle(name)).getFile()).text();
}

// Integración git SIN dependencias: parsea el .git directamente (rama + último
// commit). Suficiente para orientar; commitear se le pide al agente/terminal.
export async function gitInfo() {
  if (!projectHandle) return { isRepo: false };
  let git;
  try { git = await projectHandle.getDirectoryHandle('.git'); }
  catch { return { isRepo: false }; }
  const out = { isRepo: true, branch: '(detached)', lastCommit: null };
  try {
    const head = (await readIn(git, 'HEAD')).trim();
    out.branch = head.match(/ref:\s*refs\/heads\/(.+)/)?.[1] || head.slice(0, 7);
  } catch { /* sin HEAD */ }
  try {
    const last = (await readIn(git, 'logs/HEAD')).trim().split('\n').pop();
    const m = last.match(/^\S+ \S+ (.+?) <[^>]*> (\d+)[^\t]*\t(.+)$/);
    if (m) out.lastCommit = { author: m[1], when: new Date(+m[2] * 1000), msg: m[3] };
  } catch { /* sin logs (repo recién creado) */ }
  return out;
}

// Lista plana de archivos (para el command palette). Cacheada por proyecto.
let fileListCache = null;
export function invalidateFileList() { fileListCache = null; }
export async function fileList() {
  if (fileListCache) return fileListCache;
  if (!projectHandle) return [];
  const files = [];
  async function walk(dir, prefix, depth) {
    if (depth > 8 || files.length > 4000) return;
    for await (const e of dir.values()) {
      if (IGNORE.has(e.name)) continue;
      const p = prefix ? prefix + '/' + e.name : e.name;
      if (e.kind === 'directory') await walk(e, p, depth + 1);
      else files.push(p);
    }
  }
  await walk(projectHandle, '', 0);
  fileListCache = files;
  return files;
}

export async function openProject(handle) {
  projectHandle = handle;
  projectName = handle.name || 'proyecto';
  await db.set('kv', 'project', handle).catch(() => {});
  return projectName;
}

// Reabrir el último proyecto (el navegador puede exigir un gesto para re-conceder).
export async function restoreProject() {
  const h = await db.get('kv', 'project').catch(() => null);
  if (!h) return null;
  const q = h.queryPermission ? await h.queryPermission({ mode: 'readwrite' }) : 'granted';
  if (q === 'granted') {
    projectHandle = h;
    projectName = h.name || 'proyecto';
    return { name: projectName, ready: true };
  }
  return { name: h.name, ready: false, handle: h };
}

export async function regrant(h) {
  if (await h.requestPermission({ mode: 'readwrite' }) !== 'granted')
    throw new Error('permiso denegado');
  return openProject(h);
}

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.next', 'venv', '.venv', '.DS_Store']);
const MAX_READ = 60_000;

// Normaliza rutas del modelo: quita ./ y / iniciales y segmentos '.'
const normalize = path => (path || '').split('/').filter(p => p && p !== '.');

async function dirOf(path, { create = false } = {}) {
  if (!projectHandle) throw new Error('No hay proyecto abierto');
  const parts = normalize(path);
  const name = parts.pop();
  let dir = projectHandle;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return { dir, name };
}

// Buscar archivos por nombre (para sugerir cuando el modelo inventa rutas).
async function findByName(basename, limit = 5) {
  const hits = [];
  let visited = 0;
  async function walk(dir, prefix) {
    if (hits.length >= limit || visited > 500) return;
    for await (const e of dir.values()) {
      if (IGNORE.has(e.name)) continue;
      visited++;
      const p = prefix ? prefix + '/' + e.name : e.name;
      if (e.kind === 'directory') await walk(e, p);
      else if (e.name.toLowerCase() === basename.toLowerCase()) hits.push(p);
      if (hits.length >= limit || visited > 500) return;
    }
  }
  await walk(projectHandle, '');
  return hits;
}

// Árbol de texto (para el modelo y el CONTEXTO). Ignora dependencias/binarios.
export async function tree({ path = '', depth = 3 } = {}) {
  if (!projectHandle) throw new Error('No hay proyecto abierto');
  let root = projectHandle;
  for (const p of normalize(path)) root = await root.getDirectoryHandle(p);
  const out = [];
  let count = 0;
  async function walk(dir, prefix, d) {
    if (d > depth || count > 350) return;
    const entries = [];
    for await (const e of dir.values()) entries.push(e);
    entries.sort((a, b) => (a.kind !== b.kind) ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      if (++count > 350) { out.push(prefix + '…'); return; }
      out.push(prefix + (e.kind === 'directory' ? '📁 ' : '') + e.name);
      if (e.kind === 'directory') await walk(e, prefix + '  ', d + 1);
    }
  }
  await walk(root, '', 1);
  return out.join('\n') || '(vacío)';
}

export async function read({ path } = {}) {
  if (!path) throw new Error('Falta path');
  let file;
  try {
    const { dir, name } = await dirOf(path);
    file = await (await dir.getFileHandle(name)).getFile();
  } catch {
    // error que ENSEÑA: el modelo puede auto-corregirse en el siguiente paso
    const base = normalize(path).pop() || path;
    const hits = await findByName(base).catch(() => []);
    throw new Error(`no existe «${path}» en este proyecto.` +
      (hits.length ? ` ¿Quizá: ${hits.join(' · ')}?` : '') +
      ' Consulta el árbol (code.tree) o busca (code.search) antes de leer.');
  }
  const text = await file.text();
  return text.length > MAX_READ ? text.slice(0, MAX_READ) + `\n… (recortado, ${file.size} bytes)` : text;
}

// Aprobación de escritura: si «Auto» está apagado, el IDE pide confirmación
// antes de que la elfa toque archivos (como «Edit automatically» del plugin).
let approveWrite = async () => true;
export function setWriteApprover(fn) { approveWrite = fn; }

export async function write({ path, content = '' } = {}) {
  if (!path) throw new Error('Falta path');
  if (!await approveWrite(path, content)) return `Cambio en ${path} rechazado por el usuario`;
  const { dir, name } = await dirOf(path, { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(content);
  await w.close();
  invalidateFileList();
  onFileWritten(path, content);
  return `Escrito ${path} (${content.split('\n').length} líneas)`;
}

// grep-lite por el proyecto (texto, con límites para no arrasar).
export async function search({ query, ext = '' } = {}) {
  if (!query) throw new Error('Falta query');
  if (!projectHandle) throw new Error('No hay proyecto abierto');
  const results = [];
  let checked = 0;
  const q = query.toLowerCase();
  async function walk(dir, prefix) {
    if (results.length > 80 || checked > 400) return;
    for await (const e of dir.values()) {
      if (IGNORE.has(e.name)) continue;
      const p = prefix ? prefix + '/' + e.name : e.name;
      if (e.kind === 'directory') { await walk(e, p); continue; }
      if (ext && !e.name.endsWith(ext)) continue;
      const f = await e.getFile();
      if (f.size > 200_000) continue;
      checked++;
      const lines = (await f.text()).split('\n');
      lines.forEach((l, i) => {
        if (results.length <= 80 && l.toLowerCase().includes(q))
          results.push(`${p}:${i + 1}: ${l.trim().slice(0, 140)}`);
      });
      if (results.length > 80 || checked > 400) return;
    }
  }
  await walk(projectHandle, '');
  return results.length ? results.join('\n') : `Sin resultados para «${query}»`;
}

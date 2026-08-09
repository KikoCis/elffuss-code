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

// Buscar archivos por nombre (para sugerir cuando el modelo inventa rutas, o
// para resolver un enlace del chat que solo mencionaba el nombre del fichero).
export async function findByName(basename, limit = 5) {
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
const TREE_MAX = 800;
export async function tree({ path = '', depth = 3 } = {}) {
  if (!projectHandle) throw new Error('No hay proyecto abierto');
  let root = projectHandle;
  for (const p of normalize(path)) root = await root.getDirectoryHandle(p);
  const out = [];
  let count = 0, truncated = false;
  async function walk(dir, prefix, d) {
    if (d > depth || count >= TREE_MAX) return;
    const entries = [];
    for await (const e of dir.values()) entries.push(e);
    entries.sort((a, b) => (a.kind !== b.kind) ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name));
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      if (++count > TREE_MAX) { truncated = true; return; }
      out.push(prefix + (e.kind === 'directory' ? '📁 ' : '') + e.name);
      if (e.kind === 'directory') { await walk(e, prefix + '  ', d + 1); if (truncated) return; }
    }
  }
  await walk(root, '', 1);
  let res = out.join('\n') || '(vacío)';
  // Corte con AVISO y guía (como read/search): un «…» pelado se lee como «esto
  // es todo» y el modelo trabaja sobre un árbol incompleto sin saberlo.
  if (truncated)
    res += `\n… árbol recortado (>${TREE_MAX} entradas). Acota con code.tree({path:"subcarpeta"}) o localiza con code.search.`;
  return res;
}

const PAGE_SIZE = 100, PAGE_MAX = 500;

// Lectura completa (comportamiento de siempre) O por páginas de líneas — para
// ficheros grandes, o para plantarse justo en el número de línea que dio
// code.search y traer contexto antes/después sin volcar el fichero entero.
//   offset: línea 1-based donde empezar (con limit, PAGE_SIZE por defecto)
//   around: centra la página en esa línea (offset = around - limit/2)
// Sin offset/limit/around → fichero completo tal cual (no rompe nada que ya
// dependa de leerlo entero, p.ej. code.edit).
export async function read({ path, offset, limit, around } = {}) {
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
  const full = await file.text();

  if (offset == null && limit == null && around == null) {
    return full.length > MAX_READ ? full.slice(0, MAX_READ) + `\n… (recortado, ${file.size} bytes)` : full;
  }

  const lines = full.split('\n');
  const total = lines.length;
  const size = Math.max(1, Math.min(Math.round(limit) || PAGE_SIZE, PAGE_MAX));
  const start = around != null
    ? Math.max(1, Math.round(around) - Math.floor(size / 2))
    : Math.max(1, Math.round(offset) || 1);
  const startIdx = start - 1;
  const slice = lines.slice(startIdx, startIdx + size);
  const endLine = startIdx + slice.length;
  const numbered = slice.map((l, i) => `${start + i}→${l}`).join('\n');
  const more = endLine < total ? `\n… quedan líneas ${endLine + 1}-${total} — pide code.read con offset:${endLine + 1} para seguir` : '';
  return `${path}: líneas ${start}-${endLine} de ${total}\n${numbered}${more}`;
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

// Edición PARCIAL (no hace falta reescribir el fichero entero): sustituye
// `search` por `replace`. Primero intenta coincidencia EXACTA (rápida, sin
// ambigüedad); si no la encuentra tal cual —el modelo puede recordar mal un
// espacio o un salto de línea—, cae a un parcheado difuso (diff-match-patch,
// la misma librería que usan herramientas como aider) que localiza el punto
// más parecido dentro del fichero real. Si ni así hay confianza suficiente,
// falla con un mensaje claro para que el agente reintente con más contexto
// — nunca escribe una coincidencia dudosa.
export async function edit({ path, search, replace } = {}) {
  if (!path) throw new Error('Falta path');
  if (search == null || replace == null) throw new Error('Faltan search y replace');
  // Contenido COMPLETO, sin el tope de MAX_READ. edit reescribe el fichero
  // entero, así que leer la vista recortada de read() truncaría todo lo que
  // hubiese más allá de MAX_READ (bug histórico: editar un fichero >60KB lo
  // dejaba en 60KB y metía el marcador «… (recortado)» dentro del código).
  let current;
  try {
    const { dir, name } = await dirOf(path);
    current = await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch {
    await read({ path });   // relanza el error «que enseña» (sugiere code.tree/search); nunca retorna
    throw new Error(`no existe «${path}»`);
  }

  const first = current.indexOf(search);
  if (first !== -1) {
    if (current.indexOf(search, first + 1) !== -1) {
      throw new Error(`«search» aparece más de una vez en ${path} — añade más líneas de contexto alrededor para que sea inequívoco.`);
    }
    return write({ path, content: current.slice(0, first) + replace + current.slice(first + search.length) });
  }

  // fallback difuso, LOCAL y por líneas (sin depender de esm.sh en tiempo de
  // edición — eso rompería la edición sin conexión, justo lo contrario del
  // producto). El error típico del modelo al recordar «search» es la sangría o
  // los espacios; localizamos el bloque normalizando espacios y, si hace falta,
  // por parecido de líneas — y sustituimos ESE bloque, esté donde esté (también
  // en lo hondo de un fichero grande).
  const norm = s => s.replace(/[ \t]+/g, ' ').trim();
  const curLines = current.split('\n');
  const seaLines = search.replace(/\n+$/, '').split('\n');
  const nSea = seaLines.map(norm);
  const k = seaLines.length;

  // 1) bloque idéntico salvo espacios → tiene que ser ÚNICO
  let exactStart = -1, exactHits = 0;
  for (let i = 0; i + k <= curLines.length; i++) {
    let same = true;
    for (let j = 0; j < k; j++) if (norm(curLines[i + j]) !== nSea[j]) { same = false; break; }
    if (same) { exactHits++; if (exactStart === -1) exactStart = i; if (exactHits > 1) break; }
  }
  if (exactHits > 1)
    throw new Error(`«search» coincide (ignorando espacios) en más de un sitio de ${path} — añade líneas de contexto para que sea inequívoco.`);

  let start = exactStart;
  if (start === -1) {
    // 2) por parecido: la ventana con más líneas coincidentes (normalizadas),
    // exigiendo ≥70% y que gane con claridad a la segunda mejor (sin ambigüedad)
    let best = -1, bestScore = 0, second = 0;
    for (let i = 0; i + k <= curLines.length; i++) {
      let hit = 0;
      for (let j = 0; j < k; j++) if (norm(curLines[i + j]) === nSea[j]) hit++;
      const score = hit / k;
      if (score > bestScore) { second = bestScore; bestScore = score; best = i; }
      else if (score > second) second = score;
    }
    if (bestScore >= 0.7 && bestScore - second >= 0.2) start = best;
  }
  if (start === -1)
    throw new Error(`No encontré con suficiente confianza el punto exacto a editar en ${path} (ni exacto ni aproximado). ` +
      `Vuelve a leerlo (code.read) y copia «search» literal de esas líneas, más corto si hace falta.`);

  const nextLines = [...curLines.slice(0, start), ...replace.split('\n'), ...curLines.slice(start + k)];
  const nextContent = nextLines.join('\n');
  if (nextContent === current)
    throw new Error(`La edición en ${path} no cambió nada — revisa «replace».`);
  return write({ path, content: nextContent });
}

// grep-lite por el proyecto (texto, con límites para no arrasar). Los topes
// existen por rendimiento, pero si se alcanzan hay que DECÍRSELO al modelo
// (igual que read() avisa «quedan líneas…»); si no, un corte silencioso se lee
// como «no hay más» y el modelo da por cerrada una búsqueda incompleta.
const SEARCH_MAX_FILES = 1500, SEARCH_MAX_HITS = 80;
export async function search({ query, ext = '' } = {}) {
  if (!query) throw new Error('Falta query');
  if (!projectHandle) throw new Error('No hay proyecto abierto');
  const results = [];
  let checked = 0, capped = false;
  const q = query.toLowerCase();
  async function walk(dir, prefix) {
    if (results.length >= SEARCH_MAX_HITS || checked >= SEARCH_MAX_FILES) { capped = true; return; }
    for await (const e of dir.values()) {
      if (IGNORE.has(e.name)) continue;
      const p = prefix ? prefix + '/' + e.name : e.name;
      if (e.kind === 'directory') { await walk(e, p); if (capped) return; continue; }
      if (ext && !e.name.endsWith(ext)) continue;
      const f = await e.getFile();
      if (f.size > 200_000) continue;
      checked++;
      const lines = (await f.text()).split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(q)) {
          results.push(`${p}:${i + 1}: ${lines[i].trim().slice(0, 140)}`);
          if (results.length >= SEARCH_MAX_HITS) { capped = true; break; }
        }
      }
      if (results.length >= SEARCH_MAX_HITS || checked >= SEARCH_MAX_FILES) { capped = true; return; }
    }
  }
  await walk(projectHandle, '');
  if (!results.length)
    return `Sin resultados para «${query}»` + (capped ? ` (búsqueda cortada tras ${checked} ficheros; afina con ext:".js" o un término más concreto).` : '');
  return results.join('\n') + (capped
    ? `\n… búsqueda cortada (${results.length} resultados, ${checked} ficheros revisados) — puede haber más: afina con ext o un término más concreto.`
    : '');
}

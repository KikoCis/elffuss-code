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
  // Pedir más allá del final devolvía un rango imposible («líneas 999-998 de 6»)
  // y CERO contenido: el modelo se quedaba sin nada que hacer. Mejor decírselo.
  if (startIdx >= total)
    return `${path}: solo tiene ${total} líneas y pediste desde la ${start} — usa offset entre 1 y ${total}.`;
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

// `write` reescribe el fichero ENTERO, así que es la vía por la que se pierde
// código. Medido: tras dos rechazos de la guarda de sintaxis en `edit`, el
// modelo se escapó por aquí y reescribió el fichero. En uno de cuatro líneas da
// igual; en uno de seiscientas, así es como desaparece medio proyecto.
// `_interno` lo pone `edit`, que ya ha comprobado lo suyo sobre el texto exacto.
export async function write({ path, content = '', _interno = false } = {}) {
  if (!path) throw new Error('Falta path');
  if (!_interno) {
    let previo = null;
    try { const { dir, name } = await dirOf(path); previo = await (await (await dir.getFileHandle(name)).getFile()).text(); }
    catch { /* fichero nuevo: nada que preservar */ }
    if (previo !== null) {
      const antes = previo.split('\n').length, ahora = content.split('\n').length;
      // Un fichero con cuerpo que se queda en menos de la mitad casi nunca es
      // intencionado: es el modelo reescribiendo de memoria lo que no recuerda.
      if (antes >= 40 && ahora < antes * 0.5) {
        anota('truncaria', path, { antes, ahora });
        throw new Error(`Eso dejaría ${path} en ${ahora} líneas cuando tiene ${antes}: perderías el resto del fichero. ` +
          `Para cambiar una parte usa code.edit con «search» y «replace»; code.write solo para ficheros nuevos o reescrituras completas de verdad.`);
      }
      revisaSintaxis(path, previo, content);
    }
  }
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
// Telemetría de edición: por qué vía se resolvió cada intento. Sin esto,
// «la edición falla» no es accionable — no sabes si el modelo cita mal, si
// cita ambiguo o si no encuentra el sitio.
export const editStats = { total: 0, exacta: 0, bloque: 0, nucleo: 0, difusa: 0, ambigua: 0, noEncontrado: 0, sinCambio: 0, noExiste: 0, rompeSintaxis: 0, yaAplicado: 0, truncaria: 0, detalle: [] };
export function resetEditStats() {
  editStats.total = editStats.exacta = editStats.bloque = editStats.nucleo = editStats.difusa = 0;
  editStats.ambigua = editStats.noEncontrado = editStats.sinCambio = editStats.noExiste = editStats.rompeSintaxis = editStats.yaAplicado = editStats.truncaria = 0;
  editStats.detalle.length = 0;
}
const anota = (via, path, extra) => { editStats[via]++; editStats.detalle.push({ via, path, ...extra }); };

// read() paginado devuelve «12→código» para que el modelo pueda pedir un
// offset; el efecto secundario es que el modelo copia ESE texto como «search»,
// con el número pegado delante. Entonces la cita no existe en el fichero y la
// edición no puede encajar NUNCA — un fichero que pasa de una página se vuelve
// ineditable. Se los quitamos, pero solo si TODAS las líneas los llevan: así
// una flecha suelta dentro del código de verdad no se toca.
const SIN_NUMEROS = /^[ \t]*\d+→/;
// Exigir que TODAS las líneas lleven número no valía: un modelo pequeño numera
// unas sí y otras no, la limpieza no se disparaba y la cita no podía casar. Con
// mayoría basta, y «\d+→» al principio de línea es lo bastante raro en código
// real como para no llevarse nada por delante. Se mira search y replace por
// separado: si los números se colaran en «replace» acabarían ESCRITOS dentro
// del fichero, que es peor que no editar.
function quitaNumerosDeLinea(txt) {
  if (txt == null) return txt;
  const lineas = txt.split('\n');
  const conCuerpo = lineas.filter(l => l.trim());
  if (!conCuerpo.length) return txt;
  const numeradas = conCuerpo.filter(l => SIN_NUMEROS.test(l)).length;
  return numeradas / conCuerpo.length >= 0.6 ? lineas.map(l => l.replace(SIN_NUMEROS, '')).join('\n') : txt;
}

// Una edición que deja el fichero sintácticamente roto es peor que una que no
// se aplica: el modelo dice «arreglado» y lo que hay es un fichero que ya ni
// carga. Caso real medido: el modelo sustituyó la línea de la firma por una
// función entera CON su llave de cierre, dejando huérfano el cuerpo de antes
// («Illegal return statement»). new Function() solo PARSEA, no ejecuta; para
// que trague un módulo hay que quitarle import/export, que son sintaxis de
// módulo. Solo se rechaza si el fichero estaba BIEN antes: si ya venía roto,
// la edición es justamente lo que viene a arreglarlo.
const ES_JS = /\.(js|mjs|cjs|jsx)$/i;
function seParsea(codigo) {
  const sinModulo = codigo
    .replace(/^\s*import\s+[^;]*;?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+/gm, 'void ')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^(\s*)export\s+/gm, '$1');
  try { new Function(sinModulo); return true; } catch (e) { return e instanceof SyntaxError ? String(e.message) : true; }
}
function revisaSintaxis(path, antes, despues) {
  if (!ES_JS.test(path)) return;
  if (seParsea(antes) !== true) return;          // ya estaba roto: no estorbar
  const mal = seParsea(despues);
  if (mal !== true) {
    anota('rompeSintaxis', path, { error: String(mal).slice(0, 80) });
    throw new Error(`Esa edición dejaría ${path} sin poder cargarse (${mal}). ` +
      `Suele pasar por cerrar una llave de más: revisa que «replace» encaje con lo que rodea a «search», ` +
      `o incluye en «search» el bloque completo que vas a sustituir.`);
  }
}

export async function edit({ path, search, replace } = {}) {
  editStats.total++;
  if (!path) throw new Error('Falta path');
  if (search == null || replace == null) throw new Error('Faltan search y replace');
  // Cada uno por su cuenta: el modelo puede numerar solo uno de los dos.
  search = quitaNumerosDeLinea(search);
  replace = quitaNumerosDeLinea(replace);
  // Contenido COMPLETO, sin el tope de MAX_READ. edit reescribe el fichero
  // entero, así que leer la vista recortada de read() truncaría todo lo que
  // hubiese más allá de MAX_READ (bug histórico: editar un fichero >60KB lo
  // dejaba en 60KB y metía el marcador «… (recortado)» dentro del código).
  let current;
  try {
    const { dir, name } = await dirOf(path);
    current = await (await (await dir.getFileHandle(name)).getFile()).text();
  } catch {
    anota('noExiste', path, {});
    await read({ path });   // relanza el error «que enseña» (sugiere code.tree/search); nunca retorna
    throw new Error(`no existe «${path}»`);
  }

  // Reintentar sobre algo YA hecho era un error igual que no encontrarlo, así
  // que el modelo volvía a intentarlo en bucle. Si el resultado ya está y la
  // cita ya no, la edición sobra: decirlo como estado y seguir. Se exige el
  // «replace» COMPLETO presente y el «search» ausente, para no dar por buena
  // una edición que no ocurrió.
  if (replace.trim().length >= 8 && current.includes(replace) && !current.includes(search)) {
    anota('yaAplicado', path, {});
    return `Ese cambio ya está en ${path} — no hace falta editar. Sigue con lo siguiente.`;
  }

  const first = current.indexOf(search);
  if (first !== -1) {
    if (current.indexOf(search, first + 1) !== -1) {
      anota('ambigua', path, { fase: 'exacta' });
      // decir DÓNDE está, igual que en las vías difusas: pedir «más contexto»
      // a secas hace que un modelo pequeño cite más largo y peor.
      const lineas = [];
      for (let i = current.indexOf(search); i !== -1 && lineas.length < 8; i = current.indexOf(search, i + 1))
        lineas.push(current.slice(0, i).split('\n').length);
      throw new Error(`«search» aparece ${lineas.length} veces en ${path} (líneas ${lineas.join(', ')}). ` +
        `Cita un bloque que incluya alguna línea que solo exista en el sitio que quieres cambiar.`);
    }
    const siguiente = current.slice(0, first) + replace + current.slice(first + search.length);
    // La vía difusa ya comprobaba esto abajo; la exacta no. Un search idéntico
    // al replace escribía el mismo fichero y devolvía ÉXITO, así que el agente
    // daba la tarea por arreglada sin haber cambiado una coma.
    if (siguiente === current) {
      anota('sinCambio', path, { fase: 'exacta' });
      throw new Error(`La edición en ${path} no cambió nada: «search» y «replace» son iguales. Escribe en «replace» el código YA corregido.`);
    }
    revisaSintaxis(path, current, siguiente);
    anota('exacta', path, {});
    return write({ path, content: siguiente, _interno: true });
  }

  // fallback difuso, LOCAL y por líneas (sin depender de esm.sh en tiempo de
  // edición — eso rompería la edición sin conexión, justo lo contrario del
  // producto). El error típico del modelo al recordar «search» es la sangría o
  // los espacios; localizamos el bloque normalizando espacios y, si hace falta,
  // por parecido de líneas — y sustituimos ESE bloque, esté donde esté (también
  // en lo hondo de un fichero grande).
  const norm = s => s.replace(/[ \t]+/g, ' ').trim();   // .trim() se lleva también el \r final
  // Partimos guardando el offset de carácter de cada línea: así el bloque se
  // sustituye por CORTE EXACTO y todo lo de fuera queda byte a byte igual
  // (incluidos sus finales de línea). Con split/join se reescribía el fichero
  // entero y un fichero CRLF acababa con finales de línea MEZCLADOS.
  const curLines = [], lineStart = [];
  for (let i = 0; i <= current.length;) {
    const nl = current.indexOf('\n', i);
    lineStart.push(i);
    if (nl === -1) { curLines.push(current.slice(i)); break; }
    curLines.push(current.slice(i, nl));                // puede acabar en \r
    i = nl + 1;
  }
  const crlf = (current.match(/\r\n/g) || []).length;
  const eol = crlf && crlf * 2 >= (current.match(/\n/g) || []).length ? '\r\n' : '\n';
  const nCur = curLines.map(norm);                        // normalizamos UNA vez
  let seaLines = search.replace(/[\r\n]+$/, '').split(/\r?\n/);
  let repLines = replace.split(/\r?\n/);

  // Posiciones donde un bloque de líneas encaja (ignorando espacios).
  const locate = (nBlock) => {
    const at = [];
    for (let i = 0; i + nBlock.length <= nCur.length; i++) {
      let same = true;
      for (let j = 0; j < nBlock.length; j++) if (nCur[i + j] !== nBlock[j]) { same = false; break; }
      if (same) { at.push(i); if (at.length > 8) break; }
    }
    return at;
  };
  // Pedir «más contexto» a un modelo pequeño produce citas más largas y peores.
  // Decirle en qué líneas está le deja elegir con un bloque MÁS corto y único.
  const ambiguous = (donde = []) => new Error(
    `«search» encaja en ${donde.length || 'varios'} sitios de ${path}` +
    (donde.length ? ` (líneas ${donde.map(i => i + 1).join(', ')})` : '') +
    `. Cita un bloque que incluya alguna línea que solo exista en el sitio que quieres cambiar.`);

  let start = -1, k = seaLines.length;

  // 1) el bloque ENTERO, idéntico salvo espacios → tiene que ser ÚNICO
  {
    const at = locate(seaLines.map(norm));
    if (at.length > 1) { anota('ambigua', path, { fase: 'bloque' }); throw ambiguous(at); }
    if (at.length === 1) { start = at[0]; anota('bloque', path, {}); }
  }

  // 2) si no aparece entero, puede ser que el fichero tenga líneas que el modelo
  // NO vio (un comentario añadido después, p. ej.) metidas dentro del bloque.
  // Como search y replace comparten el contexto sin tocar al principio y al
  // final, recortamos esa parte común y buscamos solo el NÚCLEO que cambia: así
  // lo que el modelo no vio se queda donde estaba en vez de desaparecer.
  if (start === -1) {
    let pre = 0, suf = 0;
    while (pre < seaLines.length && pre < repLines.length && norm(seaLines[pre]) === norm(repLines[pre])) pre++;
    while (suf < seaLines.length - pre && suf < repLines.length - pre &&
           norm(seaLines[seaLines.length - 1 - suf]) === norm(repLines[repLines.length - 1 - suf])) suf++;
    const core = seaLines.slice(pre, seaLines.length - suf);
    if (core.length) {
      let at = locate(core.map(norm));
      if (at.length > 1) {
        // desempate por CONTEXTO: gana el candidato con más líneas del contexto
        // recortado alrededor (y solo si gana en solitario).
        const ctx = [...seaLines.slice(0, pre), ...seaLines.slice(seaLines.length - suf)].map(norm).filter(Boolean);
        const near = i => {
          const from = Math.max(0, i - pre - 3), to = Math.min(nCur.length, i + core.length + suf + 3);
          const around = nCur.slice(from, to);
          return ctx.filter(c => around.includes(c)).length;
        };
        const scored = at.map(i => ({ i, s: near(i) })).sort((a, b) => b.s - a.s);
        if (ctx.length && scored[0].s > scored[1].s) at = [scored[0].i];
      }
      if (at.length > 1) { anota('ambigua', path, { fase: 'nucleo' }); throw ambiguous(at); }
      if (at.length === 1) { start = at[0]; k = core.length; repLines = repLines.slice(pre, repLines.length - suf); anota('nucleo', path, { pre, suf }); }
    }
  }

  // 3) por parecido: la ventana con más líneas coincidentes, exigiendo ≥70% y
  // que gane con claridad a la segunda mejor (sin ambigüedad)
  let mejorVentana = null;
  if (start === -1) {
    const nSea = seaLines.map(norm);
    let best = -1, bestScore = 0, second = 0;
    for (let i = 0; i + k <= nCur.length; i++) {
      let hit = 0;
      for (let j = 0; j < k; j++) if (nCur[i + j] === nSea[j]) hit++;
      const score = hit / k;
      if (score > bestScore) { second = bestScore; bestScore = score; best = i; }
      else if (score > second) second = score;
    }
    if (bestScore >= 0.7 && bestScore - second >= 0.2) { start = best; anota('difusa', path, { parecido: +bestScore.toFixed(2) }); }
    else if (bestScore > 0) anota('noEncontrado', path, { mejorParecido: +bestScore.toFixed(2), segundo: +second.toFixed(2) });
    // Pedirle que RELEA le cuesta un turno entero y a un modelo pequeño le sale
    // una cita más larga y peor. Como ya sabemos dónde está lo más parecido,
    // se lo damos literal y numerado: puede copiar de ahí en el mismo turno.
    if (best >= 0 && bestScore > 0) {
      const desde = Math.max(0, best - 2), hasta = Math.min(curLines.length, best + k + 2);
      mejorVentana = curLines.slice(desde, hasta)
        .map((l, i) => `${desde + i + 1}→${l}`).slice(0, 12).join('\n');
    }
  }
  if (start === -1)
    throw new Error(`No encontré en ${path} el bloque que citas. ` +
      (mejorVentana ? `Lo más parecido que hay es esto (copia «search» LITERAL de aquí, sin los números):\n${mejorVentana}`
                    : `Léelo con code.read y copia «search» literal de esas líneas.`));

  // Corte exacto del bloque [start, start+k): desde el inicio de su primera
  // línea hasta el inicio de la siguiente (es decir, salto de línea incluido).
  const cutFrom = lineStart[start];
  const hasTrailingNL = start + k < lineStart.length;
  const cutTo = hasTrailingNL ? lineStart[start + k] : current.length;
  const block = repLines.join(eol) + (hasTrailingNL ? eol : '');
  const nextContent = current.slice(0, cutFrom) + block + current.slice(cutTo);
  if (nextContent === current) {
    anota('sinCambio', path, {});
    throw new Error(`La edición en ${path} no cambió nada — revisa «replace».`);
  }
  revisaSintaxis(path, current, nextContent);
  return write({ path, content: nextContent, _interno: true });
}

// grep-lite por el proyecto (texto, con límites para no arrasar). Los topes
// existen por rendimiento, pero si se alcanzan hay que DECÍRSELO al modelo
// (igual que read() avisa «quedan líneas…»); si no, un corte silencioso se lee
// como «no hay más» y el modelo da por cerrada una búsqueda incompleta.
const SEARCH_MAX_FILES = 1500, SEARCH_MAX_HITS = 80, SEARCH_MAX_BYTES = 2_000_000;
// Binarios: NO pueden contener el texto que se busca y leerlos como texto es
// caro. Fuera de esta lista quedan .svg/.json/.md/.csv, que son texto y sí se
// buscan. (Antes el tope de tamaño hacía de filtro accidental de binarios.)
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|mp[34]|m4a|wav|ogg|mov|avi|webm|pdf|zip|gz|bz2|xz|tar|7z|rar|woff2?|ttf|eot|otf|wasm|bin|exe|dll|so|dylib|class|jar|pyc|sqlite3?)$/i;
export async function search({ query, ext = '' } = {}) {
  if (!query) throw new Error('Falta query');
  if (!projectHandle) throw new Error('No hay proyecto abierto');
  const results = [];
  const skipped = [];                       // ficheros de texto NO buscados por tamaño
  let checked = 0, capped = false;
  const q = query.toLowerCase();
  async function walk(dir, prefix) {
    if (results.length >= SEARCH_MAX_HITS || checked >= SEARCH_MAX_FILES) { capped = true; return; }
    for await (const e of dir.values()) {
      if (IGNORE.has(e.name)) continue;
      const p = prefix ? prefix + '/' + e.name : e.name;
      if (e.kind === 'directory') { await walk(e, p); if (capped) return; continue; }
      if (ext && !e.name.endsWith(ext)) continue;
      if (BINARY_EXT.test(e.name)) continue;
      const f = await e.getFile();
      // Un fichero grande es justo donde el modelo NO puede leerlo entero, así
      // que es el que más falta hace buscar. Se busca hasta SEARCH_MAX_BYTES; y
      // lo que quede fuera se DICE (antes: >200KB se saltaba en silencio, y
      // «Sin resultados» sonaba a «ese código no existe» siendo mentira).
      if (f.size > SEARCH_MAX_BYTES) { skipped.push(p); continue; }
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
  // Todo lo que la búsqueda NO ha mirado se cuenta; un resultado incompleto que
  // se presenta como completo es peor que no buscar.
  const notes = [];
  if (capped) notes.push(`búsqueda cortada (${results.length} resultados, ${checked} ficheros revisados) — puede haber más: afina con ext o un término más concreto`);
  if (skipped.length) notes.push(`${skipped.length} fichero(s) NO buscados por tamaño (>${SEARCH_MAX_BYTES / 1e6} MB): ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''} — mira dentro con code.read`);
  const tail = notes.length ? '\n… ' + notes.join('. ') + '.' : '';
  if (!results.length)
    return `Sin resultados para «${query}»` + (tail || '');
  return results.join('\n') + tail;
}

// ── code.run: ejecutar el código y ver qué hace de verdad ───────────────────
//
// Medido con Gemma E4B: arregló un bug DOS veces (cambió la constante Y el
// operador) y dejó un fichero perfectamente válido pero incorrecto, rematando
// con «aplicado correctamente». Ninguna guarda sintáctica puede ver eso: la
// única forma de saberlo es ejecutarlo.
//
// Corre en un Worker de módulo: sin DOM, sin acceso a la página, y se le corta
// el paso por tiempo si se cuelga en un bucle. Los imports relativos se
// resuelven a mano contra el proyecto — sin build, un blob no sabe resolver
// «./otro.js» por su cuenta, y sin esto solo servirían los ficheros sueltos.
const RUN_MS = 4000, RUN_MAX_MODULOS = 40;

async function moduloComoBlob(path, hechos = new Map(), profundidad = 0) {
  const clave = normalize(path).join('/');
  if (hechos.has(clave)) return hechos.get(clave);
  if (hechos.size >= RUN_MAX_MODULOS || profundidad > 12)
    throw new Error(`demasiados ficheros encadenados desde ${path}`);
  hechos.set(clave, null);                       // marca de ciclo
  const { dir, name } = await dirOf(clave);
  let txt = await (await (await dir.getFileHandle(name)).getFile()).text();

  // reescribir cada import/export relativo al blob del fichero al que apunta
  const relativos = [...txt.matchAll(/(from\s*|import\s*\(\s*)(['"])(\.[^'"]+)\2/g)];
  for (const m of relativos) {
    const destino = normalize(clave.split('/').slice(0, -1).join('/') + '/' + m[3]).join('/');
    let url;
    try { url = await moduloComoBlob(destino, hechos, profundidad + 1); }
    catch { continue; }                          // que falle al importar, no aquí
    if (url) txt = txt.split(m[0]).join(`${m[1]}${m[2]}${url}${m[2]}`);
  }
  const url = URL.createObjectURL(new Blob([txt], { type: 'text/javascript' }));
  hechos.set(clave, url);
  return url;
}

export async function run({ path, expr } = {}) {
  if (!path) throw new Error('Falta path');
  if (!expr) throw new Error('Falta expr: qué quieres evaluar, p.ej. "m.max([])"');
  if (!ES_JS.test(path)) throw new Error(`code.run solo ejecuta JavaScript, y ${path} no lo es`);
  if (/^\s*import[\s{]/.test(expr) || /\brequire\s*\(/.test(expr))
    throw new Error(`«expr» es solo una EXPRESIÓN, no un programa: el módulo ya está importado. ` +
      `Escribe directamente la llamada, p.ej. «miFuncion(1, 2)» o «m.miFuncion(1, 2)».`);
  const hechos = new Map();
  let url;
  try { url = await moduloComoBlob(path, hechos); }
  catch (e) { throw new Error(`no pude preparar ${path} para ejecutarlo: ${e.message}`); }

  // Los nombres exportados se ATAN como variables sueltas, además de en «m».
  // Medido: el modelo escribe «slugify(...)» de forma natural, le saltaba un
  // «slugify is not defined», y de ahí concluía que su arreglo estaba mal y se
  // ponía a destrozar código que YA funcionaba — le quitó el export y rompió el
  // módulo. La herramienta de comprobar le enseñó que lo correcto era incorrecto.
  // Y si aun así nombra algo que no existe, el error DICE qué hay exportado, en
  // vez de dejarle deducir que el fichero está roto.
  const guion = `
    self.onmessage = async ({ data }) => {
      try {
        const m = await import(data.url);
        const nombres = Object.keys(m).filter(n => /^[A-Za-z_$][\\w$]*$/.test(n));
        const fn = new Function('m', ...nombres, 'return (' + data.expr + ')');
        const valor = await fn(m, ...nombres.map(n => m[n]));
        let texto;
        try { texto = JSON.stringify(valor); } catch { texto = String(valor); }
        if (texto === undefined) texto = String(valor);
        self.postMessage({ ok: true, tipo: typeof valor, texto });
      } catch (e) {
        let exporta = [];
        try { exporta = Object.keys(await import(data.url)); } catch { /* ni carga */ }
        self.postMessage({ ok: false, error: e.message, exporta });
      }
    };`;
  const wUrl = URL.createObjectURL(new Blob([guion], { type: 'text/javascript' }));
  const worker = new Worker(wUrl, { type: 'module' });
  try {
    const r = await new Promise((resolve) => {
      // Un bucle infinito en el código del usuario no puede colgar el IDE.
      const reloj = setTimeout(() => resolve({ ok: false, error: `no terminó en ${RUN_MS} ms (¿bucle infinito?)` }), RUN_MS);
      worker.onmessage = e => { clearTimeout(reloj); resolve(e.data); };
      worker.onerror = e => { clearTimeout(reloj); resolve({ ok: false, error: e.message || 'error al cargar el módulo' }); };
      worker.postMessage({ url, expr });
    });
    if (r.ok) return `${expr} → ${r.texto}  (${r.tipo})`;
    // Un «X is not defined» sin más lleva al modelo a «el fichero está mal».
    // Decirle qué exporta de verdad corta esa deducción en seco.
    const noDefinido = /(\w+) is not defined/.exec(r.error || '');
    const pista = noDefinido && r.exporta?.length
      ? ` — «${noDefinido[1]}» no está en ${path}, que exporta: ${r.exporta.join(', ')}. Llámalo por su nombre o con m.<nombre>; el fichero NO tiene por qué estar mal.`
      : (r.exporta?.length ? ` (${path} exporta: ${r.exporta.join(', ')})` : '');
    return `${expr} lanzó: ${r.error}${pista}`;
  } finally {
    worker.terminate();
    URL.revokeObjectURL(wUrl);
    for (const u of hechos.values()) if (u) URL.revokeObjectURL(u);
  }
}

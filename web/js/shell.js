// Shell del proyecto: un intérprete POSIX-lite que opera SOBRE LOS FICHEROS
// REALES de la carpeta abierta (el FileSystemDirectoryHandle de code.js). No es
// una emulación: `ls`, `cat`, `grep`, `mkdir`, `rm`, `echo > fichero`… tocan el
// disco de verdad y el editor/árbol se refrescan. Es el mismo mundo que ve la
// elfa, así que también lo exponemos como herramienta `terminal.run`.
//
// Runtimes reales (node/npm/python) necesitan aislamiento cross-origin
// (WebContainers) — ver `capabilities()`. Sin él, esto ya cubre navegar,
// leer, buscar y editar el proyecto sin salir del navegador.
import * as code from './tools/code.js';

let cwd = [];                 // directorio actual, segmentos relativos a la raíz
const history = [];           // historial de comandos (para ↑/↓ y `history`)
let onFsChange = () => {};     // el IDE refresca árbol/pestañas tras mutaciones
let onOpenFile = () => {};     // `open <fichero>` lo abre en Monaco

export function setHooks({ fsChange, openFile } = {}) {
  if (fsChange) onFsChange = fsChange;
  if (openFile) onOpenFile = openFile;
}
export function reset() { cwd = []; }
export function cwdString() { return '/' + cwd.join('/'); }
export function getHistory() { return history.slice(); }

// ¿Podemos lanzar runtimes reales? WebContainers exige crossOriginIsolated
// (cabeceras COOP+COEP). Lo detectamos para dar mensajes honestos.
export function capabilities() {
  return { crossOriginIsolated: !!self.crossOriginIsolated, webcontainers: !!self.crossOriginIsolated };
}

// ---- resolución de rutas ----
// Combina un argumento con el cwd y normaliza . y .. → segmentos desde la raíz.
function resolve(arg = '') {
  const base = arg.startsWith('/') ? [] : [...cwd];
  for (const seg of String(arg).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') base.pop();
    else base.push(seg);
  }
  return base;
}
const root = () => { const h = code.handle(); if (!h) throw new Error('no hay proyecto abierto'); return h; };

async function dirHandle(segs, { create = false } = {}) {
  let dir = root();
  for (const s of segs) dir = await dir.getDirectoryHandle(s, { create });
  return dir;
}
async function parentAndName(segs) {
  const s = [...segs]; const name = s.pop();
  if (name == null) throw new Error('ruta vacía');
  return { parent: await dirHandle(s), name };
}
async function fileHandle(segs, opts) {
  const { parent, name } = await parentAndName(segs);
  return parent.getFileHandle(name, opts);
}
async function readText(segs) { return (await (await fileHandle(segs)).getFile()).text(); }
async function writeText(segs, text) {
  const fh = await fileHandle(segs, { create: true });
  const w = await fh.createWritable(); await w.write(text); await w.close();
  code.invalidateFileList?.(); onFsChange();
}
// ¿ruta es directorio? (para `ls fichero`, `grep dir`, `cd`)
async function kindOf(segs) {
  if (!segs.length) return 'directory';
  const { parent, name } = await parentAndName(segs);
  try { await parent.getDirectoryHandle(name); return 'directory'; } catch {}
  try { await parent.getFileHandle(name); return 'file'; } catch {}
  return null;
}

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.next', 'venv', '.venv', '.DS_Store']);
const CYAN = s => `\x1b[36m${s}\x1b[0m`, RED = s => `\x1b[31m${s}\x1b[0m`, DIM = s => `\x1b[90m${s}\x1b[0m`, GRN = s => `\x1b[32m${s}\x1b[0m`, YEL = s => `\x1b[33m${s}\x1b[0m`;
const globToRe = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
const human = n => n < 1024 ? n + 'B' : n < 1048576 ? (n / 1024).toFixed(1) + 'K' : (n / 1048576).toFixed(1) + 'M';

// ---- comandos: (args[], stdin) → stdout (string). Lanzan Error en fallo. ----
const CMDS = {
  help() {
    return 'Elffuss shell — opera sobre los ficheros REALES del proyecto:\n' +
      '  ' + GRN('ls') + ' [-la] [ruta]   ' + GRN('cd') + ' [ruta]     ' + GRN('pwd') + '        ' + GRN('tree') + ' [ruta]\n' +
      '  ' + GRN('cat') + ' <f...>        ' + GRN('head') + '/' + GRN('tail') + ' [-n N] ' + GRN('wc') + ' [-l]    ' + GRN('grep') + ' [-in] <patrón> [ruta]\n' +
      '  ' + GRN('find') + ' [ruta] [-name g]  ' + GRN('echo') + ' <txt> [> f]  ' + GRN('mkdir') + '/' + GRN('touch') + '/' + GRN('rm') + ' [-r]/' + GRN('mv') + '/' + GRN('cp') + '\n' +
      '  ' + GRN('open') + ' <f> (en el editor)  ' + GRN('git') + ' status|log|branch   ' + GRN('history') + '   ' + GRN('clear') + '\n' +
      '  Soporta tuberías ' + YEL('|') + ' y redirección ' + YEL('>') + ' ' + YEL('>>') + '.  ' +
      (capabilities().webcontainers ? GRN('node/npm disponibles.') : DIM('node/npm: requieren WebContainers (aislamiento cross-origin).'));
  },
  pwd() { return cwdString(); },
  async cd(args) {
    const target = args.find(a => !a.startsWith('-'));
    if (!target || target === '~') { cwd = []; return ''; }
    const segs = resolve(target);
    if (await kindOf(segs) !== 'directory') throw new Error(`cd: no existe el directorio: ${target}`);
    cwd = segs; return '';
  },
  async ls(args) {
    const long = args.some(a => /^-\w*l/.test(a)), all = args.some(a => /^-\w*a/.test(a));
    const target = args.find(a => !a.startsWith('-')) || '';
    const segs = resolve(target);
    const k = await kindOf(segs);
    if (k === 'file') return target;                       // ls de un fichero
    if (k !== 'directory') throw new Error(`ls: no existe: ${target || '.'}`);
    const dir = await dirHandle(segs);
    const rows = [];
    for await (const e of dir.values()) {
      if (!all && (e.name.startsWith('.') || IGNORE.has(e.name))) continue;
      rows.push(e);
    }
    rows.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1) : a.name.localeCompare(b.name)));
    if (!long) return rows.map(e => e.kind === 'directory' ? CYAN(e.name + '/') : e.name).join('  ');
    const out = [];
    for (const e of rows) {
      if (e.kind === 'directory') out.push(`${DIM('dir ')}      -  ${CYAN(e.name + '/')}`);
      else { const f = await e.getFile(); out.push(`${DIM('file')} ${human(f.size).padStart(6)}  ${e.name}`); }
    }
    return out.join('\n');
  },
  async cat(args, stdin) {
    const files = args.filter(a => !a.startsWith('-'));
    if (!files.length) return stdin;
    const parts = [];
    for (const f of files) {
      try { parts.push(await readText(resolve(f))); }
      catch { throw new Error(`cat: ${f}: no existe`); }
    }
    return parts.join('');
  },
  async head(args, stdin) {
    const n = +(args[args.indexOf('-n') + 1]) || 10;
    const f = args.find(a => !a.startsWith('-') && !/^\d+$/.test(a));
    const text = f ? await readText(resolve(f)) : stdin;
    return text.split('\n').slice(0, n).join('\n');
  },
  async tail(args, stdin) {
    const n = +(args[args.indexOf('-n') + 1]) || 10;
    const f = args.find(a => !a.startsWith('-') && !/^\d+$/.test(a));
    const text = f ? await readText(resolve(f)) : stdin;
    const lines = text.split('\n'); return lines.slice(Math.max(0, lines.length - n)).join('\n');
  },
  async wc(args, stdin) {
    const onlyLines = args.includes('-l');
    const f = args.find(a => !a.startsWith('-'));
    const text = f ? await readText(resolve(f)) : stdin;
    const lines = text === '' ? 0 : text.split('\n').length;
    if (onlyLines) return String(lines);
    const words = (text.match(/\S+/g) || []).length;
    return `${lines}\t${words}\t${text.length}${f ? '\t' + f : ''}`;
  },
  async tree(args) {
    const target = args.find(a => !a.startsWith('-')) || '';
    return code.tree({ path: resolve(target).join('/'), depth: 3 });
  },
  async grep(args, stdin) {
    const insensitive = args.some(a => /^-\w*i/.test(a)), numbers = args.some(a => /^-\w*n/.test(a));
    const rest = args.filter(a => !a.startsWith('-'));
    const pattern = rest.shift();
    if (!pattern) throw new Error('grep: falta el patrón');
    const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), insensitive ? 'i' : '');
    const hit = (line, i, prefix = '') => (prefix ? CYAN(prefix) + ':' : '') + (numbers ? DIM(i + 1 + ':') : '') + line.replace(re, m => `\x1b[1;31m${m}\x1b[0m`);
    if (!rest.length) {                                   // desde stdin (tubería)
      return stdin.split('\n').map((l, i) => re.test(l) ? hit(l, i) : null).filter(x => x != null).join('\n');
    }
    const out = []; let scanned = 0;
    const scanText = (text, label) =>
      text.split('\n').forEach((l, i) => { if (re.test(l) && out.length < 400) out.push(hit(l, i, label)); });
    for (const target of rest) {
      const segs = resolve(target);
      const k = await kindOf(segs);
      if (k === 'file') scanText(await readText(segs).catch(() => ''), target);
      else if (k === 'directory') {                       // recursivo
        const walk = async (dir, prefix) => {
          for await (const e of dir.values()) {
            if (IGNORE.has(e.name) || out.length >= 400 || scanned > 600) continue;
            const p = prefix ? prefix + '/' + e.name : e.name;
            if (e.kind === 'directory') { await walk(e, p); continue; }
            const f = await e.getFile();
            if (f.size < 400_000) { scanned++; scanText(await f.text(), (target === '.' ? '' : target.replace(/\/$/, '') + '/') + p); }
          }
        };
        await walk(await dirHandle(segs), '');
      } else throw new Error(`grep: ${target}: no existe`);
    }
    return out.join('\n') || DIM('(sin coincidencias)');
  },
  async find(args) {
    const nameIdx = args.indexOf('-name');
    const glob = nameIdx >= 0 ? globToRe(args[nameIdx + 1]) : null;
    const start = args.find(a => !a.startsWith('-') && a !== (nameIdx >= 0 ? args[nameIdx + 1] : null)) || '.';
    const out = []; let count = 0;
    const walk = async (dir, prefix) => {
      for await (const e of dir.values()) {
        if (IGNORE.has(e.name) || count > 2000) continue;
        const p = prefix ? prefix + '/' + e.name : e.name;
        count++;
        if (!glob || glob.test(e.name)) out.push(e.kind === 'directory' ? CYAN(p) : p);
        if (e.kind === 'directory') await walk(e, p);
      }
    };
    const segs = resolve(start === '.' ? '' : start);
    if (await kindOf(segs) !== 'directory') throw new Error(`find: ${start}: no es un directorio`);
    await walk(await dirHandle(segs), start === '.' ? '' : start);
    return out.join('\n') || DIM('(nada)');
  },
  echo(args) { return args.join(' ').replace(/^["']|["']$/g, ''); },
  async mkdir(args) {
    const t = args.find(a => !a.startsWith('-')); if (!t) throw new Error('mkdir: falta el nombre');
    await dirHandle(resolve(t), { create: true }); onFsChange(); return '';
  },
  async touch(args) {
    const t = args.find(a => !a.startsWith('-')); if (!t) throw new Error('touch: falta el nombre');
    const segs = resolve(t);
    if (await kindOf(segs) == null) await writeText(segs, ''); else onFsChange();
    return '';
  },
  async rm(args) {
    const recursive = args.some(a => /^-\w*r/.test(a));
    const t = args.find(a => !a.startsWith('-')); if (!t) throw new Error('rm: falta la ruta');
    const segs = resolve(t); const k = await kindOf(segs);
    if (k == null) throw new Error(`rm: ${t}: no existe`);
    if (k === 'directory' && !recursive) throw new Error(`rm: ${t}: es un directorio (usa -r)`);
    const { parent, name } = await parentAndName(segs);
    await parent.removeEntry(name, { recursive });
    code.invalidateFileList?.(); onFsChange(); return '';
  },
  async cp(args) {
    const rest = args.filter(a => !a.startsWith('-'));
    const [src, dst] = rest; if (!src || !dst) throw new Error('cp: uso: cp <origen> <destino>');
    await copyPath(resolve(src), resolve(dst)); onFsChange(); return '';
  },
  async mv(args) {
    const rest = args.filter(a => !a.startsWith('-'));
    const [src, dst] = rest; if (!src || !dst) throw new Error('mv: uso: mv <origen> <destino>');
    await copyPath(resolve(src), resolve(dst));
    const { parent, name } = await parentAndName(resolve(src));
    await parent.removeEntry(name, { recursive: true });
    code.invalidateFileList?.(); onFsChange(); return '';
  },
  async open(args) {
    const t = args.find(a => !a.startsWith('-')); if (!t) throw new Error('open: falta el fichero');
    const segs = resolve(t);
    if (await kindOf(segs) !== 'file') throw new Error(`open: ${t}: no es un fichero`);
    onOpenFile(segs.join('/')); return DIM(`abriendo ${segs.join('/')} en el editor…`);
  },
  history() { return history.map((h, i) => `${DIM((i + 1) + '')}  ${h}`).join('\n'); },
  whoami() { return 'elffuss'; },
  date() { return new Date().toString(); },
  clear() { return '\f'; },                               // la UI lo interpreta
  async git(args) {
    const sub = args[0];
    const info = await code.gitInfo();
    if (!info.isRepo) return DIM('no es un repositorio git (no hay .git)');
    if (sub === 'branch' || !sub) return '* ' + GRN(info.branch);
    if (sub === 'status') return `En la rama ${GRN(info.branch)}\n` + (info.lastCommit ? DIM(`último commit: ${info.lastCommit.msg}`) : DIM('sin commits todavía')) + '\n' + DIM('(git de solo lectura; commit/push reales necesitan WebContainers)');
    if (sub === 'log') return info.lastCommit ? `${YEL('commit ' + info.branch)}\nAutor: ${info.lastCommit.author}\nFecha: ${new Date(info.lastCommit.when).toLocaleString()}\n\n    ${info.lastCommit.msg}` : DIM('sin commits');
    return DIM(`git ${sub}: de solo lectura aquí. Runtime real → WebContainers (aislamiento cross-origin).`);
  },
};
// runtimes que aún no viven en el navegador sin WebContainers
for (const r of ['node', 'npm', 'npx', 'python', 'python3', 'pip', 'yarn', 'pnpm', 'bun', 'deno', 'cargo', 'go'])
  CMDS[r] = () => { throw new Error(`${r}: runtime real no disponible sin WebContainers.\n${DIM('Necesita aislamiento cross-origin (cabeceras COOP+COEP). Mientras tanto, la elfa edita ficheros y tú navegas el proyecto con los comandos de arriba (help).')}`); };

// copia recursiva por handles (la File System API no tiene move nativo)
async function copyPath(srcSegs, dstSegs) {
  const k = await kindOf(srcSegs);
  if (k == null) throw new Error('origen no existe');
  if (k === 'file') { await writeText(dstSegs, await readText(srcSegs)); return; }
  const src = await dirHandle(srcSegs);
  await dirHandle(dstSegs, { create: true });
  for await (const e of src.values()) await copyPath([...srcSegs, e.name], [...dstSegs, e.name]);
}

// ---- parser: tuberías, redirección, comillas ----
function splitTop(line, sep) {          // parte por `sep` respetando comillas
  const parts = []; let cur = '', q = '';
  for (const ch of line) {
    if (q) { cur += ch; if (ch === q) q = ''; }
    else if (ch === '"' || ch === "'") { q = ch; cur += ch; }
    else if (ch === sep) { parts.push(cur); cur = ''; }
    else cur += ch;
  }
  parts.push(cur); return parts;
}
function tokenize(seg) {
  const toks = []; let cur = '', q = '';
  for (const ch of seg.trim()) {
    if (q) { if (ch === q) q = ''; else cur += ch; }
    else if (ch === '"' || ch === "'") q = ch;
    else if (/\s/.test(ch)) { if (cur) { toks.push(cur); cur = ''; } }
    else cur += ch;
  }
  if (cur) toks.push(cur);
  return toks;
}

// Ejecuta una línea completa (encadenado &&/;, tuberías, redirección).
// `\f` en el retorno = orden de limpiar pantalla (para la UI).
export async function exec(line, { record = true } = {}) {
  line = line.trim();
  if (!line) return '';
  if (record) history.push(line);
  const segments = tokenizeChain(line);
  if (segments.length === 1) return runPipeline(segments[0].cmd);
  // encadenado: A && B (B solo si A fue bien) · A ; B (B siempre)
  const outs = []; let ok = true;
  for (const { cmd, op } of segments) {
    if (op === '&&' && !ok) continue;
    try { outs.push(await runPipeline(cmd)); ok = true; }
    catch (e) { ok = false; outs.push('\x1b[31m' + (e && e.message || e) + '\x1b[0m'); }
  }
  if (outs.every(o => o === '\f')) return '\f';
  return outs.filter(o => o && o !== '\f').join('\n');
}

// Divide la línea en segmentos con su operador previo (&& / ; ), respetando comillas.
function tokenizeChain(line) {
  const segs = []; let cur = '', q = '', op = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '&' && line[i + 1] === '&') { segs.push({ cmd: cur.trim(), op }); op = '&&'; cur = ''; i++; continue; }
    if (ch === ';') { segs.push({ cmd: cur.trim(), op }); op = ';'; cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) segs.push({ cmd: cur.trim(), op });
  return segs.filter(s => s.cmd);
}

// Ejecuta un pipeline (una etapa o varias unidas por |, con redirección final).
async function runPipeline(line) {
  const stages = splitTop(line, '|').map(s => s.trim()).filter(Boolean);
  let data = '';
  for (let i = 0; i < stages.length; i++) {
    let seg = stages[i], redir = null;
    if (i === stages.length - 1) {
      const m = seg.match(/(>>?)\s*(\S+)\s*$/);
      if (m) { redir = { append: m[1] === '>>', file: m[2] }; seg = seg.slice(0, m.index); }
    }
    const toks = tokenize(seg);
    const name = toks.shift();
    if (!name) continue;
    const fn = CMDS[name];
    if (!fn) throw new Error(`${name}: comando no encontrado (prueba ${GRN('help')})`);
    data = (await fn(toks, data)) ?? '';
    if (redir) {
      const segs = resolve(redir.file);
      const prev = redir.append ? await readText(segs).catch(() => '') : '';
      await writeText(segs, prev + stripAnsi(data));
      data = '';
    }
  }
  return data;
}

export const stripAnsi = s => String(s).replace(/\x1b\[[0-9;]*m/g, '');

// Entradas de un directorio (para el completado con Tab del terminal).
export async function listDir(dirPart = '') {
  const dir = await dirHandle(resolve(dirPart));
  const out = [];
  for await (const e of dir.values()) if (!IGNORE.has(e.name)) out.push({ name: e.name, kind: e.kind });
  return out;
}

// Ejecuta una orden desde la elfa (tool terminal.run): devuelve texto plano.
export async function runForAgent(command) {
  const out = await exec(command, { record: true });
  return out === '\f' ? '(pantalla limpiada)' : (stripAnsi(out) || '(sin salida)');
}

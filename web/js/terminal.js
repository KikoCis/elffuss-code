// Terminal de Elffuss Code: xterm.js (VT100 real) + un readline propio que
// ejecuta contra shell.js (los ficheros REALES del proyecto). xterm no trae
// shell: nosotros gestionamos la línea (edición, historial, cursor) y delegamos
// la ejecución en shell.exec. La misma orden la puede lanzar la elfa vía el
// tool `terminal.run`, y su salida aparece aquí.
import * as shell from './shell.js';

let term = null, fit = null, ready = false;
let Terminal = null, FitAddon = null;
let line = '', pos = 0, histIdx = -1, busy = false;
const XT = '@xterm/xterm@5.5.0', FIT = '@xterm/addon-fit@0.10.0';

// IMPORTANTE: cargamos xterm como ESM, no UMD. Monaco trae un loader AMD
// (define/require) y la build UMD de xterm se registra como «define anónimo»
// en vez de exponer window.Terminal → «Can only have one anonymous define».
// El import ESM esquiva por completo el define de Monaco.
async function loadXterm() {
  if (Terminal) return;
  if (!document.getElementById('xterm-css')) {
    const l = document.createElement('link');
    l.id = 'xterm-css'; l.rel = 'stylesheet'; l.href = `https://cdn.jsdelivr.net/npm/${XT}/css/xterm.min.css`;
    document.head.appendChild(l);
  }
  const [xt, ft] = await Promise.all([
    import(`https://cdn.jsdelivr.net/npm/${XT}/+esm`),
    import(`https://cdn.jsdelivr.net/npm/${FIT}/+esm`),
  ]);
  Terminal = xt.Terminal || (xt.default && xt.default.Terminal);
  FitAddon = ft.FitAddon || (ft.default && ft.default.FitAddon) || ft.default;
}

const prompt = () => `\x1b[36m${shell.cwdString()}\x1b[0m \x1b[35m❯\x1b[0m `;
const writePrompt = () => term.write('\r\n' + prompt());
// Redibuja la línea de entrada (prompt + buffer) y coloca el cursor en `pos`.
function redraw() {
  term.write('\r\x1b[K' + prompt() + line);
  const back = line.length - pos;
  if (back > 0) term.write(`\x1b[${back}D`);
}

async function run(raw) {
  const cmd = raw.trim();
  if (!cmd) { writePrompt(); return; }
  busy = true;
  try {
    const out = await shell.exec(cmd);
    if (out === '\f') term.clear();
    else if (out) term.write('\r\n' + out.replace(/\n/g, '\r\n'));
  } catch (e) {
    term.write('\r\n\x1b[31m' + String(e && e.message || e).replace(/\n/g, '\r\n') + '\x1b[0m');
  }
  busy = false;
  writePrompt();
}

function onKey(data) {
  if (busy) return;
  switch (data) {
    case '\r':                                     // Enter
      { const cmd = line; line = ''; pos = 0; histIdx = -1; run(cmd); return; }
    case '\x7f':                                   // Retroceso
      if (pos > 0) { line = line.slice(0, pos - 1) + line.slice(pos); pos--; redraw(); } return;
    case '\x1b[3~':                                // Supr
      if (pos < line.length) { line = line.slice(0, pos) + line.slice(pos + 1); redraw(); } return;
    case '\x03':                                   // Ctrl+C
      term.write('^C'); line = ''; pos = 0; histIdx = -1; writePrompt(); return;
    case '\x0c':                                   // Ctrl+L
      term.clear(); redraw(); return;
    case '\x1b[A': case '\x1b[B': {                // arriba / abajo: historial
      const h = shell.getHistory(); if (!h.length) return;
      if (histIdx === -1) histIdx = h.length;
      histIdx = Math.max(0, Math.min(h.length, histIdx + (data === '\x1b[A' ? -1 : 1)));
      line = h[histIdx] || ''; pos = line.length; redraw(); return;
    }
    case '\x1b[C': if (pos < line.length) { pos++; term.write('\x1b[C'); } return;   // derecha
    case '\x1b[D': if (pos > 0) { pos--; term.write('\x1b[D'); } return;             // izquierda
    case '\x1b[H': case '\x01': pos = 0; redraw(); return;             // Inicio / Ctrl+A
    case '\x1b[F': case '\x05': pos = line.length; redraw(); return;   // Fin / Ctrl+E
    case '\t': complete(); return;                 // Tab: completar rutas
  }
  if (data.length !== 1 || data.charCodeAt(0) < 32) return;  // control/escape: ignorar
  line = line.slice(0, pos) + data + line.slice(pos); pos += data.length; redraw();
}

// Completado de rutas simple: mira el último token contra el directorio actual.
async function complete() {
  const frag = (line.slice(0, pos).split(/\s+/).pop()) || '';
  const slash = frag.lastIndexOf('/');
  const dirPart = slash >= 0 ? frag.slice(0, slash + 1) : '';
  const base = slash >= 0 ? frag.slice(slash + 1) : frag;
  let names;
  try { names = await shell.listDir(dirPart); } catch { return; }
  const matches = names.filter(n => n.name.startsWith(base));
  if (matches.length === 1) {
    const add = matches[0].name.slice(base.length) + (matches[0].kind === 'directory' ? '/' : ' ');
    line = line.slice(0, pos) + add + line.slice(pos); pos += add.length; redraw();
  } else if (matches.length > 1) {
    term.write('\r\n' + matches.map(m => m.kind === 'directory' ? '\x1b[36m' + m.name + '/\x1b[0m' : m.name).join('  '));
    writePrompt(); term.write(line); if (line.length - pos > 0) term.write(`\x1b[${line.length - pos}D`);
  }
}

// Monta el terminal en `host` (una vez). Idempotente; refoca si ya existe.
export async function mount(host) {
  if (ready) { setTimeout(() => { fit && fit.fit(); term && term.focus(); }, 0); return; }
  await loadXterm();
  term = new Terminal({
    fontSize: 12.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    cursorBlink: true, convertEol: false, scrollback: 2000,
    theme: { background: '#0b0d12', foreground: '#e8ebf4', cursor: '#ff4d8d', selectionBackground: '#7c5cff55',
      brightBlack: '#6b7280', red: '#ff6b8b', green: '#7ee787', yellow: '#ffd479', blue: '#7c5cff', magenta: '#ff4d8d', cyan: '#56d4dd' },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);
  fit.fit();
  host.addEventListener('mousedown', () => setTimeout(() => term.focus(), 0));
  term.onData(onKey);
  const cap = shell.capabilities();
  term.write('\x1b[1;35mElffuss shell\x1b[0m \x1b[90m— ficheros reales del proyecto, en tu navegador.\x1b[0m');
  term.write('\r\n\x1b[90m' + (cap.webcontainers ? 'WebContainers activo: node/npm reales.' : 'Escribe \x1b[0m\x1b[32mhelp\x1b[0m\x1b[90m. node/npm reales → WebContainers (aislamiento cross-origin).') + '\x1b[0m');
  writePrompt();
  ready = true;
  setTimeout(() => term.focus(), 0);
}

export function refit() { if (ready) setTimeout(() => fit && fit.fit(), 0); }
export function focus() { if (ready) term.focus(); }
export function isReady() { return ready; }
export function clearScreen() { if (ready) { term.clear(); line = ''; pos = 0; term.write('\r\x1b[K' + prompt()); term.focus(); } }

// Eco de una orden lanzada por la elfa (para que el usuario la vea en el terminal).
export function echoAgent(cmd, out) {
  if (!ready) return;
  term.write('\r\x1b[K' + prompt() + '\x1b[90m' + cmd + '  (elfa)\x1b[0m');
  if (out) term.write('\r\n' + shell.stripAnsi(out).replace(/\n/g, '\r\n'));
  writePrompt(); term.write(line);
}

// Cliente del Elffuss Bridge: puente local (proceso que el usuario descarga y
// ejecuta) que da ejecución REAL en su máquina (node, npm, python…) sin salir
// de ella. Protocolo por WebSocket a 127.0.0.1, con token de un solo arranque.
const PORT = 8765;
const HOST = '127.0.0.1:' + PORT;

let ws = null, connected = false, authed = false;
let pending = new Map(); // id → { onOut, onErr, resolve }
let nextId = 1;
let onStatus = () => {};
let savedFolder = '';
try { savedFolder = localStorage.getItem('elffusscode.bridgeFolder') || ''; } catch { /* */ }
let savedToken = '';
try { savedToken = localStorage.getItem('elffusscode.bridgeToken') || ''; } catch { /* */ }

export function isConnected() { return connected && authed; }
export function getFolder() { return savedFolder; }
export function setFolder(f) {
  savedFolder = (f || '').trim();
  try { localStorage.setItem('elffusscode.bridgeFolder', savedFolder); } catch { /* */ }
}
export function onStatusChange(fn) { onStatus = fn; }

// sondeo ligero: ¿hay un bridge escuchando en 127.0.0.1, aunque no nos hayamos
// autenticado todavía? (para saber si mostrar «detectado» antes de conectar)
export async function probe() {
  try {
    const r = await fetch('http://' + HOST + '/ping', { mode: 'cors' });
    if (!r.ok) return false;
    const j = await r.json();
    return !!j.ok;
  } catch { return false; }
}

export function connect(token) {
  return new Promise((resolve, reject) => {
    try { ws = new WebSocket('ws://' + HOST + '/ws'); }
    catch (e) { reject(e); return; }
    const timeout = setTimeout(() => { try { ws.close(); } catch { /* */ } reject(new Error('tiempo agotado — ¿está el bridge arrancado?')); }, 6000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
    ws.onerror = () => { clearTimeout(timeout); connected = false; authed = false; onStatus('error'); reject(new Error('no pude conectar — ¿está el bridge arrancado en este puerto?')); };
    ws.onclose = () => { connected = false; authed = false; onStatus('disconnected'); };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'auth-ok') {
        clearTimeout(timeout);
        connected = true; authed = true;
        savedToken = token;
        try { localStorage.setItem('elffusscode.bridgeToken', token); } catch { /* */ }
        onStatus('connected');
        resolve(true);
        return;
      }
      if (m.type === 'auth-fail') { clearTimeout(timeout); connected = true; authed = false; onStatus('auth-fail'); reject(new Error('token incorrecto')); return; }
      const job = pending.get(m.id);
      if (!job) return;
      if (m.type === 'stdout') job.onOut(m.data);
      else if (m.type === 'stderr') job.onErr(m.data);
      else if (m.type === 'error') { job.onErr(m.data); job.resolve(-1); pending.delete(m.id); }
      else if (m.type === 'exit') { job.resolve(m.code || 0); pending.delete(m.id); }
    };
  });
}

export function disconnect() { try { ws?.close(); } catch { /* */ } connected = false; authed = false; }

// tratar de reconectar en silencio con el token guardado (al abrir la app)
export async function tryAutoConnect() {
  if (!savedToken) return false;
  try { await connect(savedToken); return true; } catch { return false; }
}

// Detección continua en segundo plano: si el usuario arranca el bridge
// DESPUÉS de cargar la página (o lo reinicia tras cerrarlo), esto lo detecta
// solo y reconecta con el token guardado — sin que haga falta reabrir Ajustes
// y pulsar «Conectar» de nuevo. Se apoya en probe() (sondeo ligero sin auth).
let autoDetectTimer = null, connecting = false;
export function startAutoDetect(intervalMs = 4000) {
  if (autoDetectTimer) return () => stopAutoDetect();
  autoDetectTimer = setInterval(async () => {
    if (isConnected() || connecting || !savedToken) return;
    if (!(await probe())) return;
    connecting = true;
    try { await connect(savedToken); } catch { /* el usuario aún no ha pegado token válido, o cayó de nuevo */ }
    finally { connecting = false; }
  }, intervalMs);
  return () => stopAutoDetect();
}
export function stopAutoDetect() { clearInterval(autoDetectTimer); autoDetectTimer = null; }

// ejecuta un comando REAL en la máquina del usuario, vía el bridge.
// onOut/onErr reciben trozos de salida en vivo; devuelve el código de salida.
export function exec(cmd, { cwd = savedFolder, onOut = () => {}, onErr = () => {} } = {}) {
  if (!isConnected()) return Promise.reject(new Error('bridge no conectado'));
  const id = String(nextId++);
  return new Promise((resolve, reject) => {
    pending.set(id, { onOut, onErr, resolve });
    try { ws.send(JSON.stringify({ type: 'exec', id, cmd, cwd })); }
    catch (e) { pending.delete(id); reject(e); }
  });
}

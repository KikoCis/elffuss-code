// Cliente del Elffuss Bridge: puente local (proceso que el usuario descarga y
// ejecuta) que da ejecución REAL en su máquina (node, npm, python…) sin salir
// de ella. Protocolo por WebSocket a 127.0.0.1, con token de un solo arranque.
const PORT = 8765;
const HOST = '127.0.0.1:' + PORT;

let ws = null, connected = false, authed = false;
let pending = new Map(); // id → { onOut, onErr, sock, terminar }
let nextId = 1;
// Varios pueden querer saber si el bridge conecta o cae (Ajustes, la etiqueta
// del terminal…). Antes había UN solo oyente y cada uno pisaba al anterior.
const oyentes = new Set();
const onStatus = (s) => { for (const f of oyentes) { try { f(s); } catch { /* */ } } };
// «Desconectar» a propósito: la autodetección no vuelve a conectar sola hasta
// que se pulse «Conectar» otra vez (antes reconectaba a los pocos segundos).
// Se GUARDA: solo en memoria, al recargar tryAutoConnect() volvía a conectar con
// el token guardado, y el aviso decía «no se volverá a conectar solo hasta que
// pulses Conectar».
const CLAVE_PAUSA = 'elffusscode.bridgePaused';
let pausado = false;
try { pausado = localStorage.getItem(CLAVE_PAUSA) === '1'; } catch { /* */ }
const guardaPausa = v => { try { if (v) localStorage.setItem(CLAVE_PAUSA, '1'); else localStorage.removeItem(CLAVE_PAUSA); } catch { /* */ } };
let savedFolder = '';
try { savedFolder = localStorage.getItem('elffusscode.bridgeFolder') || ''; } catch { /* */ }
let savedToken = '';
try { savedToken = localStorage.getItem('elffusscode.bridgeToken') || ''; } catch { /* */ }

export function isConnected() { return connected && authed; }

// La versión que se descarga desde esta web (web/bridge-dl). Desde la 1.1.2,
// parar un comando mata también lo que ese comando arrancó (un «npm run dev»,
// un servidor, «a; b») y cerrar la conexión mata lo que quedara corriendo. Con
// una anterior el agente y el terminal lo dan por parado, pero el proceso sigue
// vivo en la máquina: hay que decirle al usuario que la actualice. El bridge
// dice su versión en /ping desde siempre; antes nadie la miraba.
export const VERSION_ACTUAL = '1.1.2';
let versionVista = null;
export function version() { return versionVista; }
const partesVersion = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
export function esViejo() {
  if (!versionVista) return false;
  const [a, b] = [partesVersion(versionVista), partesVersion(VERSION_ACTUAL)];
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  return false;
}
export function getFolder() { return savedFolder; }
export function setFolder(f) {
  savedFolder = (f || '').trim();
  try { localStorage.setItem('elffusscode.bridgeFolder', savedFolder); } catch { /* */ }
}
// Devuelve la función para dejar de escuchar.
export function onStatusChange(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }

// sondeo ligero: ¿hay un bridge escuchando en 127.0.0.1, aunque no nos hayamos
// autenticado todavía? (para saber si mostrar «detectado» antes de conectar)
export async function probe() {
  try {
    const r = await fetch('http://' + HOST + '/ping', { mode: 'cors' });
    if (!r.ok) return false;
    const j = await r.json();
    if (j.version) versionVista = String(j.version);
    return !!j.ok;
  } catch { return false; }
}

export function connect(token) {
  pausado = false; guardaPausa(false);
  return new Promise((resolve, reject) => {
    let sock;
    try { sock = ws = new WebSocket('ws://' + HOST + '/ws'); }
    catch (e) { reject(e); return; }
    const timeout = setTimeout(() => { try { sock.close(); } catch { /* */ } reject(new Error('tiempo agotado — ¿está el bridge arrancado?')); }, 6000);
    sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', token }));
    sock.onerror = () => { clearTimeout(timeout); connected = false; authed = false; onStatus('error'); reject(new Error('no pude conectar — ¿está el bridge arrancado en este puerto? Si lo descargaste antes de la versión 1.1.1, descárgalo otra vez: los anteriores no aceptan la dirección nueva de Elffuss Code.')); };
    sock.onclose = () => {
      // Lo que corría por ESTE socket ya no va a recibir nunca su «exit»: se
      // cierra aquí. Antes quedaba pendiente para siempre, y con él el turno del
      // agente o el terminal que lo esperaba.
      cerrarTrabajos(sock);
      if (ws !== sock) return;   // un socket viejo que se cierra no desconecta al nuevo
      connected = false; authed = false; onStatus('disconnected');
    };
    sock.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'auth-ok') {
        clearTimeout(timeout);
        connected = true; authed = true;
        savedToken = token;
        try { localStorage.setItem('elffusscode.bridgeToken', token); } catch { /* */ }
        onStatus('connected');
        resolve(true);
        // Qué versión es (para avisar si es vieja): se avisa otra vez al saberlo.
        probe().then(() => { if (ws === sock && isConnected()) onStatus('version'); }).catch(() => {});
        return;
      }
      if (m.type === 'auth-fail') { clearTimeout(timeout); connected = true; authed = false; onStatus('auth-fail'); reject(new Error('token incorrecto')); return; }
      const job = pending.get(m.id);
      if (!job) return;   // p. ej. la salida tardía de un comando ya parado
      if (m.type === 'stdout') job.onOut(m.data);
      else if (m.type === 'stderr') job.onErr(m.data);
      else if (m.type === 'error') { job.onErr(m.data); job.terminar(-1); }
      else if (m.type === 'exit') job.terminar(m.code || 0);
    };
  });
}

export function disconnect() {
  pausado = true; guardaPausa(true);
  try { ws?.close(); } catch { /* */ }
  connected = false; authed = false;
  onStatus('disconnected');
}
// Olvidar el token guardado: desconecta y ya no se reconecta solo.
export function forgetToken() {
  savedToken = '';
  try { localStorage.removeItem('elffusscode.bridgeToken'); } catch { /* */ }
  disconnect();
}
export function hasSavedToken() { return !!savedToken; }

// Lo que conecta SOLO (al abrir, o al detectar el bridge) no lo hace si el
// usuario desconectó a propósito; connect() a secas es el botón «Conectar».
function connectAuto(token) { return pausado ? Promise.reject(new Error('pausado')) : connect(token); }

// tratar de reconectar en silencio con el token guardado (al abrir la app)
export async function tryAutoConnect() {
  if (!savedToken || pausado) return false;
  try { await connectAuto(savedToken); return true; } catch { return false; }
}

// Detección continua en segundo plano: si el usuario arranca el bridge
// DESPUÉS de cargar la página (o lo reinicia tras cerrarlo), esto lo detecta
// solo y reconecta con el token guardado — sin que haga falta reabrir Ajustes
// y pulsar «Conectar» de nuevo. Se apoya en probe() (sondeo ligero sin auth).
let autoDetectTimer = null, connecting = false;
export function startAutoDetect(intervalMs = 4000) {
  if (autoDetectTimer) return () => stopAutoDetect();
  autoDetectTimer = setInterval(async () => {
    if (isConnected() || connecting || !savedToken || pausado) return;
    if (!(await probe())) return;
    connecting = true;
    try { await connectAuto(savedToken); } catch { /* el usuario aún no ha pegado token válido, o cayó de nuevo */ }
    finally { connecting = false; }
  }, intervalMs);
  return () => stopAutoDetect();
}
export function stopAutoDetect() { clearInterval(autoDetectTimer); autoDetectTimer = null; }

// Cierra los trabajos que corrían por un socket que se ha caído.
function cerrarTrabajos(sock) {
  for (const job of [...pending.values()]) {
    if (job.sock !== sock) continue;
    try { job.onErr('\n[bridge desconectado]\n'); } catch { /* quien escucha ya no está */ }
    job.terminar(-1);
  }
}

// Código de salida de un comando parado a mano, el mismo que da una shell con
// Ctrl+C (128 + SIGINT). Y el de un comando que agota su tiempo, el de timeout(1).
const PARADO = 130, SIN_TIEMPO = 124;

// ejecuta un comando REAL en la máquina del usuario, vía el bridge.
// onOut/onErr reciben trozos de salida en vivo; devuelve el código de salida.
//
// `signal` y `timeoutMs` lo PARAN: se le pide al bridge que mate el proceso
// ({type:'stop', id}, ya lo entendía) y se resuelve en el acto con 130 (124 si
// fue el tiempo). Antes no había forma de cortar un comando: parar el agente
// dejaba un `npm install` o un servidor corriendo en tu máquina, y el turno
// esperándolo.
export function exec(cmd, { cwd = savedFolder, onOut = () => {}, onErr = () => {}, signal = null, timeoutMs = 0 } = {}) {
  if (!isConnected()) return Promise.reject(new Error('bridge no conectado'));
  if (signal?.aborted) return Promise.resolve(PARADO);
  const id = String(nextId++);
  const sock = ws;
  return new Promise((resolve, reject) => {
    let timer = null;
    const terminar = code => {
      if (pending.get(id) !== job) return;   // ya resuelto
      pending.delete(id);
      clearTimeout(timer);
      signal?.removeEventListener('abort', alAbortar);
      resolve(code);
    };
    const parar = code => {
      try { sock.send(JSON.stringify({ type: 'stop', id })); } catch { /* socket cerrado: el proceso ya no es nuestro */ }
      terminar(code);
    };
    const alAbortar = () => parar(PARADO);
    const job = { onOut, onErr, sock, terminar };
    pending.set(id, job);
    try { sock.send(JSON.stringify({ type: 'exec', id, cmd, cwd })); }
    catch (e) { pending.delete(id); reject(e); return; }
    signal?.addEventListener('abort', alAbortar, { once: true });
    if (timeoutMs > 0) timer = setTimeout(() => {
      try { onErr('\n[bridge: tiempo agotado, proceso parado]\n'); } catch { /* */ }
      parar(SIN_TIEMPO);
    }, timeoutMs);
  });
}

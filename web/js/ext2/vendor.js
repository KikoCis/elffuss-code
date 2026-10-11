// El bundle del nivel 2 (VS Code sin interfaz que corre el código de las
// extensiones): manifiesto, tamaño y descarga VERIFICADA.
//
// Cada fichero se baja con su SRI (el navegador rechaza un .gz distinto), se
// descomprime aquí con DecompressionStream y se comprueba la sha256 de los
// bytes crudos contra el manifiesto. Cualquier diferencia, o el interruptor
// «enabled: false» del manifiesto, para el nivel 2 sin arrancar nada a medias.
// Funciona aunque un proxy añada su propia compresión de transporte.

import { sandboxOrigin } from './config.js';

const MANIFIESTO = new URL('./vendor-manifest.json', import.meta.url);
const BASE = new URL('../../vendor/x2/', import.meta.url);
export const ROLES = ['main', 'extensionHostWorkerMain', 'editorWorkerService'];

const fallo = (code, msg, extra = {}) => Object.assign(new Error(msg), { code, ...extra });
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export function validManifest(m) {
  const ok = m && m.schema === 1 && typeof m.enabled === 'boolean' && /^[0-9a-f]{16}$/.test(m.buildId) && m.protocol === 1
    && Array.isArray(m.files) && m.files.length === ROLES.length
    && m.files.every(f => f && /^[a-z-]+\.js$/.test(f.name) && ROLES.includes(f.role)
      && Number.isSafeInteger(f.raw) && f.raw > 0 && Number.isSafeInteger(f.gz) && f.gz > 0
      && /^[0-9a-f]{64}$/.test(f.sha256Raw) && /^sha256-[A-Za-z0-9+/]{43}=$/.test(f.sriGz))
    && new Set(m.files.map(f => f.role)).size === ROLES.length;
  return !!ok;
}

let manifiesto = null;
export async function loadManifest({ signal } = {}) {
  manifiesto ??= (async () => {
    let r;
    try { r = await fetch(MANIFIESTO, { cache: 'no-cache', credentials: 'same-origin', signal }); }
    catch (e) { throw fallo('network', 'no pude leer el manifiesto del nivel 2: ' + (e?.message || e)); }
    if (!r.ok) throw fallo('network', 'manifiesto del nivel 2: HTTP ' + r.status);
    const m = await r.json().catch(() => null);
    if (!validManifest(m)) throw fallo('manifest', 'manifiesto del nivel 2 no válido');
    return m;
  })().catch(e => { manifiesto = null; throw e; });
  return manifiesto;
}

// Lo que se bajaría la primera vez (los .gz juntos), para enseñarlo ANTES.
export const runtimeBytes = m => m.files.reduce((n, f) => n + f.gz, 0);

async function inflar(gz) {
  const flujo = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(flujo).arrayBuffer();
}

// → [{ role, name, bytes: ArrayBuffer }] con los bytes crudos ya verificados
export async function loadVendor(m, { onProgress = () => {}, signal } = {}) {
  if (!m.enabled) throw fallo('disabled', 'el nivel 2 está desactivado en este despliegue');
  const total = runtimeBytes(m);
  let hecho = 0;
  return Promise.all(m.files.map(async f => {
    const url = new URL(`${m.buildId}/${f.name}.gz`, BASE);
    let r;
    try { r = await fetch(url, { integrity: f.sriGz, cache: 'default', credentials: 'same-origin', signal }); }
    catch (e) {
      if (e?.name === 'AbortError') throw e;
      // un SRI que no cuadra también acaba aquí (TypeError): se trata como integridad
      throw fallo('integrity', `${f.name}: no se pudo bajar o no coincide con su SRI`, { file: f.name });
    }
    if (!r.ok) throw fallo('network', `${f.name}: HTTP ${r.status}`, { file: f.name });
    const gz = await r.arrayBuffer();
    hecho += f.gz;
    onProgress(hecho, total);
    let bytes;
    try { bytes = await inflar(gz); } catch { throw fallo('integrity', `${f.name}: el .gz no se descomprime`, { file: f.name }); }
    if (bytes.byteLength !== f.raw || hex(await crypto.subtle.digest('SHA-256', bytes)) !== f.sha256Raw) {
      throw fallo('integrity', `${f.name}: la sha256 no coincide con el manifiesto`, { file: f.name });
    }
    return { role: f.role, name: f.name, bytes };
  }));
}

// ── ¿se puede aquí, y cuánto pesa? (lo que se enseña ANTES de encender nada) ──
export const RUNTIME_KEY = 'elffusscode.x2.runtime';

// v1: Chrome y Edge (ancestorOrigins para el apretón de manos, Navigation API
// para que el recinto no navegue, DecompressionStream para el bundle)
export function supported(w = globalThis) {
  try {
    return !!(w.location && 'ancestorOrigins' in w.location && w.navigation && typeof w.DecompressionStream === 'function'
      && w.crypto?.subtle && typeof w.MessageChannel === 'function' && w.HTMLElement && 'inert' in w.HTMLElement.prototype);
  } catch { return false; }
}
// ?noext apaga todas las extensiones; ?noext2, solo su código
export const disabledByUrl = (search = globalThis.location?.search || '') => /[?&]noext2?(?:[=&]|$)/.test(search);

export async function runtimeInfo() {
  if (disabledByUrl()) return { available: false, reason: 'url' };
  if (!supported()) return { available: false, reason: 'browser' };
  if (!sandboxOrigin()) return { available: false, reason: 'site' };
  const m = await loadManifest();
  if (!m.enabled) return { available: false, reason: 'off' };
  let cached = false;
  try { cached = localStorage.getItem(RUNTIME_KEY) === m.buildId; } catch { /* sin almacenamiento */ }
  return { available: true, bytes: runtimeBytes(m), buildId: m.buildId, cached };
}

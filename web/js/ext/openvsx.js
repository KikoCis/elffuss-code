// Cliente de Open VSX (open-vsx.org, de la Eclipse Foundation). La API, los
// ficheros sueltos y los .vsix mandan Access-Control-Allow-Origin: *, así que
// el navegador habla con Open VSX directamente: sin proxy, y nada de tu
// proyecto sale nunca hacia allí — solo lo que buscas y lo que instalas.
// (El Marketplace de Microsoft no se usa: sus términos solo permiten sus
// productos.)

export const BASE = 'https://open-vsx.org';
const ORIGENES_ICONO = new Set(['https://open-vsx.org', 'https://openvsx.eclipsecontent.org']);
export const BIG = 25 * 1024 * 1024;        // por encima, se pregunta antes de bajar
const MAX = 120 * 1024 * 1024;              // tope duro de un .vsix

// `code` lo traduce el panel; `status` y `mb` son datos para el mensaje.
class OpenVsxError extends Error {
  constructor(msg, code, extra = {}) { super(msg); this.code = code; Object.assign(this, extra); }
}

async function getJson(url, signal) {
  let res;
  try { res = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new OpenVsxError(e.message || 'sin red', 'net'); }
  if (res.status === 429) throw new OpenVsxError('Open VSX está limitando peticiones', 'rate');
  if (!res.ok) throw new OpenVsxError(`Open VSX respondió ${res.status}`, res.status === 404 ? 'notfound' : 'http', { status: res.status });
  return res.json();
}
// solo URLs de la propia API (las de ficheros redirigen después a su CDN)
function deOpenVsx(u) {
  try { const x = new URL(u); return x.origin === BASE ? x.href : null; } catch { return null; }
}
const seg = s => encodeURIComponent(String(s));

// «…/api/ns/name/<plataforma>/<versión>/file/x.vsix» → la plataforma, o ''
// (las publicadas por plataforma no tienen package.json en la ruta sin ella)
function plataformaDe(download) {
  try {
    const p = new URL(download).pathname.split('/').filter(Boolean);
    return p[0] === 'api' && p.length === 7 && p[5] === 'file' && /^[a-z0-9-]+$/.test(p[3]) ? p[3] : '';
  } catch { return ''; }
}
const resumen = e => ({
  namespace: String(e.namespace || ''), name: String(e.name || ''), version: String(e.version || ''),
  platform: plataformaDe(e.files?.download),
  displayName: String(e.displayName || e.name || ''), description: String(e.description || ''),
  downloadCount: Number(e.downloadCount) || 0, verified: !!e.verified, deprecated: !!e.deprecated,
  icon: (() => { try { const u = new URL(e.files?.icon); return ORIGENES_ICONO.has(u.origin) ? u.href : null; } catch { return null; } })(),
});

export async function search(query, { category = '', offset = 0, size = 20, signal } = {}) {
  const q = new URLSearchParams({ size: String(size), offset: String(offset) });
  if (query) q.set('query', query);
  if (category) q.set('category', category);
  if (query) q.set('sortBy', 'relevance');
  else { q.set('sortBy', 'downloadCount'); q.set('sortOrder', 'desc'); }
  const j = await getJson(`${BASE}/api/-/search?${q}`, signal);
  return { total: Number(j.totalSize) || 0, offset: Number(j.offset) || 0, items: (j.extensions || []).map(resumen) };
}

export async function metadata(namespace, name, version = '', { signal } = {}) {
  const j = await getJson(`${BASE}/api/${seg(namespace)}/${seg(name)}${version ? '/' + seg(version) : ''}`, signal);
  if (j.error) throw new OpenVsxError(String(j.error), 'notfound');
  return {
    ...resumen(j), license: String(j.license || ''), categories: Array.isArray(j.categories) ? j.categories.map(String) : [],
    files: Object.fromEntries(['download', 'sha256', 'manifest', 'license', 'readme'].map(k => [k, deOpenVsx(j.files?.[k])])),
    homepage: String(j.homepage || ''), repository: String(j.repository || ''),
  };
}

// package.json publicado: sirve para decir qué aplicaría sin bajar el .vsix.
export async function manifest(meta, { signal } = {}) {
  if (!meta.files.manifest) throw new OpenVsxError('esta versión no publica su package.json', 'notfound');
  return getJson(meta.files.manifest, signal);
}

// El package.json de un resultado de búsqueda, sin pedir antes sus metadatos:
// una sola petición por fila para decir qué haría antes de instalarla.
export function manifestOf({ namespace, name, version, platform = '' }, { signal } = {}) {
  return getJson(`${BASE}/api/${seg(namespace)}/${seg(name)}/${platform ? seg(platform) + '/' : ''}${seg(version)}/file/package.json`, signal);
}

export async function text(url, { signal, max = 200_000 } = {}) {
  const u = deOpenVsx(url);
  if (!u) throw new OpenVsxError('URL fuera de Open VSX', 'http');
  const res = await fetch(u, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new OpenVsxError(`Open VSX respondió ${res.status}`, 'http', { status: res.status });
  return (await res.text()).slice(0, max);
}

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Baja el .vsix y comprueba su SHA-256 contra la que publica Open VSX.
// `confirmLarge(mb)` decide si seguir con uno de más de 25 MB.
export async function download(meta, { onProgress = () => {}, confirmLarge = async () => false, signal } = {}) {
  if (!meta.files.download) throw new OpenVsxError('esta versión no se puede descargar', 'notfound');
  const ctl = new AbortController();
  signal?.addEventListener('abort', () => ctl.abort(), { once: true });
  let res;
  try { res = await fetch(meta.files.download, { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new OpenVsxError(e.message || 'sin red', 'net'); }
  if (res.status === 429) throw new OpenVsxError('Open VSX está limitando peticiones', 'rate');
  if (!res.ok) throw new OpenVsxError(`descarga: ${res.status}`, res.status === 404 ? 'notfound' : 'http', { status: res.status });
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > MAX) { ctl.abort(); throw new OpenVsxError(`demasiado grande (${(total / 1048576).toFixed(0)} MB)`, 'big', { mb: Math.round(total / 1048576) }); }
  if (total > BIG && !(await confirmLarge(Math.round(total / 1048576)))) { ctl.abort(); throw new OpenVsxError('cancelado', 'cancel'); }
  const reader = res.body.getReader();
  const trozos = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > MAX) { ctl.abort(); throw new OpenVsxError('demasiado grande', 'big', { mb: Math.round(n / 1048576) }); }
    trozos.push(value);
    onProgress(n, total);
  }
  const bytes = new Uint8Array(n);
  let o = 0;
  for (const t of trozos) { bytes.set(t, o); o += t.length; }
  const sha = await sha256Hex(bytes);
  let publicada = null;
  if (meta.files.sha256) {
    try { publicada = (await text(meta.files.sha256, { signal: ctl.signal, max: 200 })).trim().split(/\s+/)[0].toLowerCase(); }
    catch { publicada = null; }
    if (!/^[0-9a-f]{64}$/.test(publicada || '')) publicada = null;   // no es una suma: como si no la publicara
  }
  if (publicada && publicada !== sha) throw new OpenVsxError('la suma SHA-256 no coincide con la publicada', 'sha');
  return { bytes, sha256: sha, verified: !!publicada };
}

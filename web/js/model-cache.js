// Arranque de la caché de modelos: (1) pide almacenamiento PERSISTENTE para que
// el navegador no desaloje los pesos cacheados, y (2) registra el service worker
// (sw.js) y espera a que CONTROLE la página antes de descargar nada — así hasta
// la primera descarga queda cacheada. Idempotente y a prueba de fallos.
let started = null;

export function ensureModelCache() {
  if (started) return started;
  started = (async () => {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
        const ok = persisted || await navigator.storage.persist();
        console.log('[elffuss] almacenamiento persistente:', ok);
      }
    } catch { /* no soportado */ }

    if (!('serviceWorker' in navigator)) return false;
    try {
      await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise(res => {
          const t = setTimeout(res, 1500);
          navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); res(); }, { once: true });
        });
      }
      console.log('[elffuss] caché de modelos activa (service worker)');
      return true;
    } catch (e) {
      console.warn('[elffuss] service worker no disponible:', e.message);
      return false;
    }
  })();
  return started;
}

// Espacio ocupado por la caché (para mostrarlo en Ajustes).
export async function cacheEstimate() {
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage || 0, quota: e.quota || 0, persisted: navigator.storage.persisted ? await navigator.storage.persisted() : false };
  } catch { return { usage: 0, quota: 0, persisted: false }; }
}

// Vaciar la caché de modelos (botón en Ajustes).
export async function clearModelCache() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller)
    navigator.serviceWorker.controller.postMessage('clear-models');
  try { await caches.delete('elffuss-models-v1'); } catch { /* */ }
}

// ── Lo que ocupan los MODELOS, y vaciarlos de verdad ─────────────────────────
// El chip 💾 y «Vaciar caché» medían `navigator.storage.estimate()` (el origen
// ENTERO: conversaciones, el proyecto de prueba en OPFS…) y lo llamaban
// «modelos guardados», y al vaciar solo borraban la Cache Storage vieja. Pero
// los pesos viven en otros sitios: la carpeta OPFS del almacén de modelos
// (runtime/model-store.js), la caché de transformers.js (el modelo ONNX) y el
// almacén COMPARTIDO del broker, que está en otro origen. Ahora se cuenta y se
// vacía cada uno, y se dice lo que de verdad se liberó.
const MODEL_CACHES = ['elffuss-models-v1', 'transformers-cache'];
const MODEL_DIR = 'elffuss-models';

async function opfsModelBytes() {
  try {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(MODEL_DIR);
    let n = 0;
    for await (const e of dir.values()) if (e.kind === 'file') n += (await e.getFile()).size;
    return n;
  } catch { return 0; }               // no existe todavía: nada guardado
}
async function cacheModelBytes() {
  if (typeof caches === 'undefined') return 0;
  let n = 0;
  for (const name of await caches.keys().catch(() => [])) {
    if (!MODEL_CACHES.includes(name) && !name.startsWith('transformers')) continue;
    try {
      const c = await caches.open(name);
      for (const req of await c.keys()) {
        const res = await c.match(req);
        const len = +(res?.headers.get('content-length') || 0);
        n += len || (res ? (await res.blob()).size : 0);
      }
    } catch { /* una caché ilegible no rompe la cuenta */ }
  }
  return n;
}
// El almacén compartido vive en el origen del broker: solo se puede medir y
// vaciar si el broker sabe hacerlo (sharedUsage / clearShared). Si no, se dice.
async function brokerApi() {
  try {
    const b = await import('./runtime/model-broker.js');
    if (typeof b.sharedUsage !== 'function') return null;
    let origenes;
    // Puede devolver la lista o una promesa de ella: se espera siempre.
    try { const r = await import('./engine/registro.js'); origenes = r.origenesAlmacen ? await r.origenesAlmacen() : undefined; }
    catch { /* sin motor: el broker por defecto */ }
    return { b, origenes };
  } catch { return null; }
}

// { local, shared, total, sharedOk }: `sharedOk` es false cuando el almacén
// compartido no se pudo consultar (puede haber más guardado del que se cuenta).
export async function modelUsage() {
  const local = (await opfsModelBytes()) + (await cacheModelBytes());
  let shared = 0, sharedOk = false;
  const api = await brokerApi();
  if (api) {
    try { const r = await api.b.sharedUsage(api.origenes); shared = r.usage || 0; sharedOk = !!r.ok; }
    catch { sharedOk = false; }
  }
  return { local, shared, total: local + shared, sharedOk };
}

// Vacía TODO lo que son pesos de modelo y devuelve cuánto se liberó DE VERDAD
// (se mide antes y después), más lo que no se pudo tocar.
export async function clearModels() {
  const antes = await modelUsage();
  const fallos = [];
  if (navigator.serviceWorker?.controller) navigator.serviceWorker.controller.postMessage('clear-models');
  if (typeof caches !== 'undefined') {
    for (const name of await caches.keys().catch(() => [])) {
      if (!MODEL_CACHES.includes(name) && !name.startsWith('transformers')) continue;
      try { await caches.delete(name); } catch (e) { fallos.push(name + ': ' + (e?.message || e)); }
    }
  }
  try {
    const { clearAll } = await import('./runtime/model-store.js');
    await clearAll();
  } catch (e) { fallos.push('OPFS: ' + (e?.message || e)); }
  const api = await brokerApi();
  if (api && typeof api.b.clearShared === 'function') {
    const lista = Array.isArray(api.origenes) && api.origenes.length ? [...new Set(api.origenes)] : [undefined];
    for (const o of lista) {
      try { const r = await api.b.clearShared(o); if (!r?.ok) fallos.push('broker ' + (o || '')); }
      catch (e) { fallos.push('broker ' + (o || '') + ': ' + (e?.message || e)); }
    }
  }
  const despues = await modelUsage();
  return { liberado: Math.max(0, antes.total - despues.total), antes, despues, fallos, sharedOk: antes.sharedOk };
}

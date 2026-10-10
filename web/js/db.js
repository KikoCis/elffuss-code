// IndexedDB mínima: stores clave→valor.
const NAME = 'elffuss-code', VERSION = 2;
const STORES = ['kv', 'apps', 'tasks', 'vault', 'fs', 'memory'];
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      for (const s of STORES)
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const req = fn(db.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

// Quien necesite saber que algo se escribió (el espacio de trabajo, que copia
// conversaciones y skills a tu disco con «Guardar solo») se apunta aquí. Un
// fallo de quien escucha nunca rompe la escritura.
const oyentes = [];
export function onWrite(fn) {
  oyentes.push(fn);
  return () => { const i = oyentes.indexOf(fn); if (i >= 0) oyentes.splice(i, 1); };
}
const avisa = (store, key) => (r) => { for (const f of oyentes) { try { f(store, key); } catch { /* */ } } return r; };

export const get  = (store, key)      => tx(store, 'readonly',  s => s.get(key));
export const set  = (store, key, val) => tx(store, 'readwrite', s => s.put(val, key)).then(avisa(store, key));
export const del  = (store, key)      => tx(store, 'readwrite', s => s.delete(key)).then(avisa(store, key));
export const keys = (store)           => tx(store, 'readonly',  s => s.getAllKeys());
export const all  = (store)           => tx(store, 'readonly',  s => s.getAll());

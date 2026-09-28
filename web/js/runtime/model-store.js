// Elffuss Runtime · almacén de modelos en OPFS (persistente, en disco).
// ─────────────────────────────────────────────────────────────────────────────
// Sustituye a Cache Storage para los PESOS del modelo. Motivo real (bug de móvil):
// Cache Storage se desaloja en iOS/Android → el modelo se re-descargaba en CADA
// visita. OPFS (Origin Private File System) + navigator.storage.persist() aguanta
// entre sesiones y se lee como File respaldado por DISCO (no vuelca todo a RAM).
//
// Además es la capa de almacenamiento del loader por shards: el motor leerá los
// pesos por rangos desde el File sin cargar los gigabytes enteros en memoria.
//
// Licencia: código propio (Apache-2.0). Sin dependencias externas.

const DIR = 'elffuss-models';

// Nombre de fichero estable y seguro a partir de la URL (sin barras ni query).
function keyFor(url) {
  return String(url).replace(/[?#].*$/, '').replace(/[^\w.\-]+/g, '_').slice(-180);
}

async function requestPersist() {
  try {
    if (navigator.storage?.persist) {
      const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      return already || await navigator.storage.persist();
    }
  } catch { /* no bloquea */ }
  return false;
}

async function dirHandle() {
  const root = await navigator.storage.getDirectory();      // lanza si no hay OPFS
  return await root.getDirectoryHandle(DIR, { create: true });
}

// ¿Hay soporte para escribir en OPFS de forma útil en este navegador?
// Chrome/escritorio: createWritable (stream a disco). iOS Safari: solo
// createSyncAccessHandle (en worker) → en este primer incremento, si no hay
// createWritable en el hilo principal, devolvemos null y el llamador cae a Cache.
async function opfsWritableSupported(dir) {
  try {
    const test = await dir.getFileHandle('.probe', { create: true });
    if (typeof test.createWritable !== 'function') { await dir.removeEntry('.probe').catch(() => {}); return false; }
    const w = await test.createWritable();
    await w.close();
    await dir.removeEntry('.probe').catch(() => {});
    return true;
  } catch { return false; }
}

// Devuelve un File (respaldado en disco) del modelo. Descarga por chunks a OPFS
// la primera vez (con progreso real), lo sirve desde disco a partir de entonces.
// Un marcador «<key>.done» evita servir una descarga cortada a medias.
// Devuelve null si OPFS no está disponible/escribible → el llamador usa su
// respaldo (Cache Storage) sin romperse.
export async function getModelFile(url, onProgress = () => {}) {
  // 1) Caché COMPARTIDA (broker en origen Elffuss): un modelo bajado en CUALQUIER
  //    web de Elffuss se reutiliza aquí sin re-descargar. Fast-fail por sesión si
  //    el broker no está disponible → caemos a la OPFS local de este origen.
  let brokerDown = false;
  try { brokerDown = sessionStorage.getItem('elffuss.broker.down') === '1'; } catch { /* — */ }
  if (!brokerDown) {
    try {
      const { getSharedModel } = await import('./model-broker.js');
      const blob = await getSharedModel(url, onProgress);
      if (blob && blob.size) return blob;
    } catch { try { sessionStorage.setItem('elffuss.broker.down', '1'); } catch { /* — */ } }
  }

  if (!navigator.storage?.getDirectory) return null;
  let dir;
  try { dir = await dirHandle(); } catch { return null; }
  await requestPersist();

  const key = keyFor(url);
  const doneName = key + '.done';

  // ¿ya está entero en disco?
  try {
    await dir.getFileHandle(doneName);                       // lanza si no existe
    const f = await (await dir.getFileHandle(key)).getFile();
    if (f.size > 0) { onProgress('Cargando el modelo desde disco (OPFS, sin descargar)…'); return f; }
  } catch { /* no está o incompleto: se descarga */ }

  if (!(await opfsWritableSupported(dir))) return null;      // iOS main-thread: que decida el llamador

  // ── Descarga REANUDABLE ────────────────────────────────────────────────
  // Antes, un corte borraba lo bajado y la vez siguiente empezaba de cero. Con
  // un modelo de gigas eso convierte un tropiezo de red —o que el equipo se
  // duerma— en media hora perdida, y el usuario lo vive como «vuelve a
  // descargar el modelo». Ahora lo ya escrito se conserva y se pide el resto
  // con `Range`.
  //
  // El peligro de reanudar es empalmar dos ficheros DISTINTOS si el de origen
  // cambió: saldría un modelo corrupto que carga y devuelve basura, que es
  // peor que volver a bajarlo. Por eso se guarda la huella del origen (ETag o
  // Last-Modified) junto a los bytes, y si no coincide se empieza de nuevo.
  const parteName = key + '.parte';                       // huella del intento
  let ya = 0, huellaPrevia = null;
  try {
    huellaPrevia = JSON.parse(await (await (await dir.getFileHandle(parteName)).getFile()).text());
    ya = (await (await dir.getFileHandle(key)).getFile()).size;
  } catch { ya = 0; huellaPrevia = null; }

  // Se pregunta primero POR LA CABECERA qué hay al otro lado: es una petición
  // de un byte, y decide si lo que tenemos sirve.
  let huella = null, total = 0, aceptaRangos = false;
  try {
    const cab = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    aceptaRangos = cab.status === 206;
    huella = cab.headers.get('etag') || cab.headers.get('last-modified') || null;
    const cr = cab.headers.get('content-range');
    total = cr ? +cr.split('/')[1] : (+cab.headers.get('content-length') || 0);
    try { await cab.arrayBuffer(); } catch { /* — */ }
  } catch { /* sin cabecera: se baja entero */ }

  // La huella preferida es el ETag, pero CORS solo expone Content-Range,
  // Accept-Ranges y Content-Length: desde el navegador `etag` sale NULL y una
  // reanudación que dependiera de él no se activaría jamás. Se cae al TAMAÑO
  // TOTAL, que Content-Range sí deja leer y que el registro del motor fija al
  // byte — si el fichero de origen cambiara, cambiaría de tamaño y la
  // reanudación se descarta sola. Es más débil que un ETag y suficiente aquí.
  const mismaHuella = huellaPrevia && (
    (huella && huellaPrevia.huella === huella) ||
    (!huella && !huellaPrevia.huella && huellaPrevia.total === total));
  const puedeReanudar = ya > 0 && aceptaRangos && total > 0 && ya < total && mismaHuella;
  if (ya > 0 && !puedeReanudar) {
    // Lo guardado no sirve (otro fichero, o el servidor no da rangos).
    await dir.removeEntry(key).catch(() => {});
    ya = 0;
  }

  const net = await fetch(url, puedeReanudar ? { headers: { Range: `bytes=${ya}-` } } : undefined);
  const okEstado = puedeReanudar ? net.status === 206 : net.ok;
  if (!okEstado || !net.body) throw new Error('descarga del modelo falló: HTTP ' + net.status);
  if (!total) total = (+net.headers.get('content-length') || 0) + ya;

  await dir.removeEntry(doneName).catch(() => {});
  const fh = await dir.getFileHandle(key, { create: true });
  // `keepExistingData` conserva lo ya escrito; sin él, createWritable() TRUNCA
  // el fichero a cero y la reanudación sería una forma cara de empezar de nuevo.
  // Se confirma POR TRAMOS. `createWritable()` es atómico: lo escrito no existe
  // en el fichero hasta el `close()`, así que un corte tira TODO aunque nadie
  // borre nada — que es exactamente lo que medía el banco de reanudación
  // fallando. Cerrando y reabriendo cada tramo, lo confirmado sobrevive al
  // corte y la próxima vez se continúa desde ahí.
  // Proporcional al fichero, no fijo: con un tramo de 64 MB un fichero de 3 MB
  // no llegaba a confirmar NUNCA y la reanudación no existía para él —lo
  // destapó el banco, que usa un fichero pequeño a propósito—. Así se confirma
  // una quincena de veces sea cual sea el tamaño, con suelo para no castigar a
  // los diminutos y techo para no confirmar cada dos por tres en los de gigas.
  const TRAMO = Math.max(512 * 1024, Math.min(64 * 1024 * 1024, Math.floor((total || 0) / 16) || (64 * 1024 * 1024)));
  const anota = async () => {
    try {
      const ph = await dir.getFileHandle(parteName, { create: true });
      const pw = await ph.createWritable();
      await pw.write(new TextEncoder().encode(JSON.stringify({ huella, total })));
      await pw.close();
    } catch { /* sin anotación se pierde la reanudación, no los datos */ }
  };
  let writable = await fh.createWritable({ keepExistingData: puedeReanudar });
  if (puedeReanudar) await writable.seek(ya);
  const t0 = performance.now();
  let loaded = ya;
  if (puedeReanudar) onProgress(`Reanudando la descarga desde ${(ya / 1e9).toFixed(1)} GB…`);
  await anota();
  try {
    const reader = net.body.getReader();
    let enTramo = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      loaded += value.byteLength;
      enTramo += value.byteLength;
      if (enTramo >= TRAMO) {
        enTramo = 0;
        await writable.close();                       // confirma lo del tramo
        writable = await fh.createWritable({ keepExistingData: true });
        await writable.seek(loaded);
      }
      onProgress(fmt(loaded, total, t0));
    }
    await writable.close();
  } catch (e) {
    // Se cierra para CONFIRMAR lo del tramo en curso. `abort()` lo descartaría,
    // que es justo lo contrario de lo que se quiere al reanudar.
    try { await writable.close(); } catch { /* lo confirmado en tramos ya está */ }
    throw e;
  }
  // Completado: fuera la marca de intento a medias.
  await dir.removeEntry(parteName).catch(() => {});

  // marcar completado (con el tamaño esperado, para validar en el futuro)
  const dh = await dir.getFileHandle(doneName, { create: true });
  const dw = await dh.createWritable();
  await dw.write(new TextEncoder().encode(JSON.stringify({ size: loaded, total })));
  await dw.close();

  return await (await dir.getFileHandle(key)).getFile();
}

// Abre un handle de lectura por rangos (para el loader por shards del motor):
// devuelve una función slice(offset, length) → Promise<ArrayBuffer> que lee del
// disco sin cargar el fichero entero. File.slice() es perezoso en disco.
export async function openRanged(url) {
  const file = await getModelFile(url);
  if (!file) return null;
  return {
    size: file.size,
    async slice(offset, length) { return await file.slice(offset, offset + length).arrayBuffer(); },
  };
}

// Borrar un modelo cacheado (para el «liberar espacio» de la UI).
export async function removeModel(url) {
  try {
    const dir = await dirHandle();
    const key = keyFor(url);
    await dir.removeEntry(key).catch(() => {});
    await dir.removeEntry(key + '.done').catch(() => {});
    return true;
  } catch { return false; }
}

// Borra TODOS los modelos guardados en OPFS.
// Existe porque el botón «liberar espacio» de Ajustes solo vaciaba Cache
// Storage: un modelo descargado por este almacén se quedaba ocupando disco sin
// forma de borrarlo desde la interfaz. Y como navigator.storage.estimate() SÍ
// lo cuenta, el usuario veía gigas que el botón no bajaba nunca.
export async function clearAll() {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(DIR, { recursive: true });
    return true;
  } catch { return false; }          // no existe o no hay OPFS: nada que borrar
}

// Bytes ocupados por los modelos en OPFS (aprox, para diagnóstico).
export async function usage() {
  try {
    const est = await navigator.storage.estimate();
    return { usage: est.usage || 0, quota: est.quota || 0 };
  } catch { return { usage: 0, quota: 0 }; }
}

function fmt(loaded, total, t0) {
  const mb = n => (n / 1048576).toFixed(0);
  const secs = (performance.now() - t0) / 1000;
  const spd = secs > 0 ? (loaded / 1048576 / secs).toFixed(1) : '0';
  // Incluir el % cuando se conoce el total: el escaparate lo extrae para llenar
  // la barra, y el texto queda corto (no envuelve en móvil).
  return total
    ? `Descargando el cerebro · ${mb(loaded)}/${mb(total)} MB · ${Math.round(loaded / total * 100)}%`
    : `Descargando el cerebro · ${mb(loaded)} MB · ${spd} MB/s`;
}

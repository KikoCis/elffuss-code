// Nivel 2 dentro del host de extensiones (js/ext/host.js): encender y apagar
// el código de una extensión, leer y guardar sus ficheros al instalarla con su
// código, sus ajustes y su formateador por lenguaje, y el puente con el
// recinto (bridge.js). host.js solo lo importa cuando hace falta: alguna
// extensión con su código encendido, o el usuario pide algo de esto. Quien solo
// usa temas, gramáticas y snippets no baja nada de aquí.
import * as store from '../ext/store.js';

// TODOS los ficheros del paquete bajo extension/, en bytes, para entregarlos al
// recinto al encenderla. Fuera node_modules/** y los *.map, y ninguna ruta que
// salga del paquete. Topes contados sobre lo que sale al descomprimir: 32 MiB
// por fichero y 64 MiB por extensión. La página nunca ejecuta estos bytes.
export const RAW_MAX_ENTRY = 32 << 20, RAW_MAX_TOTAL = 64 << 20;
export async function readVsixRaw(bytes, { maxEntry = RAW_MAX_ENTRY, maxTotal = RAW_MAX_TOTAL } = {}) {
  const { openZip } = await import('../ext/unzip.js');
  const zip = openZip(bytes, { maxEntry, maxTotal });
  const files = new Map();
  let total = 0;
  for (const name of zip.names) {
    if (!name.startsWith('extension/')) continue;
    const rel = name.slice('extension/'.length);
    if (!rel || /(^|\/)node_modules\//.test(rel) || /\.map$/i.test(rel)) continue;
    if (rel.startsWith('/') || rel.split('/').some(s => s === '..' || s === '.' || s === '')) continue;
    const data = await zip.read(name);
    total += data.length;
    files.set(rel, data);
  }
  return { files, bytes: total };
}
// La entrada `browser` del manifiesto como fichero del paquete
// («./dist/web/extension» → «dist/web/extension.js»), o null si no está.
export function browserEntry(manifest, names) {
  if (!manifest || typeof manifest.browser !== 'string') return null;
  const base = manifest.browser.replace(/^\.\//, '').replace(/\\/g, '/');
  for (const c of [base, base + '.js', base + '/index.js']) if (names.has(c)) return c;
  return null;
}

// [[ruta, ArrayBuffer]] del código guardado de una extensión
export async function readCode(rec) {
  const paths = Array.isArray(rec?.code?.files) ? rec.code.files : [];
  const vals = await store.getFiles(paths.map(p => store.codeKey(rec.id, rec.version, p)));
  return paths.map((p, i) => {
    const v = vals[i];
    if (v === undefined) throw Object.assign(new Error('falta ' + p), { code: 'missing' });
    const buf = v instanceof ArrayBuffer ? v.slice(0) : ArrayBuffer.isView(v) ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : new TextEncoder().encode(String(v)).buffer;
    return [p, buf];
  });
}

// Antes de encender el código de una extensión: el diálogo de consentimiento
// del panel (qué verá, que no tiene red, cuánto se baja).
async function confirmaTamano({ runtimeBytes, extensionBytes, name, rec }) {
  const { consent } = await import('./manage.js');
  return (await consent({ name, publisher: rec?.publisher, version: rec?.version, license: rec?.license, runtime: { bytes: runtimeBytes }, extensionBytes, mode: 'run' })) === 'code';
}

const PARADO = { state: 'stopped', extensions: [], commands: [] };

// h: lo que host.js comparte (ver allí): monaco, exts(), recarga(), emit(),
// paused, sinCodigo, listeners (los del panel) y uiTheme()
const KIND = { vs: 'light', 'hc-black': 'hc', 'hc-light': 'hc-light' };
const kindOf = uiTheme => KIND[uiTheme] || 'dark';   // claro, oscuro o contraste
export function attach(h) {
  let puente = null, cargando = null;
  const corren = () => (h.paused || h.sinCodigo ? [] : h.exts().filter(e => e.enabled && e.runs));

  // Con alguna extensión con su código encendido, el recinto arranca (en
  // paralelo: ide.js crea el editor después y el puente lo espera); sin
  // ninguna, se desmonta. La lista se lee al sincronizar, no al pedirlo: dos
  // cambios seguidos (instalar dos, encender y apagar) no pueden dejar el
  // recinto con una lista vieja.
  function sync() {
    if (!corren().length && !puente && !cargando) return;
    (async () => {
      cargando ??= import('./bridge.js').then(m => {
        m.onChange(() => { for (const f of h.listeners) { try { f(); } catch { /* — */ } } });
        return m;
      });
      puente = await cargando;
      puente.setTheme(kindOf(h.uiTheme()));
      await puente.sync({ monaco: h.monaco, records: corren(), readCode });
      h.emit();
    })().catch(e => console.warn('[elffuss-ext] nivel 2:', e?.message || e));
  }

  // Instalar con su código (el usuario ya aceptó): los bytes del paquete por
  // ruta, la entrada `browser`, encendida salvo que estuviera apagada antes, y
  // sus ajustes y su formateador si ya los tenía (una actualización).
  async function codeFiles(v, bytes, previo) {
    if (typeof v.manifest.browser !== 'string') throw Object.assign(new Error('sin código para navegador'), { code: 'nocode' });
    const raw = await readVsixRaw(bytes);
    const entry = browserEntry(v.manifest, raw.files);
    if (!entry) throw Object.assign(new Error('la entrada browser no está en el paquete'), { code: 'noentry' });
    const files = new Map();
    for (const [p, data] of raw.files) files.set(store.codeKey(v.id, v.version, p), data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    return {
      files,
      fields: {
        code: { entry, files: [...raw.files.keys()], bytes: raw.bytes, manifest: v.manifest },
        runs: previo?.code ? !!previo.runs : true,
        settings: previo?.settings || {}, formatter: previo?.formatter || {},
      },
    };
  }

  // Encender el código: la primera vez enseña cuánto se va a bajar ANTES de
  // bajar nada; cancelar no cambia nada.
  async function setRuns(id, on, { confirm = confirmaTamano } = {}) {
    const rec = h.exts().find(e => e.id === id);
    if (!rec) throw Object.assign(new Error('no instalada: ' + id), { code: 'missing' });
    if (on) {
      if (typeof rec.code?.manifest?.browser !== 'string') throw Object.assign(new Error('sin código para navegador'), { code: 'nocode' });
      const { runtimeInfo } = await import('./vendor.js');
      const info = await runtimeInfo();
      if (!info.available) throw Object.assign(new Error('nivel 2 no disponible: ' + info.reason), { code: 'x2-' + info.reason });
      if (!info.cached && !(await confirm({ runtimeBytes: info.bytes, extensionBytes: rec.code.bytes || 0, name: rec.displayName || rec.id, id, rec }))) return false;
    }
    await store.update(id, r => { r.runs = !!on; });
    await h.recarga();
    return true;
  }

  // Ajustes (validados por el panel contra lo que la extensión declara) y
  // formateador por lenguaje: se aplican sin recargar.
  async function setSettings(id, settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Object.assign(new Error('los ajustes son un objeto JSON'), { code: 'settings' });
    await store.update(id, r => { r.settings = structuredClone(settings); }, { mirror: false });
    await h.recarga();
  }
  async function setFormatter(id, lang, choice) {
    const rec = h.exts().find(e => e.id === id);
    if (!rec || typeof lang !== 'string' || !['extension', 'builtin'].includes(choice)) return;
    await store.update(id, r => { r.formatter = { ...(r.formatter || {}), [lang]: choice }; }, { mirror: false });
    await h.recarga();
  }

  // ¿está disponible el nivel 2 aquí? (navegador, sitio, interruptor) y su tamaño
  const runtime = async () => (h.paused || h.sinCodigo ? { available: false, reason: 'url' } : (await import('./vendor.js')).runtimeInfo());

  return {
    sync, codeFiles, setRuns, setSettings, setFormatter, runtime,
    setTheme: uiTheme => puente?.setTheme(kindOf(uiTheme)),
    state: () => (puente ? puente.state() : PARADO),
    commands: () => (puente ? puente.commands() : []),
  };
}

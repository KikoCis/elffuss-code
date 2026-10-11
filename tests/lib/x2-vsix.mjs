// .vsix reales de Open VSX para las pruebas en vivo y el censo del nivel 2.
//
// fetchVsix() baja un .vsix (o lo toma de tests/.cache/vsix/) y comprueba su
// SHA-256 contra la que publica Open VSX, fallando cerrado: sin suma
// publicada, o si no coincide, no hay extensión. Si la prueba fija además su
// propia suma, también tiene que coincidir.
// readCode() lo abre con el lector de zip del nivel 1 (web/js/ext/unzip.js) y
// devuelve el manifiesto (con %nls% resuelto) y todos sus ficheros bajo
// extension/, menos node_modules/** y **/*.map, con topes de tamaño.
// seedReal() lo guarda en la página como si se hubiera instalado.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openZip } from '../../web/js/ext/unzip.js';
import { parseJsonc } from '../../web/js/ext/formats.js';
import { resolveNls } from '../../web/js/ext/vsix.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CACHE = path.join(HERE, '..', '.cache', 'vsix');
const API = 'https://open-vsx.org';
const MAX_ENTRY = 32 << 20, MAX_TOTAL = 64 << 20;
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'elffuss-code-tests' } });
  if (!r.ok) throw Object.assign(new Error(`${url}: HTTP ${r.status}`), { status: r.status });
  return r.json();
}

export async function metadata(namespace, name, version = '') {
  return getJson(`${API}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}${version ? '/' + encodeURIComponent(version) : ''}`);
}

export async function fetchVsix({ namespace, name, version, sha256: pinned, offline = false }) {
  fs.mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${namespace}.${name}-${version}.vsix`);
  if (fs.existsSync(file)) {
    const bytes = fs.readFileSync(file);
    const sum = sha256(bytes);
    if (!pinned || sum === pinned) return { bytes, sha256: sum, cached: true };
    fs.rmSync(file);
  }
  if (offline) throw Object.assign(new Error('offline and not cached'), { code: 'offline' });
  const meta = await metadata(namespace, name, version);
  if (meta.error) throw new Error(String(meta.error));
  if (!meta.files?.download || !meta.files?.sha256) throw Object.assign(new Error('Open VSX publishes no SHA-256 for this version'), { code: 'nosha' });
  const published = (await (await fetch(meta.files.sha256)).text()).trim().split(/\s+/)[0].toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(published)) throw Object.assign(new Error('the published SHA-256 is not a hash'), { code: 'nosha' });
  const r = await fetch(meta.files.download);
  if (!r.ok) throw new Error('download: HTTP ' + r.status);
  const bytes = Buffer.from(await r.arrayBuffer());
  const sum = sha256(bytes);
  if (sum !== published) throw Object.assign(new Error('SHA-256 does not match the published one'), { code: 'sha' });
  if (pinned && sum !== pinned) throw Object.assign(new Error('SHA-256 does not match the pinned one'), { code: 'sha' });
  fs.writeFileSync(file, bytes);
  return { bytes, sha256: sum, cached: false, license: meta.license };
}

export async function readCode(bytes, { lang = 'en' } = {}) {
  const zip = openZip(bytes, { maxEntry: MAX_ENTRY, maxTotal: MAX_TOTAL });
  const dec = new TextDecoder();
  if (!zip.has('extension/package.json')) throw Object.assign(new Error('not a VS Code extension'), { code: 'notvsix' });
  let manifest = parseJsonc(dec.decode(await zip.read('extension/package.json')));
  let nls = {};
  for (const f of ['extension/package.nls.json', `extension/package.nls.${lang}.json`]) {
    if (zip.has(f)) { try { nls = { ...nls, ...parseJsonc(dec.decode(await zip.read(f))) }; } catch { /* sin traducción */ } }
  }
  manifest = resolveNls(manifest, nls);
  const files = {};
  let total = 0;
  for (const name of zip.names) {
    if (!name.startsWith('extension/')) continue;
    const rel = name.slice('extension/'.length);
    if (!rel || /(^|\/)node_modules\//.test(rel) || /\.map$/i.test(rel)) continue;
    const data = await zip.read(name);
    total += data.length;
    files[rel] = data;
  }
  return { manifest, files, bytes: total };
}

// Guarda una extensión real en la página (IndexedDB de Code), con `runs`.
export async function seedReal(page, { manifest, files, bytes }, { runs = true } = {}) {
  const id = `${manifest.publisher}.${manifest.name}`.toLowerCase();
  const rec = {
    id, publisher: manifest.publisher, name: manifest.name, version: String(manifest.version),
    displayName: typeof manifest.displayName === 'string' ? manifest.displayName : manifest.name, description: '', license: String(manifest.license || ''),
    sha256: '0'.repeat(64), verified: true, source: 'test', size: bytes, installedAt: Date.now(), enabled: true, runs,
    hasCode: true, ignored: [], pack: [], warnings: [], themes: [], grammars: [], snippets: [], languages: [], licenseKey: null,
    code: { entry: manifest.browser, files: Object.keys(files), bytes, manifest },
  };
  // en trozos: page.evaluate no quiere mensajes enormes
  const entries = Object.entries(files).map(([p, b]) => [p, Buffer.from(b).toString('base64')]);
  await page.evaluate(async rec => { const store = await import('/js/ext/store.js'); await store.put(rec, new Map()); }, rec);
  for (let i = 0; i < entries.length; i += 50) {
    await page.evaluate(async ({ id, version, chunk }) => {
      const store = await import('/js/ext/store.js');
      const db = await new Promise((res, rej) => { const r = indexedDB.open('elffuss-code-ext', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const tx = db.transaction('files', 'readwrite');
      for (const [p, b64] of chunk) {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
        tx.objectStore('files').put(u8.buffer, store.codeKey(id, version, p));
      }
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      db.close();
    }, { id, version: rec.version, chunk: entries.slice(i, i + 50) });
  }
  return id;
}

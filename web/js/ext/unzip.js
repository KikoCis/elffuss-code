// Lector de .zip (un .vsix es un zip) sin dependencias: el directorio central
// se lee a mano y cada entrada se descomprime con DecompressionStream
// ('deflate-raw'), que ya traen los navegadores y Node. Solo se descomprime lo
// que se pide, con topes por entrada y en total: un zip puede declarar un
// tamaño y luego inflarse a gigas (zip bomb), así que se cuenta lo que sale de
// verdad, no lo que dice la cabecera.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

let CRC_TABLA = null;
export function crc32(bytes) {
  if (!CRC_TABLA) {
    CRC_TABLA = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLA[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Índice de entradas a partir del directorio central.
export function listEntries(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  // el registro final (EOCD) está en los últimos 22 bytes + comentario (≤ 64 KB)
  let eocd = -1;
  for (let o = b.length - 22; o >= Math.max(0, b.length - 22 - 0xffff); o--) {
    if (u32(b, o) === 0x06054b50) { eocd = o; break; }
  }
  if (eocd < 0) throw Object.assign(new Error('no es un zip (falta el directorio central)'), { code: 'notvsix' });
  const total = u16(b, eocd + 10);
  const cdOffset = u32(b, eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64 no soportado');
  const entries = [];
  const dec = new TextDecoder();
  let p = cdOffset;
  for (let k = 0; k < total; k++) {
    if (p + 46 > b.length || u32(b, p) !== 0x02014b50) throw new Error('directorio central corrupto');
    const flags = u16(b, p + 8);
    const method = u16(b, p + 10);
    const crc = u32(b, p + 16);
    const csize = u32(b, p + 20);
    const usize = u32(b, p + 24);
    const nlen = u16(b, p + 28), xlen = u16(b, p + 30), clen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, '/');
    entries.push({ name, flags, method, crc, csize, usize, local });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

async function inflateRaw(datos, tope) {
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const lector = flujo.getReader();
  const trozos = [];
  let n = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    n += value.length;
    if (n > tope) { lector.cancel().catch(() => {}); throw new Error('entrada demasiado grande al descomprimir'); }
    trozos.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const t of trozos) { out.set(t, o); o += t.length; }
  return out;
}

// Abre el zip y devuelve un lector perezoso: names, has(name), read(name).
// `maxEntry` limita cada entrada y `maxTotal` lo que se descomprime en total.
export function openZip(input, { maxEntry = 8 << 20, maxTotal = 48 << 20 } = {}) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = listEntries(b);
  const porNombre = new Map(entries.filter(e => !e.name.endsWith('/')).map(e => [e.name, e]));
  let gastado = 0;
  async function read(name) {
    const e = porNombre.get(name);
    if (!e) throw new Error('no está en el paquete: ' + name);
    if (e.flags & 1) throw new Error('entrada cifrada: ' + name);
    if (e.usize > maxEntry) throw new Error(`${name} pesa demasiado (${e.usize} bytes)`);
    if (gastado + e.usize > maxTotal) throw new Error('el paquete descomprime demasiado');
    if (e.local + 30 > b.length || u32(b, e.local) !== 0x04034b50) throw new Error('cabecera local corrupta: ' + name);
    const inicio = e.local + 30 + u16(b, e.local + 26) + u16(b, e.local + 28);
    const datos = b.subarray(inicio, inicio + e.csize);
    if (datos.length !== e.csize) throw new Error('entrada truncada: ' + name);
    let out;
    if (e.method === 0) out = datos.slice();
    else if (e.method === 8) out = await inflateRaw(datos, Math.min(maxEntry, e.usize));
    else throw new Error(`compresión ${e.method} no soportada: ${name}`);
    if (out.length !== e.usize || crc32(out) !== e.crc) throw new Error('CRC incorrecto: ' + name);
    gastado += out.length;
    return out;
  }
  return { names: [...porNombre.keys()], has: n => porNombre.has(n), read, entries };
}

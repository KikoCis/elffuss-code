// Stand-in for @vscode/iconv-lite-umd: UTF-8 only, on TextEncoder and
// TextDecoder. The sandbox only ever sees text that Code's page sent it, and
// that text is UTF-8; any other encoding is refused instead of shipping the
// full code-page tables.
const isUtf8 = enc => String(enc || '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'utf8';
const unsupported = enc => Object.assign(new Error('Encoding not available in Elffuss Code: ' + String(enc)), { code: 'ENOTSUP' });

export function encodingExists(enc) { return isUtf8(enc); }

export function getDecoder(enc, options = {}) {
  if (!isUtf8(enc)) throw unsupported(enc);
  const decoder = new TextDecoder('utf-8', { ignoreBOM: options.stripBOM === false });
  return {
    write: buf => decoder.decode(buf, { stream: true }),
    end: () => decoder.decode() || undefined,
  };
}

export function getEncoder(enc, options = {}) {
  if (!isUtf8(enc)) throw unsupported(enc);
  const encoder = new TextEncoder();
  let first = !!options.addBOM;
  return {
    write(text) {
      const bytes = encoder.encode(String(text));
      if (!first) return bytes;
      first = false;
      const out = new Uint8Array(bytes.length + 3);
      out.set([0xef, 0xbb, 0xbf]);
      out.set(bytes, 3);
      return out;
    },
    end: () => undefined,
  };
}

export function decode(buf, enc) { return getDecoder(enc).write(buf); }
export function encode(text, enc) { return getEncoder(enc).write(text); }
export default { encodingExists, getDecoder, getEncoder, decode, encode };

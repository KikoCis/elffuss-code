// Dónde vive el recinto de las extensiones con código (nivel 2), según el
// nombre de host de la propia página. Es una tabla fija: nunca sale de un
// parámetro de la URL ni del almacenamiento, así que nada puede apuntar el
// recinto a otro sitio.
//
// El recinto tiene que ser OTRO SITIO (otro dominio registrable): así no
// comparte almacenamiento, cookies ni proceso con Code. En producción el
// dominio aún no existe (decisión del dueño): hasta entonces, el nivel 2 dice
// «no disponible en este sitio» y Code sigue exactamente igual.
const TABLA = {
  'code.elffuss.com': null,
  // desarrollo y pruebas: el mismo servidor sirve el recinto en «localhost»,
  // que es otro sitio que 127.0.0.1. Abrir Code en http://localhost no vale
  // (sería el mismo sitio que el recinto): se usa 127.0.0.1.
  '127.0.0.1': loc => `http://localhost:${loc.port}`,
};

export const SANDBOX_DOC = '/x2/v1/sandbox.html';

export function sandboxOrigin(loc = globalThis.location) {
  if (!loc || !Object.hasOwn(TABLA, loc.hostname)) return null;
  const v = TABLA[loc.hostname];
  const s = typeof v === 'function' ? v(loc) : v;
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.origin === loc.origin) return null;          // nunca el mismo origen que Code
  return u.origin;
}

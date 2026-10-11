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

// El «sitio» de un host, por lo alto: sus dos últimas etiquetas (una IP o un
// nombre sin puntos, entero). Dos hosts del mismo dominio registrable
// comparten siempre esas dos etiquetas, así que esto nunca da por distintos
// dos del mismo sitio; puede dar por iguales dos que no lo son (a.co.uk y
// b.co.uk), y entonces el nivel 2 se niega: falla cerrado.
export function siteOf(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!h.includes('.') || h.includes(':') || /^[\d.]+$/.test(h)) return h;
  return h.split('.').slice(-2).join('.');
}
// (sin mirar el esquema: http y https del mismo dominio comparten cookies)
export const sameSite = (a, b) => {
  try { return siteOf(new URL(a).hostname) === siteOf(new URL(b).hostname); } catch { return true; }
};

export function sandboxOrigin(loc = globalThis.location, tabla = TABLA) {
  if (!loc || !Object.hasOwn(tabla, loc.hostname)) return null;
  const v = tabla[loc.hostname];
  const s = typeof v === 'function' ? v(loc) : v;
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  // nunca el mismo origen que Code, ni el mismo sitio (compartiría cookies y proceso)
  if (u.origin === loc.origin || sameSite(u.origin, loc.origin)) return null;
  return u.origin;
}

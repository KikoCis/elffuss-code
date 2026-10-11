// Búsqueda y lectura web para la elfa de Code (docs, errores, APIs). fetch
// directo si el sitio permite CORS; si no, cae al proxy del servidor
// (/proxy?url=… → mismo backend que Elffuss Claw). Sin gate de permisos: un
// agente de código necesita consultar internet de serie.
const MAX = 8000;

function toText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,svg,iframe').forEach(n => n.remove());
  return ((doc.body?.innerText || doc.body?.textContent || '').replace(/\n{3,}/g, '\n\n').trim()) || html.slice(0, MAX);
}

// Lee una URL: directa si el sitio permite CORS y, si no, por el proxy del
// servidor. Cuando las dos fallan, el error dice POR QUÉ. En especial si el
// proxy no existe en este servidor (404): antes salía «HTTP 404» a secas, que
// se lee como «esa página no existe», y la búsqueda lo convertía en «Sin
// resultados», como si internet no tuviera nada que decir.
const hostDe = url => { try { return new URL(url).host; } catch { return url; } };
async function proxyGet(url) {
  let directo;
  try { const r = await fetch(url); if (r.ok) return await r.text(); directo = new Error('HTTP ' + r.status); }
  catch (e) { directo = e; }
  let r;
  try { r = await fetch('/proxy?url=' + encodeURIComponent(url)); }
  catch (e) { throw new Error(`No pude leer ${hostDe(url)}: ni directamente (${directo?.message || 'sin respuesta'}) ni por el proxy del servidor (${e?.message || 'sin respuesta'}).`); }
  if (r.ok) return await r.text();
  if (r.status === 404 || r.status === 405 || r.status === 501) {
    const e = new Error(`No pude leer ${hostDe(url)}: el sitio no deja leerlo directamente desde el navegador (CORS) y este servidor no tiene el proxy de respaldo (/proxy respondió ${r.status}). No es que la página no exista: desde aquí no se puede leer.`);
    e.sinProxy = true;
    throw e;
  }
  throw new Error(`No pude leer ${hostDe(url)}: ni directamente (${directo?.message || 'sin respuesta'}) ni por el proxy del servidor (HTTP ${r.status}).`);
}

export async function fetchUrl({ url } = {}) {
  if (!/^https?:\/\//.test(url || '')) throw new Error('URL inválida (usa https://…)');
  const text = toText(await proxyGet(url));
  return `[${url}]\n` + (text.length > MAX ? text.slice(0, MAX) + '\n… (recortado)' : text);
}

// Búsqueda REAL en DuckDuckGo. Parseo tolerante: cada resultado es un enlace
// con ?uddg=<url real>. Independiente de clases (robusto a cambios de HTML).
// Si ningún buscador contesta se dice por qué, en vez de «Sin resultados» (que
// solo vale cuando el buscador SÍ contestó y no encontró nada). Y la página de
// verificación anti-bot de DuckDuckGo no es una lista vacía: es un bloqueo.
const BLOQUEO_DDG = /anomaly|unusual traffic|are you a human|bots use duckduckgo/i;
export async function search({ query } = {}) {
  if (!query) throw new Error('Falta query');
  let html = '', ultimoError = null, bloqueado = false;
  for (const ep of ['https://html.duckduckgo.com/html/?q=', 'https://lite.duckduckgo.com/lite/?q=']) {
    try {
      const h = await proxyGet(ep + encodeURIComponent(query));
      if (!h.includes('uddg=') && BLOQUEO_DDG.test(h)) { bloqueado = true; continue; }
      html = h;
      if (html.includes('uddg=') || html.includes('result')) break;
    } catch (e) { ultimoError = e; }
  }
  if (!html) {
    if (bloqueado) throw new Error(`El buscador bloqueó la consulta «${query}» (DuckDuckGo pidió una verificación anti-bot a este servidor): no hay resultados que leer. Prueba más tarde, o lee una URL concreta con web.fetch.`);
    throw ultimoError || new Error(`No pude consultar el buscador para «${query}».`);
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const seen = new Set(), out = [];
  for (const a of doc.querySelectorAll('a[href*="uddg="]')) {
    const m = a.getAttribute('href').match(/uddg=([^&]+)/);
    if (!m) continue;
    const href = decodeURIComponent(m[1]);
    const title = a.textContent.trim();
    if (!title || title.length < 3 || seen.has(href)) continue;
    seen.add(href);
    const block = a.closest('tr, div, article') || a.parentElement;
    const snip = (block?.textContent || '').replace(title, '').replace(/\s+/g, ' ').trim().slice(0, 160);
    out.push(`• ${title}\n  ${href}${snip ? '\n  ' + snip : ''}`);
    if (out.length >= 8) break;
  }
  return out.length ? `Resultados para «${query}»:\n\n` + out.join('\n\n') : `Sin resultados para «${query}».`;
}

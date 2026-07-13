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

async function proxyGet(url) {
  let lastErr;
  for (const target of [url, '/proxy?url=' + encodeURIComponent(url)]) {
    try { const r = await fetch(target); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('sin respuesta');
}

export async function fetchUrl({ url } = {}) {
  if (!/^https?:\/\//.test(url || '')) throw new Error('URL inválida (usa https://…)');
  const text = toText(await proxyGet(url));
  return `[${url}]\n` + (text.length > MAX ? text.slice(0, MAX) + '\n… (recortado)' : text);
}

// Búsqueda REAL en DuckDuckGo. Parseo tolerante: cada resultado es un enlace
// con ?uddg=<url real>. Independiente de clases (robusto a cambios de HTML).
export async function search({ query } = {}) {
  if (!query) throw new Error('Falta query');
  let html = '';
  for (const ep of ['https://html.duckduckgo.com/html/?q=', 'https://lite.duckduckgo.com/lite/?q=']) {
    try { html = await proxyGet(ep + encodeURIComponent(query)); if (html.includes('uddg=') || html.includes('result')) break; }
    catch { /* siguiente endpoint */ }
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

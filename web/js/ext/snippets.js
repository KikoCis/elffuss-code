// Snippets de VS Code → sugerencias de Monaco que se insertan como snippet
// (mismo formato: $1, ${2:valor}, ${3|a,b|}, $TM_FILENAME…).

// Fichero de snippets (JSON con comentarios ya parseado) → lista plana. Admite
// un nivel de anidado (grupos), prefijos en lista y cuerpos en lista de líneas.
export function normalizeSnippets(json) {
  const out = [];
  const uno = (nombre, s) => {
    if (!s || typeof s !== 'object' || s.body == null) return false;
    const prefijos = (Array.isArray(s.prefix) ? s.prefix : [s.prefix]).filter(p => typeof p === 'string' && p.trim());
    const body = Array.isArray(s.body) ? s.body.map(String).join('\n') : String(s.body);
    const description = Array.isArray(s.description) ? s.description.join('\n') : (typeof s.description === 'string' ? s.description : '');
    for (const prefix of prefijos) out.push({ name: String(nombre), prefix: prefix.trim(), body, description });
    return true;
  };
  if (!json || typeof json !== 'object') return out;
  for (const [nombre, s] of Object.entries(json)) {
    if (uno(nombre, s)) continue;
    if (s && typeof s === 'object') for (const [n2, s2] of Object.entries(s)) uno(n2, s2);
  }
  return out.slice(0, 5000);
}

const esPalabra = ch => /[\w$]/.test(ch || '');

// Columna donde empieza lo que el usuario ya escribió del prefijo. Si lo
// escrito es el principio literal del prefijo («#reg» de «#region»), se
// reemplaza eso; si no, la palabra bajo el cursor, que Monaco filtra en difuso.
export function replaceStart(lineaAntes, prefix, wordStart) {
  const lo = lineaAntes.toLowerCase(), pre = prefix.toLowerCase();
  for (let p = Math.max(0, lo.length - pre.length); p < lo.length; p++) {
    if (!pre.startsWith(lo.slice(p))) continue;
    if (p > 0 && esPalabra(lo[p - 1]) && esPalabra(lo[p])) continue;   // a media palabra, no
    return p + 1;
  }
  return wordStart;
}

// Cabecera de la sugerencia: «descripción (Extensión)». `detail` y un
// `documentation` string son texto para Monaco, no Markdown.
export const cabecera = (s, ext = '') => (s.description || s.name) + (ext ? ` (${ext})` : '');

// Un proveedor por lenguaje. `cargar()` devuelve (una vez, en diferido) la
// lista de snippets de todas las extensiones activas para ese lenguaje.
export function registerSnippets(monaco, language, cargar, origen = () => '') {
  let lista = null;
  const K = monaco.languages.CompletionItemKind.Snippet;
  const R = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  return monaco.languages.registerCompletionItemProvider(language, {
    async provideCompletionItems(model, position) {
      lista ??= await cargar().catch(() => []);
      if (!lista.length) return { suggestions: [] };
      const antes = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const palabra = model.getWordUntilPosition(position);
      const suggestions = lista.map(s => ({
        label: s.prefix,
        kind: K,
        // como VS Code: arriba la descripción y de qué extensión viene, y en el
        // detalle el cuerpo. Todo texto plano, NUNCA Markdown: Monaco pintaría
        // las imágenes y enlaces que escriba la extensión y el navegador las
        // pediría a cualquier servidor (IP, hora y origen de quien mira).
        detail: cabecera(s, origen(s)),
        documentation: s.body,
        insertText: s.body,
        insertTextRules: R,
        range: new monaco.Range(position.lineNumber, replaceStart(antes, s.prefix, palabra.startColumn), position.lineNumber, position.column),
      }));
      return { suggestions };
    },
  });
}

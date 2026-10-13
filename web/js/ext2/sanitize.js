// Cómo se pinta en Code el texto que escribe una extensión. Regla única: nada
// de lo que sale del recinto puede hacer una petición, navegar o meter HTML.
//
//   · Campos de texto plano (documentación de un autocompletado, detalle,
//     firmas, mensajes de diagnóstico): Monaco los pinta como texto. Se pasa el
//     markdown a texto legible: una imagen queda en su texto alternativo y un
//     enlace [t](u) en «t (u)».
//   · Campos que Monaco exige en markdown (hover): markdown CANÓNICO hecho
//     aquí. El texto va con TODOS los signos de puntuación ASCII escapados con
//     barra: no puede sobrevivir ningún enlace, imagen, autoenlace, HTML,
//     énfasis ni título. El código va entre delimitadores nuestros.
//     isTrusted, supportHtml y supportThemeIcons a false y sin baseUri.
//
// La página solo pinta markdown que ha escrito ella: no hay diferencias entre
// el analizador de la extensión y el nuestro, porque la estructura es nuestra.

const PUNCT = /[!-/:-@[-`{-~]/g;                    // toda la puntuación ASCII
const MAX = 65536;

// Trocea el markdown de una extensión en texto, código en línea y bloques de
// código vallados. Conservador: lo que no es código es texto.
export function segments(src) {
  const s = String(src ?? '').slice(0, MAX).replace(/\r\n?/g, '\n');
  const out = [];
  let i = 0, text = '';
  const flush = () => { if (text) { out.push({ type: 'text', value: text }); text = ''; } };
  while (i < s.length) {
    const atLineStart = i === 0 || s[i - 1] === '\n';
    if (atLineStart) {
      const fence = /^( {0,3})(`{3,}|~{3,})([^\n`]*)\n/.exec(s.slice(i));
      if (fence) {
        const marker = fence[2];
        const body = s.slice(i + fence[0].length);
        const close = new RegExp('(^|\\n) {0,3}' + marker[0] + '{' + marker.length + ',}[ \\t]*(\\n|$)').exec(body);
        const end = close ? close.index + (close[1] ? 1 : 0) : body.length;
        flush();
        out.push({ type: 'fence', lang: (fence[3].trim().split(/\s+/)[0] || '').toLowerCase(), value: body.slice(0, end).replace(/\n$/, '') });
        i += fence[0].length + (close ? close.index + close[0].length : body.length);
        continue;
      }
    }
    if (s[i] === '`') {
      let n = 0; while (s[i + n] === '`') n++;
      const ticks = '`'.repeat(n);
      let j = i + n, found = -1;
      while ((j = s.indexOf(ticks, j)) !== -1) {
        if (s[j + n] !== '`' && s[j - 1] !== '`') { found = j; break; }
        j += n;
      }
      if (found !== -1) {
        flush();
        out.push({ type: 'code', value: s.slice(i + n, found).replace(/\n/g, ' ') });
        i = found + n;
        continue;
      }
      text += ticks; i += n; continue;
    }
    text += s[i++];
  }
  flush();
  return out;
}

// Texto de un trozo de markdown, sin sintaxis que pueda convertirse en nada.
function toPlain(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')                    // imagen → su texto alternativo
    .replace(/\[([^\]]+)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g, (_, t, u) => (u ? `${t} (${u})` : t))
    .replace(/<\/?[a-zA-Z][^>]*>/g, '');
}

export function plainText(src) {
  return segments(src).map(seg => (seg.type === 'text' ? toPlain(seg.value) : seg.type === 'code' ? seg.value : seg.value + '\n')).join('').slice(0, MAX);
}

const escapeText = t => t.replace(PUNCT, ch => '\\' + ch)
  // sangría de 4 espacios = bloque de código: se conserva con espacios duros
  .replace(/^( +)/gm, sp => ' '.repeat(sp.length))
  // saltos de línea simples visibles (dos espacios + salto)
  .replace(/([^\n])\n(?!\n)/g, '$1  \n');

function fenceFor(value) {
  let longest = 2;
  for (const m of value.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return '`'.repeat(longest + 1);
}

export function canonicalMarkdown(src) {
  const parts = [];
  for (const seg of segments(src)) {
    if (seg.type === 'text') parts.push(escapeText(seg.value));
    else if (seg.type === 'code') {
      let n = 1;
      for (const m of seg.value.matchAll(/`+/g)) n = Math.max(n, m[0].length + 1);
      const d = '`'.repeat(n);
      const pad = seg.value.startsWith('`') || seg.value.endsWith('`') ? ' ' : '';
      parts.push(d + pad + seg.value + pad + d);
    } else {
      const lang = /^[a-z0-9-]{0,30}$/.test(seg.lang) ? seg.lang : '';
      const f = fenceFor(seg.value);
      const before = parts.length && !/\n$/.test(parts[parts.length - 1]) ? '\n' : '';
      parts.push(`${before}${f}${lang}\n${seg.value}\n${f}\n`);
    }
  }
  return { value: parts.join('').slice(0, MAX * 2), isTrusted: false, supportHtml: false, supportThemeIcons: false };
}

// Texto plano que va en un campo markdown (p. ej. un hover que llegó como
// cadena): todo escapado, ninguna estructura.
export function markdownFromText(text) {
  return { value: escapeText(String(text ?? '').slice(0, MAX)), isTrusted: false, supportHtml: false, supportThemeIcons: false };
}

// Variables ${CLIPBOARD} de un snippet de extensión: fuera. Si no, aceptar un
// autocompletado metería tu portapapeles en un documento que la extensión lee.
export function stripClipboard(snippet) {
  const s = String(snippet ?? '');
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length) { out += s[i] + s[i + 1]; i += 2; continue; }
    if (s[i] === '$') {
      const bare = /^\$CLIPBOARD(?![A-Za-z0-9_])/.exec(s.slice(i));
      if (bare) { i += bare[0].length; continue; }
      if (s[i + 1] === '{' && /^\$\{CLIPBOARD(?![A-Za-z0-9_])/.test(s.slice(i))) {
        // salta hasta la llave que cierra, respetando las anidadas y los escapes
        let depth = 0, j = i + 1;
        for (; j < s.length; j++) {
          if (s[j] === '\\') { j++; continue; }
          if (s[j] === '{') depth++;
          else if (s[j] === '}' && --depth === 0) break;
        }
        i = j + 1;
        continue;
      }
    }
    out += s[i++];
  }
  return out;
}

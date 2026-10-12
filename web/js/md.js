// Markdown mínimo y SEGURO para el chat (estilo plugin de agente):
// escapa TODO el HTML primero y luego aplica transformaciones acotadas.
// Soporta: bloques de código con ```, `inline`, **negrita**, *cursiva* y _cursiva_,
// #### títulos, listas con - o numeradas, y saltos de línea.
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SENT = '\u0000'; // centinela imposible en texto normal (escrito como \u0000: un NUL literal hace que git trate el fichero como binario)

export function renderMarkdown(text) {
  // 1) apartar los bloques de código (no se tocan por dentro)
  const blocks = [];
  let t = String(text).replace(/```(\w*)[ \t]*\n?([\s\S]*?)(?:```|$)/g, (_, lang, body) => {
    blocks.push({ lang, body });
    return SENT + (blocks.length - 1) + SENT;
  });

  t = esc(t);
  // `inline` también se aparta: dentro de código no se aplica ningún énfasis
  // (antes `def f(_x_)` salía con la x en cursiva y sin los guiones bajos, y
  // con *asteriscos* pasaba lo mismo). Se repone al final.
  const inline = [];
  t = t.replace(/`([^`\n]+)`/g, (_, code) => { inline.push(code); return SENT + 'i' + (inline.length - 1) + SENT; });
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>');
  // _cursiva_ también (el informe del cerebro la usa y salían los guiones bajos
  // tal cual). Solo con espacio o paréntesis delante: un nombre_con_guiones de
  // código no se toca.
  t = t.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/gm, '$1<i>$2</i>');
  t = t.replace(/^#{1,6}\s*(.+)$/gm, '<h4>$1</h4>');
  t = t.replace(/^\s*[-•]\s+(.+)$/gm, '<li>$1</li>');
  t = t.replace(/^\s*\d+\.\s+(.+)$/gm, '<li class="num">$1</li>');
  t = t.replace(/(?:<li[^>]*>.*<\/li>\n?)+/g, m => '<ul>' + m.replace(/\n/g, '') + '</ul>');

  // saltos de línea: sin <br> pegado a etiquetas de bloque
  t = t.replace(/\n(?=<(?:ul|h4))/g, '').replace(/(<\/(?:ul|h4)>)\n/g, '$1');
  t = t.replace(/\n/g, '<br>');

  t = t.replace(new RegExp(SENT + 'i(\\d+)' + SENT, 'g'), (_, i) => '<code>' + inline[+i] + '</code>');

  // 2) restaurar bloques de código
  t = t.replace(new RegExp(SENT + '(\\d+)' + SENT, 'g'), (_, i) => {
    const { lang, body } = blocks[+i];
    return `<pre class="codeblock">${lang ? `<span class="lang">${esc(lang)}</span>` : ''}<code>${esc(body.replace(/\n$/, ''))}</code></pre>`;
  });
  return t;
}

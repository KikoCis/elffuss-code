// Frase legible por humano para una tool-call («leyendo app.js…»). Compartido
// por el cerebro CEO (ceo.js) y el streaming en vivo del chat (main.js) — así
// nunca se le enseña JSON crudo al usuario, siempre la misma redacción.
export function humanizeTool(name, args) {
  const p = args?.path, q = args?.query, c = args?.command;
  switch (name) {
    case 'code.read': return `leyendo ${p}…`;
    case 'code.write': return `escribiendo ${p}…`;
    case 'code.tree': return `explorando ${p || 'el proyecto'}…`;
    case 'code.search': return `buscando «${q}»…`;
    case 'terminal.run': return `ejecutando: ${c}`;
    case 'web.search': return `buscando en internet «${q}»…`;
    case 'web.fetch': return `leyendo ${p || args?.url}…`;
    default: return name + (p || q || c ? ' ' + (p || q || c) : '');
  }
}

// Detecta si el buffer que va llegando EN STREAMING ha entrado en un bloque de
// tool-call (```tool { … }) y, si es así, devuelve una frase humana en vez del
// JSON crudo — «preparando una acción…» hasta que el nombre de la tool sea
// legible, luego «leyendo app.js…» tan pronto como el campo aparezca, aunque
// el JSON todavía no haya cerrado.
export function humanizeStreamPreview(buf) {
  if (buf.search(/```/) === -1 && !/^\s*\{\s*"tool"/.test(buf)) return null;
  const toolM = buf.match(/"tool"\s*:\s*"([\w.]+)"/);
  if (!toolM) return 'preparando una acción…';
  const pathM = buf.match(/"path"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const queryM = buf.match(/"query"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const cmdM = buf.match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const out = humanizeTool(toolM[1], { path: pathM?.[1], query: queryM?.[1], command: cmdM?.[1] });
  // el nombre de la tool ya se ve pero su campo (path/query/…) aún no llegó:
  // mejor el genérico que un «leyendo undefined…» a medio streamear
  return /undefined/.test(out) ? 'preparando una acción…' : out;
}

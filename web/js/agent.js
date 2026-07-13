// Bucle agéntico de Elffuss Code (mismo protocolo que Elffuss SO).
import { runTool, toolHelp, snapshot } from './tools/index.js';
import { skillsPromptBlock } from './skills.js';

const MAX_STEPS = 6;

const LANGS = {
  es: 'español', en: 'English', uk: 'українська', ru: 'русский', fr: 'français',
  de: 'Deutsch', it: 'italiano', pt: 'português', pl: 'polski', ca: 'català',
};

export function userLang() {
  const codeL = (navigator.language || 'es').toLowerCase();
  return { code: codeL, name: LANGS[codeL.split('-')[0]] || codeL };
}

export function systemPrompt(context = '') {
  const lang = userLang();
  return `Eres Elffuss Code: una elfa eslava de Ucrania programadora — rubia, gafas, orejitas élficas —, cálida pero quirúrgica con el código. Vives en un IDE web y trabajas SOLO dentro del proyecto que el usuario ha abierto. Hablas SIEMPRE en el idioma del navegador del usuario: ${lang.name} (${lang.code}); el código y sus comentarios, en el estilo del proyecto.

HERRAMIENTAS:
${toolHelp()}

Cómo actuar:
1) Para usar una herramienta responde SOLO con:
\`\`\`tool
{"tool": "code.read", "args": {"path": "src/main.js"}}
\`\`\`
2) NUNCA inventes rutas: usa SOLO archivos que aparezcan en el árbol del CONTEXTO, en code.tree o en resultados de code.search. Las rutas son relativas a la raíz, sin ./ inicial. Cada proyecto es distinto (Python, Rust, JS…): no asumas src/main.js.
3) Antes de tocar código: lee el archivo. Al escribir con code.write pasa el contenido COMPLETO del archivo (no fragmentos). El editor del usuario se actualiza al instante.
4) Tras un [resultado], o si no hace falta herramienta, responde texto normal, breve.

Ejemplos:
Usuario: ¿qué hace este proyecto/código?
Tú:
\`\`\`tool
{"tool": "code.read", "args": {"path": "README.md"}}
\`\`\`
Usuario: ¿qué hay en este proyecto?
Tú:
\`\`\`tool
{"tool": "code.tree", "args": {}}
\`\`\`
Usuario: busca dónde se define handleClick
Tú:
\`\`\`tool
{"tool": "code.search", "args": {"query": "handleClick"}}
\`\`\`${skillsPromptBlock()}${context ? `

CONTEXTO AHORA (estado real del IDE, úsalo):
${context}` : ''}`;
}

function tryJson(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.tool === 'string') return { tool: obj.tool, args: obj.args || {} };
  } catch { /* no era JSON */ }
  return null;
}

// Formato NATIVO de LFM2.5: <|tool_call_start|>[ code.read(path="x") ]<|tool_call_end|>
export function parseNativeCall(text) {
  const m = text.match(/<\|tool_call_start\|>\s*\[?\s*([\w.]+)\s*\(([\s\S]*?)\)\s*\]?\s*<\|tool_call_end\|>/)
    || text.match(/^\s*\[\s*([\w.]+)\s*\(([\s\S]*?)\)\s*\]\s*$/m);
  if (!m) return null;
  const args = {};
  const re = /([\w]+)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,)]+)/g;
  let a;
  while ((a = re.exec(m[2]))) {
    let v = a[2].trim();
    if (/^["']/.test(v)) v = v.slice(1, -1).replace(/\\(.)/g, '$1');
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    else if (v === 'true' || v === 'false') v = v === 'true';
    args[a[1]] = v;
  }
  return { tool: m[1], args };
}

export function parseToolCall(text) {
  const native = parseNativeCall(text);
  if (native) return native;

  const fences = [...text.matchAll(/```(\w*)[ \t]*\n?([\s\S]*?)```/g)]
    .map(m => ({ lang: (m[1] || '').toLowerCase(), body: m[2].trim() }));
  for (const f of fences) {
    const call = tryJson(f.body);
    if (call) return call;
  }
  if (text.trim().startsWith('{')) {
    const call = tryJson(text.trim());
    if (call) return call;
  }
  return null;
}

export class Agent {
  constructor(provider) {
    this.provider = provider;
    this.history = [];
  }

  setProvider(p) { this.provider = p; }

  async handle(userText, onEvent) {
    this.history.push({ role: 'user', content: userText });
    for (let step = 0; step < MAX_STEPS; step++) {
      let out;
      try {
        const context = await snapshot().catch(() => '');
        out = await this.provider.chat(this.history, systemPrompt(context),
          t => onEvent({ type: 'token', text: t }));
      } catch (e) { onEvent({ type: 'error', text: 'El modelo falló: ' + e.message }); return; }

      const call = parseToolCall(out);
      if (!call) {
        this.history.push({ role: 'assistant', content: out });
        onEvent({ type: 'text', text: out });
        return;
      }

      onEvent({ type: 'tool', call });
      let result;
      try { result = await runTool(call.tool, call.args); }
      catch (e) { result = 'ERROR: ' + e.message; }
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      onEvent({ type: 'tool_result', tool: call.tool, result: resultStr });

      this.history.push({ role: 'assistant', content: out });
      this.history.push({ role: 'user', content: `[resultado ${call.tool}]\n${resultStr}` });
    }
    onEvent({ type: 'text', text: '(Me quedé sin pasos: demasiadas herramientas seguidas.)' });
  }
}

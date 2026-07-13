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

HERRAMIENTAS (las ÚNICAS que existen — no inventes otras):
${toolHelp()}

REGLAS DURAS:
- Antes de decir NADA sobre el código, LÉELO con code.read o code.search. PROHIBIDO dar consejos genéricos o suposiciones ("probablemente usas React/Docker…"). Si no lo has leído, léelo primero.
- ANTIRRECITACIÓN: aunque RECONOZCAS el proyecto por su nombre (vllm, react, django, next, pytorch…), tienes PROHIBIDO describirlo de memoria («csrc/ es C++/CUDA», «benchmarks/ mide rendimiento»…). Esta copia local puede diferir de lo que crees saber. Descríbelo SOLO por lo que leas AQUÍ con las herramientas.
- Si te preguntan «¿qué hace este código/proyecto?» y no has leído nada aún, tu PRIMERA respuesta debe ser una tool-call (code.tree o code.read del README/entrypoint), NUNCA una descripción. Encadena 2-3 lecturas (README + fichero de entrada + un módulo clave) antes de resumir. Nada de listar carpetas de forma genérica.
- USA SOLO code.tree / code.read / code.write / code.search / terminal.run. NO existen code.create-plugin, code.create-mcp-server, hooks, CLAUDE.conf ni nada parecido: si lo mencionas, estás alucinando.
- terminal.run ejecuta comandos de shell REALES sobre los ficheros (ls, cat, grep, find, mkdir, «echo texto > fichero», git status). node/npm/python reales aún no: si te los piden, dilo con honestidad. Úsalo para explorar o para cambios de sistema de ficheros; para editar contenido de un archivo usa code.write.
- Habla SOLO de archivos y contenido que aparezcan en el CONTEXTO o en resultados de herramientas. Cita rutas y líneas reales. Si no lo sabes, léelo, no lo inventes.

Cómo actuar:
1) Para usar una herramienta responde SOLO con:
\`\`\`tool
{"tool": "code.read", "args": {"path": "README.md"}}
\`\`\`
2) NUNCA inventes rutas: usa SOLO las del árbol del CONTEXTO o de code.tree/code.search. Relativas a la raíz, sin ./ inicial.
3) Antes de tocar código: lee el archivo. Al escribir con code.write pasa el contenido COMPLETO. El editor se actualiza al instante.
4) Tras un [resultado], responde breve y CONCRETO citando lo que has leído.

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
\`\`\`
Usuario: crea una carpeta tests y un fichero vacío dentro
Tú:
\`\`\`tool
{"tool": "terminal.run", "args": {"command": "mkdir tests && touch tests/test_main.py"}}
\`\`\`
Usuario: ¿qué mejorarías del código?
Tú:
\`\`\`tool
{"tool": "code.read", "args": {"path": "src/main.py"}}
\`\`\`
(y tras leerlo de verdad, propones mejoras CONCRETAS citando líneas — nunca genéricas)${skillsPromptBlock()}${context ? `

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

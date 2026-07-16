// Bucle agéntico de Elffuss Code (mismo protocolo que Elffuss SO).
import { runTool, toolHelp, snapshot } from './tools/index.js';
import { skillsPromptBlock } from './skills.js';

const MAX_STEPS = 12; // margen para tareas largas (leer→editar→verificar→arreglar…)

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
  return `Eres Elffuss Code: un asistente de programación, cálido pero quirúrgico con el código. Vives en un IDE web y trabajas SOLO dentro del proyecto que el usuario ha abierto. Hablas SIEMPRE en el idioma del navegador del usuario: ${lang.name} (${lang.code}); el código y sus comentarios, en el estilo del proyecto.

HERRAMIENTAS (las ÚNICAS que existen — no inventes otras):
${toolHelp()}

REGLAS DURAS:
- Antes de decir NADA sobre el código, LÉELO con code.read o code.search. PROHIBIDO dar consejos genéricos o suposiciones ("probablemente usas React/Docker…"). Si no lo has leído, léelo primero.
- ANTIRRECITACIÓN: aunque RECONOZCAS el proyecto por su nombre (vllm, react, django, next, pytorch…), tienes PROHIBIDO describirlo de memoria («csrc/ es C++/CUDA», «benchmarks/ mide rendimiento»…). Esta copia local puede diferir de lo que crees saber. Descríbelo SOLO por lo que leas AQUÍ con las herramientas.
- Si te preguntan «¿qué hace este código/proyecto?» y no has leído nada aún, tu PRIMERA respuesta debe ser una tool-call (code.tree o code.read del README/entrypoint), NUNCA una descripción. Encadena 2-3 lecturas (README + fichero de entrada + un módulo clave) antes de resumir. Nada de listar carpetas de forma genérica.
- USA SOLO code.tree / code.read / code.write / code.search / terminal.run / web.search / web.fetch. NO existen code.create-plugin, code.create-mcp-server, hooks, CLAUDE.conf ni nada parecido: si lo mencionas, estás alucinando.
- ⛔ NUNCA recomiendes «automatizaciones de Claude Code»: MCP servers (context7, «claude mcp add …»), skills, hooks (.claude/settings.json, pre-commit), subagentes (.claude/agents/…), plugins, CLAUDE.conf. NADA de eso existe en este IDE — es conocimiento de tu entrenamiento, no de este proyecto. Si te descubres escribiendo «Recomendaciones de automatización», «MCP Servers», «Skills», «Hooks», «Subagentes» → PARA: es pura alucinación. Ayuda con el CÓDIGO REAL que lees, nada más.
- web.search busca en internet DE SERIE (docs, mensajes de error, APIs) y web.fetch lee una URL. PUEDES buscar en internet cuando ayude; NUNCA digas que no puedes.
- terminal.run ejecuta comandos de shell REALES (ls, cat, grep, find, mkdir, «echo texto > fichero», git status). Le pasas la LÍNEA DE COMANDO exacta, NUNCA lenguaje natural (mal: terminal.run "crea un proyecto"; bien: terminal.run "mkdir web"). rm SÍ soporta comodines («rm carpeta/mejoras-*.md» borra todos los que coincidan) — si «no existe», es que de verdad no hay ninguno, no lo des por hecho sin comprobarlo con ls/find antes. node/npm/python reales aún no: si te los piden, dilo con honestidad.
- CREAR ficheros/proyectos: SIEMPRE con code.write (crea también las carpetas necesarias), UNA tool-call por fichero, con el CONTENIDO COMPLETO en cada una. NUNCA uses touch/echo para crear un fichero que luego rellenas (quedan vacíos). PUEDES crear cualquier proyecto aquí mismo; PROHIBIDO responder «no puedo crear un proyecto» o pedir permiso o el framework: si el usuario no lo dice, elige HTML/CSS/JS simple y escríbelo ya. Puedes emitir VARIAS code.write en un mismo mensaje y se ejecutan todas.
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
Usuario: crea un mini proyecto web que explique esto
Tú: (SIN pedir permiso ni framework — escribe los ficheros con contenido COMPLETO, varias code.write a la vez)
\`\`\`tool
{"tool": "code.write", "args": {"path": "web/index.html", "content": "<!DOCTYPE html>\\n<html>…página completa…</html>"}}
\`\`\`
\`\`\`tool
{"tool": "code.write", "args": {"path": "web/style.css", "content": "body{font-family:system-ui;margin:0}…"}}
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

// Extrae UNA tool-call (compat). Prefiere la primera de parseToolCalls.
export function parseToolCall(text) {
  return parseToolCalls(text)[0] || null;
}

// Extrae TODAS las tool-calls de un mensaje, en orden. El modelo pequeño a
// menudo emite varias (p. ej. tres code.write para crear tres ficheros) o las
// mete en prosa sin un fence ```tool perfecto → antes solo se ejecutaba la
// primera (o ninguna) y los ficheros quedaban VACÍOS. Aquí buscamos cada objeto
// {"tool":...} por llaves balanceadas, esté donde esté, además del formato nativo.
export function parseToolCalls(text) {
  const calls = [];
  const seen = new Set();
  const push = c => {
    if (!c || typeof c.tool !== 'string') return;
    const k = c.tool + '|' + JSON.stringify(c.args || {});
    if (!seen.has(k)) { seen.add(k); calls.push(c); }
  };
  // 1) formato nativo LFM (puede haber varios)
  const nat = /<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g;
  let mm;
  while ((mm = nat.exec(text))) push(parseNativeCall(mm[0]));
  // 2) cada objeto JSON que empiece por {"tool": … (con o sin fence)
  const re = /\{\s*"tool"\s*:/g;
  let m;
  while ((m = re.exec(text))) {
    const obj = extractBalanced(text, m.index);
    if (obj) { push(tryJson(obj)); re.lastIndex = m.index + obj.length; }
  }
  // 3) último recurso: nativo suelto de una línea
  if (!calls.length) push(parseNativeCall(text));
  return calls;
}

// Desde el '{' en `start`, devuelve la subcadena hasta la '}' que balancea,
// respetando cadenas y escapes (para no cortar un content con llaves dentro).
function extractBalanced(text, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    else if (!inStr) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
    }
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

      const calls = parseToolCalls(out);
      if (!calls.length) {
        this.history.push({ role: 'assistant', content: out });
        onEvent({ type: 'text', text: out });
        return;
      }

      // Ejecutar TODAS las tool-calls del mensaje en orden (varios code.write =
      // varios ficheros con contenido, no vacíos).
      this.history.push({ role: 'assistant', content: out });
      const results = [];
      for (const call of calls) {
        onEvent({ type: 'tool', call });
        let result;
        try { result = await runTool(call.tool, call.args); }
        catch (e) { result = 'ERROR: ' + e.message; }
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        onEvent({ type: 'tool_result', tool: call.tool, result: resultStr });
        results.push(`[resultado ${call.tool}]\n${resultStr}`);
      }
      this.history.push({ role: 'user', content: results.join('\n\n') });
    }
    onEvent({ type: 'text', text: '(Me quedé sin pasos: demasiadas herramientas seguidas.)' });
  }
}

// Bucle agéntico de Elffuss Code (mismo protocolo que Elffuss SO).
import { runTool, toolHelp, snapshot, PARAM_EXACTO, PARAM_NUMERO } from './tools/index.js';
import { skillsPromptBlock } from './skills.js';
import * as telemetry from './telemetry.js';

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

  // Versión corta para modelos LENTOS, que no es lo mismo que modelos pequeños:
  // al 27B propio le CABRÍA el prompt completo si tuviera más contexto, pero
  // cada token de prompt se paga en segundos antes de la primera letra.
  //
  // Y no era solo lentitud. El prompt completo son 2.217 tokens —contados con el
  // tokenizador del propio modelo, no estimados por caracteres— contra un techo
  // duro de 1.952: el contexto de 2048 menos la reserva que el motor guarda para
  // la respuesta. O sea que el motor lanzaba «las instrucciones ocupan N
  // tokens…» ANTES de procesar nada. Con el 27B, Code no estaba lento: NO
  // ARRANCABA, y desde fuera las dos cosas se parecen demasiado.
  //
  // Esta versión son 828 tokens, y deja 1.124 para el árbol del IDE y la
  // conversación, que antes se quedaban en negativo.
  //
  // El catálogo de herramientas se conserva ENTERO a propósito. Un Code sin
  // herramientas carga, responde y no sirve para nada, que es peor que fallar
  // fuerte: lo que se recorta es prosa y ejemplos, no capacidades.
  // La rama de prompt COMPACTO se ha retirado. Recortarlo dejaba al modelo sin
  // saber hacer tareas —el motivo de ponerlo era que el completo tarda más en
  // procesarse— y un asistente que carga, responde y no sirve para nada es peor
  // que uno lento. El coste del prompt completo se ataca reutilizando el
  // prefijo entre turnos y guardando el estado entre sesiones, no recortándole
  // al modelo lo que sabe hacer.
  //
  // ⚠️ Y la premisa de la cuenta de arriba YA NO SE CUMPLE: los tres modelos del
  // registro están a 65.536 de contexto, no a 2.048, así que el techo duro de
  // 1.952 no ata a ninguno y el prompt completo cabe de sobra. Queda escrito
  // porque explica POR QUÉ se retiró la rama compacta, no porque haya que
  // recortar: si alguien vuelve a plantearlo, que sea midiendo el contexto de HOY
  // y no reciclando esta cuenta.

  return `Eres Elffuss Code: un asistente de programación, cálido pero quirúrgico con el código. Vives en un IDE web y trabajas SOLO dentro del proyecto que el usuario ha abierto. Hablas SIEMPRE en el idioma del navegador del usuario: ${lang.name} (${lang.code}); el código y sus comentarios, en el estilo del proyecto.

HERRAMIENTAS (las ÚNICAS que existen — no inventes otras):
${toolHelp()}

REGLAS DURAS:
- Antes de decir NADA sobre el código, LÉELO con code.read o code.search. PROHIBIDO dar consejos genéricos o suposiciones ("probablemente usas React/Docker…"). Si no lo has leído, léelo primero.
- ANTIRRECITACIÓN: aunque RECONOZCAS el proyecto por su nombre (vllm, react, django, next, pytorch…), tienes PROHIBIDO describirlo de memoria («csrc/ es C++/CUDA», «benchmarks/ mide rendimiento»…). Esta copia local puede diferir de lo que crees saber. Descríbelo SOLO por lo que leas AQUÍ con las herramientas.
- Si te preguntan «¿qué hace este código/proyecto?» y no has leído nada aún, tu PRIMERA respuesta debe ser una tool-call (code.tree o code.read del README/entrypoint), NUNCA una descripción. Encadena 2-3 lecturas (README + fichero de entrada + un módulo clave) antes de resumir. Nada de listar carpetas de forma genérica.
- USA SOLO code.tree / code.read / code.run / code.edit / code.write / code.search / terminal.run / web.search / web.fetch. NO existen code.create-plugin, code.create-mcp-server, hooks, CLAUDE.conf ni nada parecido: si lo mencionas, estás alucinando.
- ⛔ NUNCA recomiendes «automatizaciones de agentes de terceros»: MCP servers (context7, «claude mcp add …»), skills, hooks (.claude/settings.json, pre-commit), subagentes (.claude/agents/…), plugins, CLAUDE.conf. NADA de eso existe en este IDE — es conocimiento de tu entrenamiento, no de este proyecto. Si te descubres escribiendo «Recomendaciones de automatización», «MCP Servers», «Skills», «Hooks», «Subagentes» → PARA: es pura alucinación. Ayuda con el CÓDIGO REAL que lees, nada más.
- web.search busca en internet DE SERIE (docs, mensajes de error, APIs) y web.fetch lee una URL. PUEDES buscar en internet cuando ayude; NUNCA digas que no puedes.
- terminal.run ejecuta comandos de shell REALES (ls, cat, grep, find, mkdir, «echo texto > fichero», git status). Le pasas la LÍNEA DE COMANDO exacta, NUNCA lenguaje natural (mal: terminal.run "crea un proyecto"; bien: terminal.run "mkdir web"). rm SÍ soporta comodines («rm carpeta/mejoras-*.md» borra todos los que coincidan) — si «no existe», es que de verdad no hay ninguno, no lo des por hecho sin comprobarlo con ls/find antes. node/npm/python SÍ son reales si el usuario tiene el Bridge local conectado (⚙ Ajustes → 🔌 Bridge local) — pruébalos con terminal.run y lee el resultado; si el bridge no está conectado, la propia herramienta te lo dice con el mensaje de error, y ENTONCES le pides al usuario que lo conecte (no lo asumas de antemano sin probar).
- TRANSFORMAR o CALCULAR sobre un fichero (escalar un modelo 3D, convertir un CSV, recortar, renombrar en lote) se hace AQUÍ y con lo que hay. PROHIBIDO contestar «mis herramientas son solo código, texto y comandos de shell» y concluir de ahí que no puedes: un fichero son BYTES, y estas herramientas leen y escriben bytes. Dos caminos, y ninguno necesita instalar nada:
    · TEXTO que cabe (un STL ASCII, un CSV, un SVG, un JSON): code.read, lo transformas tú y code.write. Eso es todo.
    · grande o BINARIO: code.write un script y terminal.run «node script.mjs». El bridge trae node.
- ⛔ NUNCA pongas una librería de terceros como REQUISITO («necesitarías numpy-stl», «¿tienes instalado X?», «¿quieres que lo instale?») ni te ofrezcas y esperes («¿quieres que te cree el script?»). Si crees que falta algo, PRUÉBALO con terminal.run y lee el error en vez de preguntar; y si de verdad no está, resuélvelo sin ello: escalar un STL es multiplicar números, no necesita ninguna librería. Ofrecerse y quedarse esperando es la peor respuesta que puedes dar — hazlo y enseña el resultado.
- code.run NO toca ficheros: corre un módulo del proyecto en un worker y te dice qué DEVUELVE una expresión («m.suma(2,3)»). Sirve para COMPROBAR que lo que acabas de escribir funciona de verdad, no para transformar datos ni para leer el disco.
- CREAR ficheros/proyectos: SIEMPRE con code.write (crea también las carpetas necesarias), UNA tool-call por fichero, con el CONTENIDO COMPLETO en cada una. NUNCA uses touch/echo para crear un fichero que luego rellenas (quedan vacíos). PUEDES crear cualquier proyecto aquí mismo; PROHIBIDO responder «no puedo crear un proyecto» o pedir permiso o el framework: si el usuario no lo dice, elige HTML/CSS/JS simple y escríbelo ya. Puedes emitir VARIAS code.write en un mismo mensaje y se ejecutan todas.
- MODIFICAR un fichero que YA existe: usa code.edit (search→replace de SOLO las líneas que cambian), NO reescribas el fichero entero con code.write. Reescribir un fichero grande entero es lento, gasta muchísimos tokens y es fácil que se trunque o se altere lo que no debía; code.edit cambia solo el trozo y conserva el resto intacto. code.write es para CREAR ficheros nuevos (o una reescritura total que el usuario pida a propósito), no para un cambio puntual.
- Habla SOLO de archivos y contenido que aparezcan en el CONTEXTO o en resultados de herramientas. Cita rutas y líneas reales. Si no lo sabes, léelo, no lo inventes.

Cómo actuar:
1) Para usar una herramienta responde SOLO con:
\`\`\`tool
{"tool": "code.read", "args": {"path": "README.md"}}
\`\`\`
2) NUNCA inventes rutas: usa SOLO las del árbol del CONTEXTO o de code.tree/code.search. Relativas a la raíz, sin ./ inicial.
3) Antes de tocar código: léelo (code.read). Para MODIFICARLO usa code.edit (cambia solo las líneas necesarias, sin reescribir el resto). Para CREAR un fichero nuevo usa code.write con el contenido completo. El editor se actualiza al instante.
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
{"tool": "code.write", "args": {"path": "web/index.html", "content": "<!DOCTYPE html>\\n<html lang=\\"es\\">\\n<head><meta charset=\\"utf-8\\"><title>Notas</title></head>\\n<body><h1>Notas</h1></body>\\n</html>"}}
\`\`\`
\`\`\`tool
{"tool": "code.write", "args": {"path": "web/style.css", "content": "body{font-family:system-ui;margin:0}…"}}
\`\`\`
Usuario: cambia el puerto 3000 por 8080 en server.js
Tú: (NO reescribas el fichero entero — edita SOLO esa línea)
\`\`\`tool
{"tool": "code.edit", "args": {"path": "server.js", "search": "const PORT = 3000", "replace": "const PORT = 8080"}}
\`\`\`
Usuario: ¿qué mejorarías del código?
Tú:
\`\`\`tool
{"tool": "code.read", "args": {"path": "src/main.py"}}
\`\`\`
(y tras leerlo de verdad, propones mejoras CONCRETAS citando líneas — nunca genéricas)${skillsPromptBlock()}`;
}

export const ETIQUETA_CONTEXTO = 'CONTEXTO AHORA (estado real del IDE, úsalo):';

// ── Dónde va el estado vivo, y por qué NO va en el prompt de sistema ────────
// El bloque «CONTEXTO AHORA» estaba dentro de `systemPrompt()`, y el motor monta
// el prompt poniendo el system ENTERO en la cabeza, delante de toda la historia
// (`montarPrompt` en provider.js). La reutilización de prefijo compara tokens
// desde el principio y se corta en la primera divergencia, así que cualquier
// cambio en ese bloque invalidaba el prefijo COMPLETO: el prompt de sistema
// entero más toda la conversación.
//
// Y ese bloque cambia constantemente —es estado vivo— así que en la práctica la
// caché de prefijo no servía casi nunca. Medido el 2026-10-10: con un prompt
// realista el prefill del modelo grande es la espera mas larga del producto,
// y un turno con
// herramientas pagaba eso EN CADA PASO del bucle, porque cada paso cambia el
// estado y por tanto la cabeza.
//
// Ahora el estado vivo viaja como un MENSAJE, colocado justo antes del último
// de la conversación. Así el prefijo común cubre el prompt de sistema y toda la
// historia anterior, y solo se reprocesa lo nuevo.
//
// ⚠️ Va antes del ÚLTIMO mensaje, no al final, a propósito: el empaquetador de
// contexto elige la «pregunta viva» como el último mensaje de usuario que no
// empiece por «[resultado», y si este bloque fuera el último se convertiría en
// la pregunta viva y la recuperación puntuaría contra un volcado de estado en
// vez de contra lo que ha pedido el usuario.
//
// Va marcado `efimero`: cambia en cada llamada y no es parte de la conversación.
// LiteRT, que guarda la conversación entre llamadas, lo salta al comprobar de
// qué conversación es un historial (ver dondeSigue en providers/litert.js). La
// marca no es enumerable: no viaja en el JSON que se manda a ninguna API.
export function mensajeContexto(context, etiqueta) {
  if (!context) return null;
  return Object.defineProperty({ role: 'user', content: `${etiqueta}\n${context}` }, 'efimero', { value: true });
}

// Inserta el estado vivo justo antes del último mensaje de la conversación.
export function conContexto(history, context, etiqueta) {
  const m = mensajeContexto(context, etiqueta);
  if (!m) return history;
  if (!history.length) return [m];
  return [...history.slice(0, -1), m, history[history.length - 1]];
}


// Repara el JSON que emiten los modelos pequeños: coma final + saltos de línea/
// tab/CR LITERALES dentro de cadenas (un HTML escrito «tal cual» en content los
// lleva y rompen JSON.parse). No resuelve comillas internas sin escapar — de eso
// se encarga looseToolCall.
function repairJson(raw) {
  const s = raw.replace(/,(\s*[}\]])/g, '$1');   // coma final
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') {
      // Una barra solo abre un escape si lo que sigue PUEDE escaparse. Un modelo
      // que escribe una continuación de línea de shell dentro del valor («echo
      // uno \» + salto de línea REAL) no está escapando nada, y tratarlo como si
      // lo fuera dejaba una barra pegada a un salto crudo —que no parsea— y más
      // abajo acababa convertido en barra más la letra «n», con el salto
      // perdido: un script roto escrito en silencio. Si no es un escape válido,
      // la barra se escapa a sí misma y del carácter siguiente ya se encargan
      // las ramas de abajo.
      if (inStr && !'"\\/bfnrtu'.includes(s[i + 1] ?? '')) { out += '\\\\'; continue; }
      out += ch; esc = true; continue;
    }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr && ch === '\n') { out += '\\n'; continue; }
    if (inStr && ch === '\r') { out += '\\r'; continue; }
    if (inStr && ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return out;
}

// Extractor TOLERANTE de una tool-call, dirigido por claves. La forma es fija
// ({"tool":"…","args":{…}}), así que localizamos cada clave conocida y leemos su
// valor hasta la comilla de cierre REAL (la « seguida de , " o }} »), tolerando
// comillas y saltos de línea sin escapar dentro del valor (lo típico en un HTML).
function looseToolCall(raw) {
  const tm = raw.match(/"tool"\s*:\s*"([\w.]+)"/);
  if (!tm) return null;
  const am = raw.match(/"args"\s*:\s*\{/);
  const body = am ? raw.slice(am.index + am[0].length) : raw;
  const args = {};
  for (const key of ['path', 'content', 'search', 'replace', 'query', 'ext', 'command']) {
    const km = body.match(new RegExp('"' + key + '"\\s*:\\s*"'));
    if (!km) continue;
    // El cierre REAL se elige mirando todos los candidatos y quedándose con el
    // ÚLTIMO que deje el objeto bien cerrado detrás, no con el primero.
    //
    // El primero se equivoca en cuanto el valor lleva una comilla seguida de
    // «, "», que es lo que parece el final de un valor y el principio de la
    // clave siguiente. Con `"content": "console.log("a", "b")\n"` cortaba en
    // `console.log("a` y escribía ESE fichero diciendo «Escrito»: un JS roto,
    // en silencio, y con el aviso de éxito puesto.
    //
    // Y no basta con coger el último: se exige que lo que venga después cierre
    // el objeto. Si ningún candidato lo consigue, no se recupera nada, que es lo
    // correcto cuando el mensaje se cortó a media escritura — completarlo sería
    // inventar un contenido que el modelo no escribió.
    const desde = km.index + km[0].length;
    const candidatos = [];
    for (let i = desde; i < body.length; i++) {
      const ch = body[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '"' && /^\s*(,\s*"|\}\s*[}\]]|\}\s*$|$)/.test(body.slice(i + 1))) candidatos.push(i);
    }
    let val = null;
    for (let k = candidatos.length - 1; k >= 0; k--) {
      if (/^\s*(,|\})/.test(body.slice(candidatos[k] + 1))) { val = body.slice(desde, candidatos[k]); break; }
    }
    if (val === null) return null;
    try { val = JSON.parse('"' + val.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"'); } catch { /* crudo */ }
    args[key] = val;
  }
  for (const key of ['offset', 'limit', 'around', 'depth']) {
    const nm = body.match(new RegExp('"' + key + '"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)'));
    if (nm) args[key] = Number(nm[1]);
  }
  return { tool: tm[1], args };
}

function tryJson(raw) {
  for (const cand of [raw, repairJson(raw)]) {
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj.tool === 'string') return { tool: obj.tool, args: obj.args || {} };
    } catch { /* siguiente capa */ }
  }
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

// Formato `<function name="X"><param name="k">v</param></function>`, que es el
// que emite MiniCPM5 y varios modelos más. No es el que pide nuestro prompt
// —bloque ```tool con JSON— pero un modelo entrenado con otro formato lo emite
// igual por mucho que se le pida el nuestro, y entonces la llamada se imprime
// como texto y no se ejecuta NADA: el usuario ve al modelo "contestar" con una
// etiqueta XML y no pasa nada más.
//
// Se acepta el formato en vez de pelearse con el modelo. El valor de cada
// `param` se intenta leer como JSON —para que un 3 sea el número 3 y no "3"—
// y si no es JSON válido se queda como texto, que es lo que hay que hacer con
// una ruta.
// Lectura segura de las excepciones del contrato.
// ─────────────────────────────────────────────────────────────────────────────
// `PARAM_EXACTO['constructor']` no es undefined: es `Object.prototype.constructor`,
// o sea una función, así que `(mapa[x] || []).includes(...)` LANZA. Y el nombre de
// herramienta sale del texto del modelo, que puede decir `constructor`, `toString`
// o `__proto__`. Como `parseToolCalls` corre fuera del try/catch de `handle`, eso
// no daba una herramienta desconocida: tumbaba el turno entero.
const esDe = (mapa, herramienta, param) =>
  Object.hasOwn(mapa, herramienta) && Array.isArray(mapa[herramienta]) &&
  mapa[herramienta].includes(param);

// Un <function> completo, con su posición. El cuerpo se saca con un grupo
// atómico emulado —el `(?=(…))\3`— para que un `</function>` DENTRO de un CDATA
// no cierre la llamada: sin eso el cuerpo llegaba cortado, el <param> del
// contenido no casaba, y `code.write` escribía un fichero VACÍO (content vale ''
// por defecto). Una llamada sin cerrar no casa nada, que es lo que se quiere:
// mejor no ejecutar que ejecutar a medias.
const RE_FUNCION = /<function\s+name=["']([\w.\-]+)["']\s*>((?:(?=(<!\[CDATA\[[\s\S]*?\]\]>(?=\s*<\/param\s*>)))\3|[\s\S])*?)<\/function\s*>/g;

function tagsConPosicion(text) {
  const out = [];
  RE_FUNCION.lastIndex = 0;
  let m;
  while ((m = RE_FUNCION.exec(text))) {
    const herramienta = m[1];
    const args = {};
    // El `\s*` va DENTRO de la alternativa de CDATA, no antes: puesto fuera se
    // come la sangría de la primera línea del cuerpo normal.
    const pre = /<param\s+name=["']([\w.\-]+)["']\s*>(?:\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/param\s*>|([\s\S]*?)<\/param\s*>)/g;
    let p;
    while ((p = pre.exec(m[2]))) {
      const nombre = p[1];
      const enCdata = p[2] !== undefined;
      const crudo = enCdata ? p[2] : (p[3] || '');
      if (esDe(PARAM_EXACTO, herramienta, nombre)) {
        // El valor ES el fichero. Dentro de un CDATA, exacto y sin tocar. Fuera,
        // se quita UN salto de línea inicial y solo uno: el modelo abre el valor
        // en su propia línea y ese salto es formato suyo, no una primera línea en
        // blanco del fichero. El salto FINAL se conserva, que es el que un
        // fichero quiere tener. Quien necesite que el contenido empiece de verdad
        // con una línea en blanco tiene el CDATA.
        args[nombre] = enCdata ? crudo : crudo.replace(/^\r?\n/, '');
      } else {
        // Escalar: se recorta y se le quita UN par de comillas que lo envuelva.
        // Sin esto, un `path` que el modelo entrecomilla crea una carpeta «"src»
        // y un `around` entrecomillado da «líneas NaN-NaN». Un valor de verdad
        // no empieza y acaba por comilla; el contenido de un fichero sí puede, y
        // por eso esto NO se aplica a los exactos.
        let v = crudo.trim().replace(/^(["'])([\s\S]*)\1$/, '$2');
        if (esDe(PARAM_NUMERO, herramienta, nombre)) {
          const n = Number(v);
          // Si no es número se deja el texto: que el error salga donde se usa,
          // con el valor que mandó el modelo, y no un NaN callado.
          args[nombre] = (v !== '' && Number.isFinite(n)) ? n : v;
        } else {
          args[nombre] = v;
        }
      }
    }
    out.push({ pos: m.index, fin: m.index + m[0].length, tool: herramienta, args });
  }
  return out;
}

export function parseFunctionTags(text) {
  return tagsConPosicion(text).map(({ tool, args }) => ({ tool, args }));
}


// Extrae TODAS las tool-calls de un mensaje, en orden. El modelo pequeño a
// menudo emite varias (p. ej. tres code.write para crear tres ficheros) o las
// mete en prosa sin un fence ```tool perfecto → antes solo se ejecutaba la
// primera (o ninguna) y los ficheros quedaban VACÍOS. Aquí buscamos cada objeto
// {"tool":...} por llaves balanceadas, esté donde esté, además del formato nativo.
export function parseToolCalls(text) {
  // Cada hallazgo con su POSICIÓN, y los tramos de texto ya reclamados.
  //
  // Dos motivos, los dos con daño silencioso detrás (fuzz de T2T, 2026-10-12):
  //
  //  · ORDEN. Antes se metían primero todos los <function> y luego todos los
  //    bloques JSON, así que una respuesta que mezcla las dos formas ejecutaba
  //    las llamadas en un orden que no es el del texto. Con ficheros que
  //    dependen unos de otros, eso pierde líneas.
  //  · Y sobre todo: la pasada que busca `{"tool":` recorría TODO el texto,
  //    incluidos los VALORES de los <param>. Un README que documenta una
  //    llamada hacía que esa llamada SE EJECUTARA. Con un `code.edit` de
  //    ejemplo dentro, el parche salía con la condición invertida y el test de
  //    aceptación pasaba igual. Ahora lo que ya reclamó una llamada completa no
  //    se vuelve a mirar: lo citado se queda en texto.
  const hallados = [];
  const reclamado = [];
  const dentro = (i) => reclamado.some(([a, b]) => i >= a && i < b);

  // 1) formato nativo LFM (puede haber varios)
  const nat = /<\|tool_call_start\|>[\s\S]*?<\|tool_call_end\|>/g;
  let mm;
  while ((mm = nat.exec(text))) {
    const c = parseNativeCall(mm[0]);
    // Se reclama el tramo SOLO si de verdad se ha sacado una llamada. Si no, se
    // deja abierto a propósito: hay modelos que envuelven JSON en los
    // delimitadores nativos («<|tool_call_start|>{"tool":…}<|tool_call_end|>»),
    // que `parseNativeCall` rechaza con razón —espera `tool(arg=valor)`— y que
    // rescata la pasada de JSON de más abajo. Reclamarlo igual dejaba esas
    // llamadas sin ejecutar y sin decir nada.
    if (c) { hallados.push({ pos: mm.index, call: c }); reclamado.push([mm.index, mm.index + mm[0].length]); }
  }

  // 1b) formato <function><param> (MiniCPM5 y afines)
  for (const t of tagsConPosicion(text)) {
    hallados.push({ pos: t.pos, call: { tool: t.tool, args: t.args } });
    reclamado.push([t.pos, t.fin]);
  }

  // 2) cada objeto JSON que empiece por {"tool": … (con o sin fence), SALVO si
  //    cae dentro de algo ya reclamado.
  const re = /\{\s*"tool"\s*:/g;
  let m;
  while ((m = re.exec(text))) {
    if (dentro(m.index)) { re.lastIndex = m.index + 1; continue; }
    const obj = extractBalanced(text, m.index);
    let call = obj ? tryJson(obj) : null;
    // última capa: si ni el JSON estricto ni el reparado valen (comillas internas
    // sin escapar en el content, etc.), extractor tolerante desde el «{"tool"».
    if (!call) call = looseToolCall(text.slice(m.index));
    if (call) hallados.push({ pos: m.index, call });
    re.lastIndex = m.index + (obj ? obj.length : 1);
  }

  // Orden del TEXTO, y dedup estable.
  hallados.sort((a, b) => a.pos - b.pos);
  const calls = [];
  const seen = new Set();
  for (const { call: c } of hallados) {
    if (!c || typeof c.tool !== 'string') continue;
    const k = c.tool + '|' + JSON.stringify(c.args || {});
    if (seen.has(k)) continue;
    seen.add(k); calls.push(c);
  }

  // 3) último recurso: nativo suelto de una línea
  if (!calls.length) {
    const c = parseNativeCall(text);
    if (c && typeof c.tool === 'string') calls.push(c);
  }
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
  // Recuperación: los modelos pequeños a veces se dejan SIN escribir una
  // llave de cierre (cierran "args":{…} pero no el objeto exterior) aunque
  // el resto del JSON esté bien formado — antes esto tiraba el tool-call
  // entero (ninguna escritura llegaba a ejecutarse, sin aviso). Si al llegar
  // al final falta cerrar N llaves (fuera de cualquier cadena, así que no es
  // un truncado a media cadena) probamos a añadirlas — solo se acepta si el
  // JSON resultante es válido de verdad.
  if (!inStr && depth > 0 && depth <= 4) {
    const candidate = text.slice(start).replace(/```[\s\S]*$/, '').trimEnd() + '}'.repeat(depth);
    try { JSON.parse(candidate); return candidate; } catch { /* no se pudo recuperar */ }
  }
  return null;
}

export class Agent {
  constructor(provider) {
    this.provider = provider;
    this.history = [];
  }

  setProvider(p) { this.provider = p; }

  // Parar el agente en marcha: aborta la generación en curso (los proveedores
  // que reciben la señal la cortan) y hace que el bucle no dé más pasos.
  stop() { try { this._aborter?.abort(); } catch { /* */ } }

  // `signal` (opcional) es la parada de QUIEN LLAMA: la conversación, el modo
  // Objetivo o el cerebro CEO. Antes solo existía stop(), que aborta el turno
  // en curso y nada más: una parada que llegaba antes de que el turno empezara
  // (esperando el cerrojo de inferencia, entre dos tareas de un plan) no tenía
  // nada que abortar y el turno arrancaba igual.
  async handle(userText, onEvent, { signal: externa = null } = {}) {
    const aborter = (this._aborter = new AbortController());
    // Ya parado antes de empezar: ni se apunta el mensaje en el historial ni se
    // llama al modelo.
    if (externa?.aborted) { onEvent({ type: 'aborted', text: '(Parado.)' }); return; }
    const enlazar = () => aborter.abort();
    externa?.addEventListener('abort', enlazar, { once: true });
    try { return await this._turno(userText, onEvent, aborter.signal); }
    finally { externa?.removeEventListener('abort', enlazar); }
  }

  async _turno(userText, onEvent, signal) {
    // La marca temporal se pone AL AÑADIR, que es el único momento en que se
    // sabe: el gestor de contexto resuelve «ayer» con la fecha del turno en que
    // se dijo, no con la de ahora (ver annotateDates en acer-core.js). Sin esto
    // la anotación se calla, que es lo correcto, pero no sirve para nada.
    this.history.push({ role: 'user', content: userText, ts: Date.now() });
    for (let step = 0; step < MAX_STEPS; step++) {
      let out;
      try {
        if (signal.aborted) { onEvent({ type: 'aborted', text: '(Parado.)' }); return; }
        const context = await snapshot().catch(() => '');
        if (signal.aborted) { onEvent({ type: 'aborted', text: '(Parado.)' }); return; }
        // Se le PREGUNTA al proveedor si quiere prompt corto en vez de deducirlo
        // por tamaño de contexto: al 27B le cabría y aun así no debe recibirlo.
        // Quien no declare `prefiereCompacto` —todos los demás— recibe
        // exactamente el mismo prompt que antes; para ellos esto es inerte.
        out = await this.provider.chat(conContexto(this.history, context, ETIQUETA_CONTEXTO),
          systemPrompt(''),
          t => onEvent({ type: 'token', text: t }), signal);
      } catch (e) {
        // Parar no es un fallo del modelo. Los proveedores que cortan de verdad
        // (fetch abortado, generación interrumpida) LANZAN un AbortError, y esto
        // lo pintaba como «El modelo falló» y lo mandaba a telemetría como error.
        if (signal.aborted || e?.name === 'AbortError') { onEvent({ type: 'aborted', text: '(Parado.)' }); return; }
        telemetry.reportError('agent.handle: ' + e.message, { stack: e.stack || '' });
        onEvent({ type: 'error', text: 'El modelo falló: ' + e.message });
        return;
      }

      if (signal.aborted) { onEvent({ type: 'aborted', text: '(Parado.)' }); return; }
      const calls = parseToolCalls(out);
      if (!calls.length) {
        this.history.push({ role: 'assistant', content: out, ts: Date.now() });
        onEvent({ type: 'text', text: out });
        return;
      }

      // Ejecutar TODAS las tool-calls del mensaje en orden (varios code.write =
      // varios ficheros con contenido, no vacíos).
      this.history.push({ role: 'assistant', content: out, ts: Date.now() });
      const results = [];
      for (const call of calls) {
        if (signal.aborted) { onEvent({ type: 'aborted', text: '(Parado.)' }); return; }
        onEvent({ type: 'tool', call });
        let result;
        // La señal llega también a la herramienta: un comando largo en el bridge
        // (npm install, un servidor…) se para con el turno en vez de seguir solo.
        try { result = await runTool(call.tool, call.args, { signal }); }
        catch (e) {
          if (signal.aborted) { onEvent({ type: 'aborted', text: '(Parado.)' }); return; }
          result = 'ERROR: ' + e.message; onEvent({ type: 'tool_error', tool: call.tool, text: e.message });
        }
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        onEvent({ type: 'tool_result', tool: call.tool, result: resultStr });
        const pista = resultStr.startsWith('ERROR')
          ? '\n(Reanaliza este error y reintenta con la corrección; no te rindas.)' : '';
        results.push(`[resultado ${call.tool}]\n${resultStr}${pista}`);
      }
      this.history.push({ role: 'user', content: results.join('\n\n'), ts: Date.now() });
    }
    // Agotar los pasos es un FALLO y hay que decirlo con un evento propio: el
    // modo Objetivo marcaba la tarea como hecha porque solo miraba 'error', y
    // un plan entero podía acabar en verde sin haber tocado un solo fichero.
    onEvent({ type: 'exhausted', text: '(Me quedé sin pasos: demasiadas herramientas seguidas.)' });
    onEvent({ type: 'text', text: '(Me quedé sin pasos: demasiadas herramientas seguidas.)' });
  }
}

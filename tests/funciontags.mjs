// Guardia: las etiquetas <function> no pueden estropear lo que escribe el modelo.
// ─────────────────────────────────────────────────────────────────────────────
// `parseFunctionTags` hacía dos cosas con cada <param>: `.trim()` y, si el valor
// era JSON válido, `JSON.parse`. Las dos están mal, y llevaban en producción
// desde b7d7db0 con MiniCPM5 ofrecido en Code:
//
//   · el trim se come la SANGRÍA de la primera línea y el \n final, así que todo
//     fichero escrito por el modelo salía con la primera línea desalineada y sin
//     salto final;
//   · el JSON.parse convierte un fichero .json en un OBJETO —y `code.write` hace
//     `content.split('\n')`, o sea que revienta o escribe vacío— y a un texto
//     entrecomillado le quita las comillas.
//
// Y un tercero que no estaba en el informe y es peor, porque falla en SILENCIO:
// `code.edit` casa `search` contra el texto real del fichero. Recortarlo
// significa que la sangría no coincide y la edición no encuentra nada.
//
// La regla ahora viene del CONTRATO (`tools/index.js`), no de adivinar: hay
// parámetros de texto EXACTO (content, search, replace), parámetros numéricos
// (depth, offset, limit, around) y el resto son escalares donde el espacio de
// alrededor es ruido de formato del modelo.
//
// Sin navegador a propósito: `parseFunctionTags` es puro y `agent.js` importa en
// Node, así que esta guardia no pelea por la GPU con nadie.
import { parseFunctionTags, parseToolCalls } from '../web/js/agent.js';
import { TOOLS, PARAM_EXACTO, PARAM_NUMERO } from '../web/js/tools/index.js';

let fallos = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fallos++; };
const uno = (t) => parseFunctionTags(t)[0] || { tool: null, args: {} };
const ver = (s) => JSON.stringify(s);

// ── 1. El contenido de un fichero, tal cual. Sangría y salto final incluidos.
const CUERPO = '  const a = 1\nexport { a }\n';
let c = uno(`<function name="code.write"><param name="path">src/a.js</param><param name="content">${CUERPO}</param></function>`);
ok('1 · content conserva la sangría de la 1ª línea y el \\n final',
   c.args.content === CUERPO, ver(c.args.content));

// ── 2. Un fichero JSON es TEXTO, no un objeto.
const JSONF = '{\n  "nombre": "x"\n}\n';
c = uno(`<function name="code.write"><param name="path">p.json</param><param name="content">${JSONF}</param></function>`);
ok('2 · un fichero .json llega como TEXTO', typeof c.args.content === 'string' && c.args.content === JSONF,
   `${typeof c.args.content} ${ver(c.args.content)}`);

// ── 3. Un texto entrecomillado conserva sus comillas.
c = uno('<function name="code.write"><param name="path">a.txt</param><param name="content">"hola"</param></function>');
ok('3 · un valor entrecomillado NO pierde las comillas', c.args.content === '"hola"', ver(c.args.content));

// ── 4. search y replace, exactos: si no, la edición no casa y falla en silencio.
const BUSCA = '    if (x) {\n      return 1\n    }';
c = uno(`<function name="code.edit"><param name="path">a.js</param><param name="search">${BUSCA}</param><param name="replace">${BUSCA}</param></function>`);
ok('4 · search y replace conservan su sangría exacta',
   c.args.search === BUSCA && c.args.replace === BUSCA, ver(c.args.search));

// ── 5. Los numéricos llegan como NÚMEROS, no como "100".
c = uno('<function name="code.read"><param name="path">a.js</param><param name="offset">10</param><param name="limit">100</param><param name="around">42</param></function>');
ok('5 · offset, limit y around son números',
   c.args.offset === 10 && c.args.limit === 100 && c.args.around === 42,
   `${ver(c.args.offset)} ${ver(c.args.limit)} ${ver(c.args.around)}`);
c = uno('<function name="code.tree"><param name="depth">3</param></function>');
ok('5b · depth también', c.args.depth === 3, ver(c.args.depth));

// ── 6. Un escalar SÍ se recorta: el modelo pone el valor en su propia línea.
c = uno('<function name="code.read"><param name="path">\n  src/a.js\n</param></function>');
ok('6 · path se recorta (el modelo lo escribe en su propia línea)',
   c.args.path === 'src/a.js', ver(c.args.path));

// ── 7. CDATA: se desenvuelve, y permite que el contenido lleve </param>.
c = uno('<function name="code.write"><param name="path">a.js</param><param name="content"><![CDATA[  x\n]]></param></function>');
ok('7 · CDATA se desenvuelve sin tocar lo de dentro', c.args.content === '  x\n', ver(c.args.content));
c = uno('<function name="code.write"><param name="path">a.md</param><param name="content"><![CDATA[usa </param> aquí]]></param></function>');
ok('7b · con CDATA el contenido puede llevar </param>', c.args.content === 'usa </param> aquí', ver(c.args.content));

// ── 8. Un numérico con basura no se convierte en NaN callado.
c = uno('<function name="code.read"><param name="path">a.js</param><param name="limit">muchas</param></function>');
ok('8 · un numérico no numérico NO se vuelve NaN en silencio',
   !Number.isNaN(c.args.limit), ver(c.args.limit));

// ── 9. El contrato no puede derivar: cada excepción declarada tiene que existir.
const huerfanos = [];
for (const [mapa, nombre] of [[PARAM_EXACTO, 'PARAM_EXACTO'], [PARAM_NUMERO, 'PARAM_NUMERO']]) {
  for (const [herr, params] of Object.entries(mapa)) {
    if (!TOOLS[herr]) { huerfanos.push(`${nombre}: la herramienta ${herr} no existe`); continue; }
    for (const p of params) if (!(p in TOOLS[herr].params)) huerfanos.push(`${nombre}: ${herr}.${p} no es un parámetro`);
  }
}
ok('9 · cada excepción del contrato apunta a un parámetro real', huerfanos.length === 0, huerfanos.join(' · '));

// ── 10. Y varias llamadas seguidas siguen saliendo en orden.
const dos = parseFunctionTags(
  '<function name="code.write"><param name="path">a</param><param name="content">1</param></function>' +
  'bla<function name="code.write"><param name="path">b</param><param name="content">2</param></function>');
ok('10 · varias <function> seguidas, en orden', dos.length === 2 && dos[0].args.path === 'a' && dos[1].args.path === 'b',
   `${dos.length} llamadas`);


// ─────────────────────────────────────────────────────────────────────────────
// Lo que encontró el fuzz de T2T el 2026-10-12. Todo acababa en daño silencioso.
const call = (t) => (parseToolCalls(t) || []);

// ── 11. Una llamada CITADA dentro de un valor NO se ejecuta.
// Era el peor: un README que documenta un `code.edit` hacía que ese edit se
// aplicara, y el patch salía con la condición invertida pasando los tests.
const DOC = '<function name="code.write"><param name="path">README.md</param><param name="content">Ejemplo:\n'
  + '{"tool":"code.edit","args":{"path":"src/max.js","search":"a > b","replace":"a < b"}}\n</param></function>';
let cs = call(DOC);
ok('11 · una llamada citada dentro de un <param> NO se ejecuta',
   cs.length === 1 && cs[0].tool === 'code.write', `${cs.length} llamadas: ${cs.map(c => c.tool).join(', ')}`);
ok('11b · …y el texto citado sigue dentro del fichero',
   /"tool":"code\.edit"/.test(cs[0]?.args?.content || ''), ver((cs[0]?.args?.content || '').slice(0, 40)));

// ── 12. `</function>` dentro de CDATA no cierra la llamada.
// Sin esto el cuerpo llegaba cortado, el <param> del contenido no casaba y
// `code.write` escribía un fichero VACÍO, porque content vale '' por defecto.
const CD = '<function name="code.write"><param name="path">q.mjs</param><param name="content">'
  + '<![CDATA[const c = \'<function name="x"></function>\'\n]]></param></function>';
c = uno(CD);
ok('12 · un </function> dentro de CDATA no corta la llamada',
   c.args.content === 'const c = \'<function name="x"></function>\'\n', ver(c.args.content));

// ── 13. El orden es el del TEXTO cuando se mezclan las dos formas.
const MIX = '<function name="code.write"><param name="path">a</param><param name="content">1</param></function>\n'
  + '{"tool":"code.write","args":{"path":"b","content":"2"}}\n'
  + '<function name="code.write"><param name="path">c</param><param name="content">3</param></function>';
ok('13 · mezclando <function> y JSON, se ejecuta en el orden del texto',
   call(MIX).map(x => x.args.path).join(',') === 'a,b,c', call(MIX).map(x => x.args.path).join(','));

// ── 14. Un nombre de herramienta que pisa Object.prototype no tumba el turno.
// `PARAM_EXACTO['constructor']` es una función, así que `(mapa[x]||[]).includes`
// lanzaba — y `parseToolCalls` corre FUERA del try/catch de handle().
for (const n of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
  let bien = true, det = '';
  try { parseFunctionTags(`<function name="${n}"><param name="x">1</param></function>`); }
  catch (e) { bien = false; det = e.message; }
  ok(`14 · «${n}» como nombre de herramienta no lanza`, bien, det);
}

// ── 15. Un escalar entrecomillado no se lleva las comillas puestas.
c = uno('<function name="code.read"><param name="path">"src/a.js"</param><param name="around">"12"</param></function>');
ok('15 · un path entrecomillado no crea una carpeta «"src»', c.args.path === 'src/a.js', ver(c.args.path));
ok('15b · un numérico entrecomillado sigue siendo número (y no NaN-NaN)', c.args.around === 12, ver(c.args.around));

// ── 16. El valor exacto abierto en su propia línea no mete una línea en blanco.
c = uno('<function name="code.write"><param name="path">a.js</param><param name="content">\nconst a = 1\n</param></function>');
ok('16 · un content abierto en su línea no empieza el fichero en blanco',
   c.args.content === 'const a = 1\n', ver(c.args.content));
// …y quien SÍ quiera esa línea en blanco tiene el CDATA, que es exacto.
c = uno('<function name="code.write"><param name="path">a.js</param><param name="content"><![CDATA[\nx\n]]></param></function>');
ok('16b · con CDATA el salto inicial se respeta', c.args.content === '\nx\n', ver(c.args.content));

// ── 17. JSON envuelto en los delimitadores nativos sigue ejecutándose.
// `parseNativeCall` espera `tool(arg=valor)` y rechaza esto con razón; lo rescata
// la pasada de JSON. Al reclamar tramos me lo cargué, así que queda fijado.
cs = call('<|tool_call_start|>{"tool":"code.read","args":{"path":"a.js"}}<|tool_call_end|>');
ok('17 · JSON envuelto en delimitadores nativos se rescata',
   cs.length === 1 && cs[0].tool === 'code.read' && cs[0].args.path === 'a.js',
   `${cs.length} llamadas: ${cs.map(x => x.tool).join(', ')}`);

console.log(fallos ? `\n❌ ${fallos} FALLO(S)` : '\n✅ las etiquetas <function> no estropean lo que escribe el modelo');
process.exit(fallos ? 1 : 0);

// Regresión del bug real encontrado con Gemma-4 E2B: al anidar "args":{…}
// dentro del objeto del tool-call, el modelo a veces se deja SIN escribir la
// llave de cierre del objeto EXTERIOR (cierra args, no el tool) — antes esto
// tiraba el tool-call entero sin ejecutar nada y sin avisar. parseToolCalls
// debe recuperarlo añadiendo la llave que falta, solo si el JSON resultante
// es válido de verdad.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const p = await b.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

const run = text => p.evaluate(async t => {
  const a = await import('/js/agent.js');
  return a.parseToolCalls(t);
}, text);

// 1) el caso REAL capturado (index.html, del log de appbuild_gif.mjs) —
// falta la llave de cierre del objeto exterior tras cerrar "args".
const missingOne = '```tool\n{"tool": "code.write", "args": {"path": "index.html", "content": "<!DOCTYPE html>\\n<html>\\n<body><h1>Hola</h1></body>\\n</html>"}\n```';
const r1 = await run(missingOne);
ok('recupera el tool-call con UNA llave de cierre que falta', r1.length === 1 && r1[0].tool === 'code.write', JSON.stringify(r1));
ok('el path llega intacto', r1[0]?.args?.path === 'index.html');
ok('el content llega COMPLETO (con las < > reales, no roto)', r1[0]?.args?.content === '<!DOCTYPE html>\n<html>\n<body><h1>Hola</h1></body>\n</html>');

// 2) JSON bien formado (caso normal) sigue funcionando exactamente igual
const wellFormed = '```tool\n{"tool": "code.write", "args": {"path": "a.txt", "content": "hola"}}\n```';
const r2 = await run(wellFormed);
ok('un tool-call bien formado se sigue parseando normal', r2.length === 1 && r2[0].args.content === 'hola');

// 3) truncado REAL (a media cadena, sin cerrar comillas) NO se debe "arreglar"
// a ciegas — inventar contenido sería peor que fallar limpio.
const trulyTruncated = '```tool\n{"tool": "code.write", "args": {"path": "b.txt", "content": "esto se corta a media';
const r3 = await run(trulyTruncated);
ok('un truncado real a media cadena NO se recupera (sería inventar datos)', r3.length === 0, JSON.stringify(r3));

// 4) dos llaves de cierre de más faltando (anidado más profundo) también se recupera
const missingTwo = '```tool\n{"tool": "code.write", "args": {"path": "c.txt", "content": "x", "meta": {"a": 1}\n```';
const r4 = await run(missingTwo);
ok('recupera aunque falten VARIAS llaves de cierre (hasta el tope permitido)', r4.length === 1 && r4[0].tool === 'code.write', JSON.stringify(r4));

// 5) varios tool-calls en un mismo mensaje, uno de ellos con la llave que falta
const multi = 'Primero:\n```tool\n{"tool": "code.write", "args": {"path": "ok.txt", "content": "bien"}}\n```\nLuego:\n```tool\n{"tool": "code.write", "args": {"path": "roto.txt", "content": "mal"}\n```';
const r5 = await run(multi);
ok('en un mensaje con varios tool-calls, el roto también se recupera', r5.length === 2, JSON.stringify(r5));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ RECUPERACIÓN DE TOOL-CALLS CON LLAVE DE CIERRE PERDIDA OK');
await b.close();
process.exit(fails ? 1 : 0);

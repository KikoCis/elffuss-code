// Guardia: el prompt tiene que empujar a TRANSFORMAR el fichero aquí mismo, no a
// proponer una librería de terceros y quedarse esperando.
// ─────────────────────────────────────────────────────────────────────────────
// Bug real, reportado por el usuario con la transcripción delante. Le pidió
// escalar un STL al doble y el modelo contestó: «mis herramientas son solo
// código, texto y comandos de shell», que para eso haría falta Blender o
// numpy-stl, y acabó preguntando «¿quieres que te cree un script de Python? Antes
// dime si tienes numpy-stl instalado». Tres fallos en una respuesta: concluir que
// no puede, poner una dependencia como requisito, y pedir permiso en vez de
// hacerlo. Escalar un STL es multiplicar números.
//
// Debajo había un bug del prompt, y es EL MISMO que ya dio prompt_prefers_edit:
// la lista de «USA SOLO …» omitía code.run, así que la regla dura le decía que
// esa herramienta no existe mientras toolHelp se la ofrecía dos líneas arriba.
// Si el modelo no sabe que puede ejecutar JS, es natural que se vaya a Python.
//
// Determinista, sin modelo: se lee el prompt y se comprueba qué dice.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8790';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const b = await chromium.launch(); const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
const sp = await p.evaluate(async () => { const a = await import('/js/agent.js'); return a.systemPrompt(''); });

// 1. El bug de la lista: code.run tiene que estar entre las permitidas.
ok('code.run está en la lista de herramientas permitidas', /USA SOLO[^\n]*code\.run/.test(sp));
ok('…y toolHelp sigue describiéndolo', /code\.run/.test(sp.split('REGLAS DURAS')[0]));

// 2. La regla de transformar: existe, y dice los dos caminos.
ok('hay una regla sobre TRANSFORMAR o CALCULAR sobre un fichero', /TRANSFORMAR o CALCULAR sobre un fichero/.test(sp));
ok('dice que un fichero son BYTES y estas herramientas los leen y escriben', /un fichero son BYTES/.test(sp));
ok('camino de texto: code.read → transformar → code.write', /code\.read, lo transformas t[úu] y code\.write/.test(sp));
ok('camino de binario o grande: script + terminal.run node', /terminal\.run «node script\.mjs»/.test(sp));

// 3. Lo que NO puede hacer, que es lo que hizo.
ok('prohíbe contestar «mis herramientas son solo código, texto y shell»',
   /PROHIBIDO contestar «mis herramientas son solo c[óo]digo, texto y comandos de shell»/.test(sp));
ok('prohíbe poner una librería de terceros como REQUISITO', /librer[íi]a de terceros como REQUISITO/.test(sp));
ok('nombra el caso exacto que falló (numpy-stl)', /numpy-stl/.test(sp));
// La regla vieja «PRUÉBALO con terminal.run» es la que hizo que el modelo se
// fuera a pip: ahora NO debe estar, y el prompt tiene que prohibir instalar.
ok('NO manda probar con terminal.run (esa regla causó el pip)', !/PRU[ÉE]BALO con terminal\.run/.test(sp));
ok('prohíbe instalar nada, ni «para ver si está»', /NUNCA instales nada/.test(sp) && /ni siquiera «para ver si est/.test(sp));
ok('prohíbe ofrecerse y esperar', /Ofrecerse y quedarse esperando/.test(sp));
ok('da la salida concreta: escalar un STL es multiplicar números', /escalar un STL es multiplicar n[úu]meros/.test(sp));

// 4. Y que no le mienta sobre code.run: no toca ficheros.
ok('aclara que code.run NO toca ficheros', /code\.run NO toca ficheros/.test(sp));
ok('…y para qué sirve: comprobar lo que DEVUELVE una expresión', /qu[ée] DEVUELVE una expresi[óo]n/.test(sp));

// 5. Control positivo: si el prompt no se hubiera cargado, todo lo de arriba
//    daría falso por la razón equivocada. Que tenga lo que ya tenía.
ok('⊕ control positivo: el prompt está cargado de verdad', /REGLAS DURAS/.test(sp) && sp.length > 2000,
   `${sp.length} caracteres`);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ el prompt transforma el fichero en vez de proponer una librería');
await b.close(); process.exit(fails ? 1 : 0);

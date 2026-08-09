// Guardia: el parser de tool-calls recupera el JSON malformado que emiten los
// modelos pequeños al escribir código/HTML — saltos de línea literales en el
// content, comillas dobles sin escapar (class="x"), coma final. Sin esto, un
// code.write de una web se PIERDE entero. (Un truncado real a media cadena SÍ
// debe rechazarse: lo cubre toolparse_missingbrace.mjs.)
import { chromium } from 'playwright/index.mjs';
const BASE='http://localhost:8790';
let fails=0; const ok=(n,c,e='')=>{console.log((c?'✅':'❌')+' '+n+(e?'  — '+e:''));if(!c)fails++;};
const b=await chromium.launch();const ctx=await b.newContext();
await ctx.addInitScript(()=>{try{localStorage.setItem('elffusscode.model','rules');}catch{}});
const p=await ctx.newPage();
await p.goto(BASE+'/?test-opfs',{waitUntil:'domcontentloaded'});await p.waitForTimeout(1200);
const run = (name, text) => p.evaluate(async t => {
  const a = await import('/js/agent.js');
  const calls = a.parseToolCalls(t);
  const c = calls[0];
  return { n: calls.length, tool: c?.tool, path: c?.args?.path, contentHead: (c?.args?.content||'').slice(0,30), contentHasNL: /\n/.test(c?.args?.content||'') };
}, text);

// 1) content bien escapado (el caso "bueno")
let r = await run('ok', '```tool\n{"tool":"code.write","args":{"path":"a.html","content":"<h1>Hi</h1>\\n<p>x</p>"}}\n```');
ok('1 · content escapado correctamente → parsea', r.tool==='code.write' && r.path==='a.html');

// 2) content con SALTOS DE LÍNEA LITERALES (lo que hace un modelo pequeño con HTML)
const litNL = '```tool\n{"tool":"code.write","args":{"path":"index.html","content":"<!doctype html>\n<html>\n<body>\n<h1>Tienda</h1>\n</body>\n</html>"}}\n```';
r = await run('litNL', litNL);
ok('2 · content con saltos de línea LITERALES (HTML real) → recupera', r.tool==='code.write' && /doctype/.test(r.contentHead||''), `n=${r.n} tool=${r.tool}`);

// 3) comillas dobles SIN escapar dentro del HTML (class="...")
const litQ = '```tool\n{"tool":"code.write","args":{"path":"i.html","content":"<div class="hero">Hola</div>"}}\n```';
r = await run('litQ', litQ);
ok('3 · comillas dobles sin escapar en el HTML → recupera', r.tool==='code.write' && /hero|div/.test(r.contentHead||''), `tool=${r.tool} head=${JSON.stringify(r.contentHead)}`);

// 4) coma final (trailing comma)
r = await run('trail', '```tool\n{"tool":"code.read","args":{"path":"x.js",}}\n```');
ok('4 · trailing comma → recupera', r.tool==='code.read' && r.path==='x.js', `tool=${r.tool}`);

console.log(fails?`\n❌ ${fails} de 4 FALLAN`:'\n✅ parser robusto');
await b.close();process.exit(fails?1:0);

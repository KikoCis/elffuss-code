import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const b = await chromium.launch(); const p = await (await b.newContext()).newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
const parse = (t) => p.evaluate(async (t) => { const a = await import('/js/agent.js'); return a.parseToolCalls(t); }, t);

// 1) un solo bloque con fence
let r = await parse('Leo el readme:\n```tool\n{"tool":"code.read","args":{"path":"README.md"}}\n```');
ok('1 fence → 1 call', r.length === 1 && r[0].tool === 'code.read' && r[0].args.path === 'README.md', JSON.stringify(r));

// 2) el caso real: prosa + 3 code.write (fenced), con llaves en el CSS
const three = `He creado la estructura.
Ahora index.html:
\`\`\`tool
{"tool":"code.write","args":{"path":"vllm-explainer/index.html","content":"<!DOCTYPE html>\\n<html lang=\\"en\\"><body>hola</body></html>"}}
\`\`\`
El CSS:
\`\`\`tool
{"tool":"code.write","args":{"path":"vllm-explainer/style.css","content":"body { margin: 0; }\\nsection { padding: 10px; }"}}
\`\`\`
Y el script:
\`\`\`tool
{"tool":"code.write","args":{"path":"vllm-explainer/script.js","content":"console.log('ok');"}}
\`\`\`
Listo!`;
r = await parse(three);
ok('prosa + 3 code.write fenced → 3 calls', r.length === 3 && r.every(c => c.tool === 'code.write'), `${r.length} calls`);
ok('  · contenido NO vacío y con llaves del CSS intactas', r[1].args.content.includes('margin: 0') && r[1].args.content.includes('padding: 10px'), r[1] && r[1].args.content);
ok('  · rutas correctas', r[0].args.path.endsWith('index.html') && r[2].args.path.endsWith('script.js'));

// 3) SIN fences, inline en prosa (lo que rompía antes)
r = await parse('Creo el fichero. {"tool":"code.write","args":{"path":"a.txt","content":"hola { mundo }"}} Ya está.');
ok('inline sin fence → 1 call con contenido', r.length === 1 && r[0].args.content === 'hola { mundo }', JSON.stringify(r));

// 4) sin tool-calls → vacío
r = await parse('Esto es solo texto explicativo, sin herramientas.');
ok('texto plano → 0 calls', r.length === 0);

// 5) duplicados exactos se colapsan
r = await parse('```tool\n{"tool":"code.tree","args":{}}\n```\n```tool\n{"tool":"code.tree","args":{}}\n```');
ok('duplicados exactos → 1 call', r.length === 1);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ PARSEO DE TOOL-CALLS OK');
await b.close(); process.exit(fails ? 1 : 0);

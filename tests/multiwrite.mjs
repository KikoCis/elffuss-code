// End-to-end del bug «ficheros vacíos»: un mensaje del modelo con VARIAS
// code.write debe escribir TODOS los ficheros con su contenido. Inyectamos un
// proveedor falso (sin modelo real) y comprobamos el contenido en OPFS.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2000);

const events = await p.evaluate(async () => {
  const { Agent } = await import('/js/agent.js');
  const msg = `He creado la estructura. Ahora los ficheros:
\`\`\`tool
{"tool":"code.write","args":{"path":"proj/index.html","content":"<!DOCTYPE html>\\n<html lang=\\"en\\"><body><h1>vLLM</h1></body></html>"}}
\`\`\`
El CSS:
\`\`\`tool
{"tool":"code.write","args":{"path":"proj/style.css","content":"body { margin: 0; font-family: system-ui; }"}}
\`\`\`
Y el script:
\`\`\`tool
{"tool":"code.write","args":{"path":"proj/script.js","content":"console.log('vLLM explainer');"}}
\`\`\`
Listo!`;
  let n = 0;
  const fake = { chat: async () => (n++ === 0 ? msg : 'Proyecto creado ✔') };
  const a = new Agent(fake);
  const ev = [];
  await a.handle('crea un mini proyecto web que explique vllm', e => ev.push(e.type + (e.tool ? ':' + e.tool : '')));
  return ev;
});
const writes = events.filter(e => e === 'tool_result:code.write').length;
ok('se ejecutan las 3 code.write del mismo mensaje', writes === 3, `${writes} writes · eventos: ${events.join(',')}`);

const files = await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const read = async (path) => { let d = o; const parts = path.split('/'); const name = parts.pop(); for (const x of parts) d = await d.getDirectoryHandle(x); return (await (await d.getFileHandle(name)).getFile()).text(); };
  return { idx: await read('proj/index.html').catch(() => ''), css: await read('proj/style.css').catch(() => ''), js: await read('proj/script.js').catch(() => '') };
});
ok('index.html NO está vacío', files.idx.includes('<h1>vLLM</h1>'), JSON.stringify(files.idx.slice(0, 40)));
ok('style.css NO está vacío (llaves intactas)', files.css.includes('margin: 0'), JSON.stringify(files.css.slice(0, 40)));
ok('script.js NO está vacío', files.js.includes('vLLM explainer'), JSON.stringify(files.js.slice(0, 40)));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ MULTI-WRITE OK — los ficheros se crean con contenido');
await b.close();
process.exit(fails ? 1 : 0);

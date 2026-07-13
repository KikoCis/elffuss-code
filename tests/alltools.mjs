// Test INTEGRAL: valida TODAS las herramientas de la elfa de Code, cada una vía
// runTool (deterministicо, sin depender del modelo), + el flujo del agente que
// ejecuta varias tool-calls de un mensaje. web.search/web.fetch usan internet
// real (proxy del servidor) → correr con BASE=https://elffuss-code.utopiaia.com.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'https://elffuss-code.utopiaia.com';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + String(e).replace(/\n/g, ' ').slice(0, 90) : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
p.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) console.log('   pageerror:', e.message.slice(0, 120)); });

// sembrar proyecto en OPFS
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (d, n, t) => { const f = await d.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  const src = await o.getDirectoryHandle('src', { create: true });
  await w(o, 'README.md', '# proyecto demo\nUsa fastText y un cache LRU.');
  await w(o, 'package.json', '{ "name": "demo", "version": "2.1.0" }');
  await w(src, 'app.js', "import { lru } from './cache.js';\nexport const KEYWORD_TODO = 1;");
  await w(src, 'cache.js', "export const lru = () => new Map();");
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);

const run = (tool, args) => p.evaluate(async ({ tool, args }) => {
  try { const t = await import('/js/tools/index.js'); return { ok: true, out: await t.runTool(tool, args) }; }
  catch (e) { return { ok: false, out: String(e.message || e) }; }
}, { tool, args });

// 1) code.tree
let r = await run('code.tree', {});
ok('code.tree · lista el árbol real', r.ok && /README\.md/.test(r.out) && /src/.test(r.out), r.out);
// 2) code.read
r = await run('code.read', { path: 'package.json' });
ok('code.read · lee contenido real', r.ok && r.out.includes('"version": "2.1.0"'), r.out);
// 3) code.write
r = await run('code.write', { path: 'src/nuevo.js', content: 'export const X = 42;' });
const back = await run('code.read', { path: 'src/nuevo.js' });
ok('code.write · escribe y persiste', r.ok && back.out.includes('export const X = 42'), r.out);
// 4) code.search
r = await run('code.search', { query: 'KEYWORD_TODO' });
ok('code.search · grep en el proyecto', r.ok && /app\.js/.test(r.out), r.out);
// 5) terminal.run — varios comandos
r = await run('terminal.run', { command: 'ls src' });
ok('terminal.run · ls', r.ok && /cache\.js/.test(r.out), r.out);
r = await run('terminal.run', { command: 'echo hola-tool > n.txt && cat n.txt' });
ok('terminal.run · echo> + cat (escribe en disco)', r.ok && r.out.includes('hola-tool'), r.out);
r = await run('terminal.run', { command: 'cat src/app.js | grep lru' });
ok('terminal.run · tubería cat|grep', r.ok && /lru/.test(r.out), r.out);
// 6) web.search — internet real
r = await run('web.search', { query: 'mdn array map' });
ok('web.search · búsqueda en internet real', r.ok && /https?:\/\//.test(r.out) && /Resultados/.test(r.out), r.out);
// 7) web.fetch — leer una URL
r = await run('web.fetch', { url: 'https://example.com' });
ok('web.fetch · lee el texto de una URL', r.ok && /example|domain/i.test(r.out), r.out);

// 8) flujo del agente: un mensaje con varias tool-calls se ejecuta entero
const ev = await p.evaluate(async () => {
  const { Agent } = await import('/js/agent.js');
  const msg = 'Creo dos ficheros:\n```tool\n{"tool":"code.write","args":{"path":"docs/a.md","content":"# A"}}\n```\n```tool\n{"tool":"code.write","args":{"path":"docs/b.md","content":"# B"}}\n```';
  let n = 0; const a = new Agent({ chat: async () => (n++ ? 'listo' : msg) });
  const e = []; await a.handle('crea dos docs', x => e.push(x.type));
  return e.filter(t => t === 'tool_result').length;
});
ok('agente · ejecuta las 2 tool-calls del mismo mensaje', ev === 2, `${ev} ejecutadas`);

console.log(fails ? `\n❌ ${fails} FALLO(S) de ${8}` : '\n✅ TODAS LAS TOOLS OK — code.* + terminal + web + flujo del agente');
await b.close();
process.exit(fails ? 1 : 0);

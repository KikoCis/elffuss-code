// PROBE (desechable) — ronda 4b: bordes de read() y finales de línea CRLF en edit()
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8790';

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const put = async (n, s) => { const w = await (await o.getFileHandle(n, { create: true })).createWritable(); await w.write(s); await w.close(); };
  await put('small.js', 'a\nb\nc\nd\ne\n');
  // fichero con finales de línea de Windows (CRLF) — común en repos mixtos
  await put('crlf.js', 'const A = 1;\r\n  function calc(x){\r\n    return x + 1;\r\n  }\r\nconst B = 2;\r\n');
  // fichero de 250KB con el término (entre 200KB y 2MB)
  { let s = ''; for (let i = 0; i < 5000; i++) s += `const p${i} = ${i}; // relleno relleno relleno\n`; s += 'const MID_NEEDLE = 1;\n'; await put('mid.js', s); }
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);

const r = await p.evaluate(async () => {
  const code = await import('/js/tools/code.js');
  const out = {};

  // 1) read con offset MÁS ALLÁ del final
  out.readPastEnd = await code.read({ path: 'small.js', offset: 999, limit: 10 });
  // 2) read con offset negativo / cero
  out.readZero = (await code.read({ path: 'small.js', offset: 0, limit: 2 })).split('\n')[0];
  out.readNeg = (await code.read({ path: 'small.js', offset: -5, limit: 2 })).split('\n')[0];

  // 3) CRLF: editar un bloque y ver si se conservan los finales de línea
  let crlfErr = null;
  try {
    await code.edit({ path: 'crlf.js', search: 'function calc(x){\nreturn x + 1;\n}', replace: 'function calc(x){\n    return x + 2;\n  }' });
  } catch (e) { crlfErr = e.message; }
  const o = await navigator.storage.getDirectory();
  const t = await (await (await o.getFileHandle('crlf.js')).getFile()).text();
  out.crlfErr = crlfErr;
  out.crlfApplied = t.includes('x + 2');
  out.crlfCRs = (t.match(/\r/g) || []).length;   // eran 5; si baja, hemos mezclado finales
  out.crlfRaw = JSON.stringify(t);

  // 4) fichero de 250KB: ¿lo ve search?
  out.searchMid = await code.search({ query: 'MID_NEEDLE' });

  return out;
});

console.log(JSON.stringify(r, null, 2));
await b.close();

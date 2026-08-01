import { chromium } from 'playwright';
const BASE = process.env.BASE || 'https://elffuss-code.utopiaia.com';
const MODEL = process.env.M || 'litert:gemma-e2b';
const b = await chromium.launch({ args: ['--enable-unsafe-webgpu','--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(m => { try { localStorage.setItem('elffusscode.model', m) } catch {} }, MODEL);
const p = await ctx.newPage();
const seen = [];
p.on('response', async r => {
  const u = r.url();
  if (/litertlm|\.onnx|resolve\/main|cdn-lfs|huggingface/i.test(u)) {
    let sw = 'n/a'; try { sw = r.fromServiceWorker(); } catch {}
    const rng = r.request().headers()['range'] || '-';
    seen.push({ u: u.slice(0, 90), status: r.status(), sw, rng });
    console.log(`[resp] sw=${sw} status=${r.status()} range=${rng}  ${u.slice(0,110)}`);
  }
});
console.log('modelo:', MODEL, '· esperando peticiones de modelo (25s máx)…');
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
// esperar hasta ver la primera petición de modelo o 25s
const t0 = Date.now();
while (Date.now() - t0 < 25000 && !seen.length) await p.waitForTimeout(500);
await p.waitForTimeout(4000); // capturar unas cuantas más
// ¿controla el SW?
const controlled = await p.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
const cacheKeys = await p.evaluate(async () => { try { const c = await caches.open('elffuss-models-v1'); const k = await c.keys(); return k.map(r=>r.url.slice(0,80)); } catch { return ['<err>']; } });
console.log('\nSW controla la página:', controlled);
console.log('claves en cache elffuss-models-v1:', cacheKeys.length, cacheKeys.slice(0,5));
console.log('peticiones de modelo vistas:', seen.length);
await b.close();

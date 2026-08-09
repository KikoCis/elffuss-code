// Guardia: si NO se puede cachear el modelo, hay que DECIRLO.
// Bug real (ago-2026): cachedModelBlob prometía en el progreso «se cachea para
// la próxima vez», y si cache.put fallaba (ventana privada, disco lleno, cuota)
// se tragaba la excepción y devolvía la URL. El usuario se re-bajaba GIGABYTES
// cada sesión sin enterarse de por qué. Es la misma enfermedad que el resto de
// la ronda: fallo silencioso presentado como éxito.
// Determinista: se fuerza el fallo de cache.put, no hace falta ni GPU ni GB.
import { chromium } from 'playwright';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const BASE = process.env.BASE || 'http://localhost:8790';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const FIXP = join(WEB, '__honest_fixture.litertlm');
writeFileSync(FIXP, Buffer.alloc(50000, 7));
process.on('exit', () => { try { rmSync(FIXP); } catch {} });
const FIX = BASE + '/__honest_fixture.litertlm';

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });

// 1) camino normal: cachea y devuelve Blob, sin avisos de fallo
{
  const r = await p.evaluate(async (u) => {
    const m = await import('/js/providers/litert.js');
    const msgs = [];
    const res = await m.cachedModelBlob(u, s => msgs.push(s));
    return { isBlob: res instanceof Blob, size: res instanceof Blob ? res.size : 0, warned: msgs.some(s => /No se pudo guardar/.test(s)) };
  }, FIX);
  ok('normal: devuelve Blob cacheado', r.isBlob && r.size === 50000, `size=${r.size}`);
  ok('normal: no avisa de fallo cuando SÍ cachea', !r.warned);
}

// 2) cache.put FALLA (cuota/ventana privada/disco): debe avisar y seguir usable
{
  const r = await p.evaluate(async (u) => {
    const m = await import('/js/providers/litert.js');
    const real = caches.open.bind(caches);
    caches.open = async (n) => {
      const c = await real(n);
      await c.delete(u);                       // que no lo sirva de caché previa
      return new Proxy(c, {
        get: (t, k) => k === 'put'
          ? async () => { const e = new Error('Quota exceeded'); e.name = 'QuotaExceededError'; throw e; }
          : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]),
      });
    };
    const msgs = [];
    let res, err = null;
    try { res = await m.cachedModelBlob(u, s => msgs.push(s)); } catch (e) { err = e.message; }
    caches.open = real;
    return {
      err, devuelveURL: typeof res === 'string',
      aviso: msgs.find(s => /No se pudo guardar/.test(s)) || '',
      explica: msgs.some(s => /privada|espacio/i.test(s)),
    };
  }, FIX);
  ok('fallo al cachear: NO revienta la carga (devuelve la URL)', !r.err && r.devuelveURL, r.err || '');
  ok('fallo al cachear: lo DICE en el progreso (no silencioso)', !!r.aviso, r.aviso.slice(0, 110));
  ok('fallo al cachear: explica la causa probable', r.explica);
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ caché de modelo HONESTA — si no cachea, lo dice');
await b.close();
process.exit(fails ? 1 : 0);

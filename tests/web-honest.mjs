// web.fetch y web.search dicen POR QUÉ no pueden, en vez de callarlo.
//
// En producción el servidor no tiene ruta /proxy (nginx contesta 404): los
// sitios sin CORS no se pueden leer y DuckDuckGo tampoco. Antes web.fetch daba
// «HTTP 404» a secas (se lee como «esa página no existe») y web.search tragaba
// los dos fallos y contestaba «Sin resultados», como si no hubiera nada. Ahora:
//   1. sin proxy (404): las dos lo dicen, con la causa;
//   2. el proxy falla (502): se dice que falló el proxy;
//   3. DuckDuckGo pide su verificación anti-bot: es un bloqueo, no una lista vacía;
//   4. con resultados, los da (y «Sin resultados» solo cuando el buscador
//      contestó y no encontró nada);
//   5. un sitio con CORS se lee directo, sin pasar por el proxy;
//   6-8. y sin decir más de lo que se sabe: el 404 del propio sitio es que la
//      página no existe; un fetch fallido sin respuesta no distingue «sin CORS»
//      de «no se pudo conectar», y no se afirma que la página exista.
// Todo con page.route: ninguna petición sale a internet.
//
//   BASE=http://localhost:8799 node tests/web-honest.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + String(e).replace(/\n/g, ' ').slice(0, 150) : '')); if (!c) fails++; };

const RESULTADOS = `<html><body><table>
<tr><td><a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdeveloper.mozilla.org%2Fes%2Fdocs%2FArray%2Fmap&rut=x">Array.prototype.map() - JavaScript | MDN</a></td></tr>
<tr><td>El método map() crea un nuevo array con los resultados.</td></tr>
</table></body></html>`;
const VACIO = '<html><body><table><tr><td>No results.</td></tr></table></body></html>';
const ANTIBOT = '<html><body><div class="anomaly-modal__title">Unfortunately, bots use DuckDuckGo too.</div></body></html>';

const b = await chromium.launch();
async function escenario(proxy, { directoCORS = false, sitio = null } = {}) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const alProxy = [];
  // Los sitios de fuera: sin CORS (el fetch directo falla), salvo que se diga.
  // `sitio` contesta en su lugar (un 404 propio, un dominio que no resuelve…).
  await p.route(/^https:\/\/(example\.com|html\.duckduckgo\.com|lite\.duckduckgo\.com|cors-site\.example|no-such-host\.invalid)\//, r => sitio
    ? sitio(r)
    : directoCORS
      ? r.fulfill({ status: 200, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: '<html><body><p>Example Domain directo</p></body></html>' })
      : r.abort('failed'));
  await p.route('**/proxy?url=*', r => { alProxy.push(decodeURIComponent(r.request().url().split('url=')[1] || '')); return proxy(r); });
  await p.goto(BASE + '/manifest.json');
  const llama = (que, args) => p.evaluate(async ({ que, args }) => {
    const web = await import('/js/tools/web.js');
    try { return { ok: true, out: await (que === 'search' ? web.search(args) : web.fetchUrl(args)) }; }
    catch (e) { return { ok: false, out: String(e.message || e) }; }
  }, { que, args });
  return { ctx, alProxy, llama };
}

// 1 · sin proxy en el servidor (lo de producción hoy)
{
  const { ctx, llama } = await escenario(r => r.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404 Not Found</h1>' }));
  const f = await llama('fetch', { url: 'https://example.com' });
  ok('1 · web.fetch sin proxy: falla diciendo que el servidor no tiene el proxy', !f.ok && /no tiene el proxy de respaldo/.test(f.out) && /404/.test(f.out), f.out);
  // Desde el navegador un fetch fallido no distingue «sin CORS» de «no existe»:
  // se dicen las dos posibilidades y no se afirma que la página exista.
  ok('  …sin afirmar que la página exista: CORS o sin conexión, no se distingue',
    /CORS/.test(f.out) && /no se pudiera conectar/.test(f.out) && /no dice nada de si la página existe/.test(f.out) && !/No es que la página no exista/.test(f.out), f.out);
  const s = await llama('search', { query: 'mdn array map' });
  ok('1 · web.search sin proxy: falla con la causa, NO «Sin resultados»', !s.ok && /no tiene el proxy de respaldo/.test(s.out) && !/Sin resultados/.test(s.out), s.out);
  await ctx.close();
}
// 2 · el proxy existe pero falla
{
  const { ctx, llama } = await escenario(r => r.fulfill({ status: 502, contentType: 'text/plain', body: 'proxy: timed out' }));
  const f = await llama('fetch', { url: 'https://example.com' });
  ok('2 · el proxy falla: se dice que falló el proxy (HTTP 502)', !f.ok && /proxy del servidor \(HTTP 502\)/.test(f.out), f.out);
  await ctx.close();
}
// 3 · DuckDuckGo pide la verificación anti-bot
{
  const { ctx, llama } = await escenario(r => r.fulfill({ status: 202, contentType: 'text/html', body: ANTIBOT }));
  const s = await llama('search', { query: 'mdn array map' });
  ok('3 · la verificación anti-bot es un bloqueo, no «Sin resultados»', !s.ok && /bloqueó la consulta/.test(s.out) && !/Sin resultados/.test(s.out), s.out);
  await ctx.close();
}
// 4 · con resultados, y vacío de verdad
{
  const { ctx, llama } = await escenario(r => r.fulfill({ status: 200, contentType: 'text/html', body: RESULTADOS }));
  const s = await llama('search', { query: 'mdn array map' });
  ok('4 · con resultados: los da, con su URL', s.ok && /Resultados para «mdn array map»/.test(s.out) && /developer\.mozilla\.org/.test(s.out), s.out);
  await ctx.close();
  const v = await escenario(r => r.fulfill({ status: 200, contentType: 'text/html', body: VACIO }));
  const sv = await v.llama('search', { query: 'xyzzy-nada' });
  ok('4 · y «Sin resultados» cuando el buscador contestó y no encontró nada', sv.ok && /Sin resultados para «xyzzy-nada»/.test(sv.out), sv.out);
  await v.ctx.close();
}
// 5 · un sitio con CORS se lee directo
{
  const { ctx, alProxy, llama } = await escenario(r => r.fulfill({ status: 404, body: '' }), { directoCORS: true });
  const f = await llama('fetch', { url: 'https://example.com' });
  ok('5 · con CORS se lee directo y el proxy ni se toca', f.ok && /Example Domain directo/.test(f.out) && alProxy.length === 0, `${f.out} · proxy ${alProxy.length}`);
  await ctx.close();
}
// 6 · el sitio contesta él mismo un 404 (con CORS se ve): la página NO existe, y
// eso es lo que se dice. Antes, con /proxy en 404, decía «CORS» y «no es que la
// página no exista».
{
  const sinProxy = r => r.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404 Not Found</h1>' });
  const { ctx, alProxy, llama } = await escenario(sinProxy, {
    sitio: r => r.fulfill({ status: 404, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: 'Not Found' }),
  });
  const f = await llama('fetch', { url: 'https://cors-site.example/no-such-page' });
  ok('6 · el 404 del propio sitio: dice que esa página no existe, sin hablar de CORS', !f.ok && /respondió HTTP 404/.test(f.out) && /no existe/.test(f.out) && !/CORS/.test(f.out) && !/No es que/.test(f.out), f.out);
  ok('  …y ni pregunta al proxy (la respuesta del sitio ya es la que es)', alProxy.length === 0, `proxy ${alProxy.length}`);
  await ctx.close();
}
// 7 · un dominio que no resuelve, sin proxy: no se le llama «CORS» a secas ni se
// dice que la página exista.
{
  const { ctx, llama } = await escenario(r => r.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404 Not Found</h1>' }), {
    sitio: r => r.abort('namenotresolved'),
  });
  const f = await llama('fetch', { url: 'https://no-such-host.invalid/' });
  ok('7 · un dominio que no resuelve: CORS o sin conexión, sin afirmar que la página exista', !f.ok && /no se pudiera conectar/.test(f.out) && !/No es que la página no exista/.test(f.out), f.out);
  await ctx.close();
}
// 8 · el sitio contesta otro error (403) y no hay proxy: se dice su estado.
{
  const { ctx, alProxy, llama } = await escenario(r => r.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404 Not Found</h1>' }), {
    sitio: r => r.fulfill({ status: 403, contentType: 'text/html', headers: { 'access-control-allow-origin': '*' }, body: 'Forbidden' }),
  });
  const f = await llama('fetch', { url: 'https://cors-site.example/privada' });
  ok('8 · otro error del sitio (403): se dice su estado y que no hay proxy para intentarlo de otra forma', !f.ok && /respondió HTTP 403/.test(f.out) && /no tiene el proxy de respaldo/.test(f.out) && !/CORS/.test(f.out), `${f.out} · proxy ${alProxy.length}`);
  await ctx.close();
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ WEB: si no puede leer o buscar, dice por qué');
await b.close();
process.exit(fails ? 1 : 0);

// Proveedor API externo (OpenAI-compatible y Anthropic) y la señal de parar.
//
// Desde 2421c1b, openaiChat usaba un `signal` que no existía en su ámbito: CADA
// llamada a un proveedor OpenAI-compatible reventaba con «signal is not
// defined». Y aunque no hubiera reventado, la señal no llegaba a fetch.
//
// Aquí un servidor SSE local y lento hace de proveedor. La página no sale a
// ningún sitio: page.route desvía las peticiones a /fake-llm/ hacia él (mismo
// origen para la página, así que sin CORS), y cualquier otra cosa que intente
// salir hacia una API real se corta. Se comprueba:
//   1. una llamada normal funciona y trae el texto entero;
//   2. abortar tras el primer token rechaza con AbortError, no entrega ni un
//      token más, y el servidor VE cerrarse la conexión antes de terminar
//      (o sea, que fetch se canceló de verdad y no solo se dejó de leer);
//   3. abortar ANTES de que lleguen las cabeceras (el proveedor aún en cola o
//      leyendo el prompt): rechaza con AbortError en el acto y el servidor ve
//      cerrarse la petición antes de contestar. Es el caso en que la señal de
//      fetch importa: en el 2 basta con que readSSE cancele el lector, y ese
//      caso pasaba igual con fetch sin señal.
//
//   BASE=http://localhost:8799 node tests/api-signal.mjs
import http from 'node:http';
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const TOKENS = ['Ho', 'la', ', ', 'soy', ' el', ' proveedor', ' de', ' prueba', '.'];
const registro = [];   // una entrada por petición: { ruta, enviados, cerradaAntes, terminada, contestada }
let retrasarCabeceras = false;   // el caso 3: el servidor tarda en contestar
const servidor = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' });
    return res.end();
  }
  const r = { ruta: req.url, enviados: 0, cerradaAntes: false, terminada: false, contestada: false };
  registro.push(r);
  req.resume();
  if (retrasarCabeceras) {
    // Sin cabeceras durante un buen rato: si la petición se cierra antes, es
    // que fetch la canceló.
    const cerrada = await Promise.race([
      new Promise(ok => res.on('close', () => ok(true))),
      new Promise(ok => setTimeout(() => ok(false), 4000)),
    ]);
    if (cerrada) { r.cerradaAntes = true; return; }
  }
  r.contestada = true;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
  const anthropic = req.url.endsWith('/v1/messages');
  let i = 0;
  const tic = setInterval(() => {
    if (i < TOKENS.length) {
      const t = TOKENS[i++];
      const ev = anthropic
        ? { type: 'content_block_delta', delta: { type: 'text_delta', text: t } }
        : { choices: [{ delta: { content: t } }] };
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
      r.enviados++;
      return;
    }
    clearInterval(tic);
    if (!anthropic) res.write('data: [DONE]\n\n');
    r.terminada = true;
    res.end();
  }, 150);
  res.on('close', () => { if (!r.terminada) { r.cerradaAntes = true; clearInterval(tic); } });
});
await new Promise(r => servidor.listen(0, '127.0.0.1', r));
const PUERTO = servidor.address().port;

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
const fuera = [];
// Nada de APIs reales: lo que vaya a /fake-llm/ se desvía al servidor local; el
// resto de hosts de LLM conocidos, cortado.
await p.route('**/fake-llm/**', route => {
  const u = new URL(route.request().url());
  return route.continue({ url: `http://127.0.0.1:${PUERTO}${u.pathname.replace('/fake-llm', '')}` });
});
await p.route(/api\.openai\.com|api\.anthropic\.com|elffuss\.com\/v1/, route => { fuera.push(route.request().url()); return route.abort(); });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1000);

for (const kind of ['openai', 'anthropic']) {
  const antes = registro.length;
  const r = await p.evaluate(async (kind) => {
    const api = await import('/js/providers/api.js');
    api.configure({ kind, label: 'prueba ' + kind, baseURL: location.origin + '/fake-llm' + (kind === 'openai' ? '/v1' : ''), apiKey: 'clave-de-prueba', model: 'modelo-de-prueba' });
    await api.load();
    const h = [{ role: 'user', content: 'hola' }];
    // 1. normal
    let normal = null, errNormal = null; const toks = [];
    try { normal = await api.chat(h, 'sistema', t => toks.push(t)); } catch (e) { errNormal = e.name + ': ' + e.message; }
    // 2. abortar tras el primer token
    const ac = new AbortController(); const toks2 = []; let err = null, devuelto;
    try {
      devuelto = await api.chat(h, 'sistema', t => { toks2.push(t); if (toks2.length === 1) ac.abort(); }, ac.signal);
    } catch (e) { err = { name: e.name, partial: e.partial }; }
    await new Promise(r => setTimeout(r, 600));   // margen: si siguiera leyendo, llegarían más tokens
    return { normal, errNormal, ntoks: toks.length, err, devuelto, toks2: toks2.length };
  }, kind);
  await new Promise(r => setTimeout(r, 300));
  const [pNormal, pAbort] = registro.slice(antes);
  ok(`${kind} · llamada normal: trae la respuesta entera`, r.normal === TOKENS.join('') && !r.errNormal, r.errNormal || JSON.stringify(r.normal));
  ok(`${kind} · abortar tras el 1.er token: rechaza con AbortError`, r.err?.name === 'AbortError', JSON.stringify(r.err) + ' devuelto ' + JSON.stringify(r.devuelto));
  ok(`${kind} · …con lo generado hasta ahí en «partial»`, r.err?.partial === TOKENS[0], JSON.stringify(r.err?.partial));
  ok(`${kind} · …y ni un token más después de parar`, r.toks2 === 1, `${r.toks2} tokens`);
  ok(`${kind} · el servidor ve cortarse la conexión antes de terminar (fetch cancelado de verdad)`,
    !!pAbort && pAbort.cerradaAntes && !pAbort.terminada && pAbort.enviados < TOKENS.length,
    pAbort ? `enviados ${pAbort.enviados} de ${TOKENS.length}` : 'no llegó la petición');
  ok(`${kind} · control: la llamada normal sí llegó al final`, !!pNormal && pNormal.terminada && !pNormal.cerradaAntes);

  // 3. Abortar antes de que lleguen las cabeceras.
  retrasarCabeceras = true;
  const antes3 = registro.length;
  const r3 = await p.evaluate(async () => {
    const api = await import('/js/providers/api.js');
    const ac = new AbortController();
    const t0 = performance.now();
    let err = null, devuelto;
    const prom = api.chat([{ role: 'user', content: 'hola' }], 'sistema', () => {}, ac.signal)
      .then(v => { devuelto = v; }, e => { err = { name: e.name }; });
    await new Promise(r => setTimeout(r, 500));   // la petición ya salió y espera cabeceras
    ac.abort();
    await prom;
    return { err, devuelto, antesDeContestar: performance.now() - t0 < 3500 };
  });
  await new Promise(r => setTimeout(r, 300));
  retrasarCabeceras = false;
  const p3 = registro[antes3];
  ok(`${kind} · abortar antes de las cabeceras: rechaza con AbortError sin esperar a que conteste`, r3.err?.name === 'AbortError' && r3.antesDeContestar,
    JSON.stringify(r3));
  ok(`${kind} · …y el servidor ve cerrarse la petición antes de contestar`, !!p3 && p3.cerradaAntes && !p3.contestada,
    p3 ? JSON.stringify(p3) : 'no llegó la petición');
}
ok('ninguna petición intentó salir a una API real', fuera.length === 0, fuera.join(' '));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ PROVEEDOR API OK — funciona, y parar corta la petición de verdad');
await b.close();
servidor.close();
process.exit(fails ? 1 : 0);

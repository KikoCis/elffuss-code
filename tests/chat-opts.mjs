// El 4º argumento de chat(): la señal de parar sola o `{ signal, onPrefill }`.
//
// chat() del motor propio acepta las dos formas, y hay llamadores de las dos:
// unos pasan la señal por posición y el agente que pinta la espera del motor
// manda un objeto de opciones con onPrefill. api.js y onnx.js son copias
// idénticas en Code y en Claw. Sin normalizar el objeto:
//   · api.js lo pasaba a fetch como `signal`: TypeError en CADA llamada;
//   · onnx.js llamaba a `signal.addEventListener`: TypeError antes de generar;
//   · litert.js leía `signal.aborted`, que no existe: parar no paraba.
//
// Sin modelo, sin GPU y sin red: litert.js en node con un motor de mentira
// (__usarMotor); onnx.js con un generador de mentira (__usarGenerador) y api.js
// contra un servidor SSE local (page.route, como api-signal.mjs), los dos en el
// navegador. Cada forma se prueba parando a mitad y ya parada, y el objeto sin
// señal tiene que contestar entero. La señal sola es el control: tiene que
// seguir dando lo mismo que antes.
//
//   BASE=http://localhost:8799 node tests/chat-opts.mjs
//   (LITERT=/ruta/a/litert.js para probar otra copia del proveedor)
import http from 'node:http';
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const SOLA = 'señal sola', OBJETO = '{ signal, onPrefill }', SIN = '{ onPrefill } sin señal';

// ── litert.js, en node ──────────────────────────────────────────────────────
const L = await import(process.env.LITERT ? 'file://' + process.env.LITERT : '../web/js/providers/litert.js');
globalThis.__ELFFUSS_PRUEBAS__ = true;   // el gancho __usarMotor solo funciona si la prueba lo pide
function motor() {
  const conversaciones = [];
  return {
    conversaciones,
    async createConversation(cfg) {
      const c = {
        enviados: [],
        async getTokenCount() { return 50; },
        async delete() {},
        sendMessageStreaming(texto) {
          this.enviados.push(texto);
          return (async function* () {
            for (const t of ['Una ', 'respuesta ', 'bastante ', 'larga.']) {
              await new Promise(r => setTimeout(r, 5));
              yield { content: [{ type: 'text', text: t }] };
            }
          })();
        },
      };
      conversaciones.push(c);
      return c;
    },
  };
}
const SISTEMA = 'Eres Elffuss: '.padEnd(200, '·') + '\nreglas…';
const argDe = (forma, ac) => (forma === SOLA ? ac.signal : forma === SIN ? { onPrefill: () => {} } : { signal: ac.signal, onPrefill: () => {} });

async function casoLitert(forma, modo) {
  const m = motor(); L.__usarMotor(m, 4096);
  const ac = new AbortController();
  if (modo === 'yaParada') ac.abort();
  const trozos = []; let out = null, err = null;
  try {
    out = await L.chat([{ role: 'user', content: 'hola' }], SISTEMA,
      t => { trozos.push(t); if (modo === 'aMitad' && trozos.length === 2) ac.abort(); }, argDe(forma, ac));
  } catch (e) { err = `${e.name}: ${e.message}`; }
  return { out, err, trozos: trozos.length, conversaciones: m.conversaciones.length };
}

for (const forma of [SOLA, OBJETO]) {
  const a = await casoLitert(forma, 'aMitad');
  ok(`litert · ${forma} · parar tras el 2.º trozo: devuelve solo lo generado y ni un trozo más`,
    !a.err && a.out === 'Una respuesta' && a.trozos === 2, a.err || `${JSON.stringify(a.out)} · ${a.trozos} trozos`);
  const y = await casoLitert(forma, 'yaParada');
  ok(`litert · ${forma} · ya parada: no toca el motor`,
    !y.err && y.out === '' && y.conversaciones === 0, y.err || `${JSON.stringify(y.out)} · ${y.conversaciones} conversaciones`);
}
{
  const s = await casoLitert(SIN, 'normal');
  ok(`litert · ${SIN} · contesta entero`, !s.err && s.out === 'Una respuesta bastante larga.', s.err || JSON.stringify(s.out));
}

// ── onnx.js y api.js, en el navegador ───────────────────────────────────────
const TOKENS = ['Ho', 'la', ', ', 'soy', ' el', ' proveedor', ' de', ' prueba', '.'];
const registro = [];   // una entrada por petición: { enviados, cerradaAntes, terminada }
const servidor = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST' });
    return res.end();
  }
  const r = { enviados: 0, cerradaAntes: false, terminada: false };
  registro.push(r);
  req.resume();
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

// onnx.js: el mismo generador de mentira que onnx-stop.mjs, con un criterio de
// parada que se llama como el de transformers.js.
const rOnnx = await p.evaluate(async ({ SOLA, OBJETO, SIN }) => {
  const onnx = await import('/js/providers/onnx.js');
  if (typeof onnx.__usarGenerador !== 'function') return { sinGancho: true };
  globalThis.__ELFFUSS_PRUEBAS__ = true;   // el gancho solo funciona si la prueba lo pide
  const N = 30;
  class CorteLocal {
    constructor() { const f = (ids) => new Array(ids.length).fill(f.interrupted); f.interrupted = false; f.interrupt = () => { f.interrupted = true; }; return f; }
  }
  class Streamer { constructor(_tok, o) { this.o = o; } put(t) { this.o.callback_function(t); } end() {} }
  const generador = (cuenta) => {
    const g = async (messages, opts) => {
      let texto = '';
      for (let i = 0; i < N; i++) {
        const sc = opts.stopping_criteria;
        if (sc && sc([[0]], null).every(Boolean)) break;
        await new Promise(r => setTimeout(r, 15));
        const t = 'p' + i + ' ';
        texto += t; cuenta.pasos++;
        opts.streamer.put(t);
      }
      return [{ generated_text: [...messages, { role: 'assistant', content: texto }] }];
    };
    g.tokenizer = {};
    return g;
  };
  const argDe = (forma, ac) => (forma === SOLA ? ac.signal : forma === SIN ? { onPrefill: () => {} } : { signal: ac.signal, onPrefill: () => {} });
  const caso = async (forma, modo) => {
    const cuenta = { pasos: 0 };
    onnx.__usarGenerador(generador(cuenta), Streamer, CorteLocal);
    const ac = new AbortController();
    if (modo === 'yaParada') ac.abort();
    const toks = []; let err = null, out = null;
    try {
      out = await onnx.chat([{ role: 'user', content: 'hola' }], 'sistema',
        t => { toks.push(t); if (modo === 'aMitad' && toks.length === 3) ac.abort(); }, argDe(forma, ac));
    } catch (e) { err = { name: e.name, message: String(e.message).slice(0, 120), partial: e.partial }; }
    return { pasos: cuenta.pasos, toks: toks.length, err, out };
  };
  const res = { N };
  for (const forma of [SOLA, OBJETO]) res[forma] = { aMitad: await caso(forma, 'aMitad'), yaParada: await caso(forma, 'yaParada') };
  res[SIN] = await caso(SIN, 'normal');
  return res;
}, { SOLA, OBJETO, SIN });

if (rOnnx.sinGancho) ok('onnx.js expone __usarGenerador para la prueba', false);
else {
  for (const forma of [SOLA, OBJETO]) {
    const { aMitad: a, yaParada: y } = rOnnx[forma];
    ok(`onnx · ${forma} · parar tras el 3.er token: se corta la generación, AbortError con lo generado y ni un token más`,
      a.err?.name === 'AbortError' && a.err?.partial === 'p0 p1 p2' && a.toks === 3 && a.pasos <= 4,
      `${a.pasos} pasos de ${rOnnx.N} · ${a.toks} tokens · ${JSON.stringify(a.err)}`);
    ok(`onnx · ${forma} · ya parada: rechaza sin generar`,
      y.err?.name === 'AbortError' && y.pasos === 0, `${y.pasos} pasos · ${JSON.stringify(y.err)}`);
  }
  const s = rOnnx[SIN];
  ok(`onnx · ${SIN} · devuelve la respuesta entera`, !s.err && s.pasos === rOnnx.N && !!s.out?.startsWith('p0 p1'),
    `${s.pasos} pasos · ${JSON.stringify(s.err)}`);
}

// api.js: los dos dialectos contra el servidor SSE lento.
async function casoApi(kind, forma, modo) {
  const antes = registro.length;
  const r = await p.evaluate(async ({ kind, forma, modo, SOLA, SIN }) => {
    const api = await import('/js/providers/api.js');
    api.configure({ kind, label: 'prueba ' + kind, baseURL: location.origin + '/fake-llm' + (kind === 'openai' ? '/v1' : ''), apiKey: 'clave-de-prueba', model: 'modelo-de-prueba' });
    await api.load();
    const ac = new AbortController();
    if (modo === 'yaParada') ac.abort();
    const arg = forma === SOLA ? ac.signal : forma === SIN ? { onPrefill: () => {} } : { signal: ac.signal, onPrefill: () => {} };
    const toks = []; let err = null, out = null;
    try {
      out = await api.chat([{ role: 'user', content: 'hola' }], 'sistema',
        t => { toks.push(t); if (modo === 'aMitad' && toks.length === 1) ac.abort(); }, arg);
    } catch (e) { err = { name: e.name, message: String(e.message).slice(0, 160), partial: e.partial }; }
    await new Promise(r => setTimeout(r, 600));   // margen: si siguiera leyendo, llegarían más tokens
    return { out, err, toks: toks.length };
  }, { kind, forma, modo, SOLA, SIN });
  await new Promise(r => setTimeout(r, 300));
  return { ...r, peticiones: registro.slice(antes) };
}

for (const kind of ['openai', 'anthropic']) {
  for (const forma of [SOLA, OBJETO]) {
    const a = await casoApi(kind, forma, 'aMitad');
    const pa = a.peticiones[0];
    ok(`api ${kind} · ${forma} · parar tras el 1.er token: AbortError con lo generado, ni un token más y la conexión cortada`,
      a.err?.name === 'AbortError' && a.err?.partial === TOKENS[0] && a.toks === 1 &&
      a.peticiones.length === 1 && pa.cerradaAntes && !pa.terminada,
      `${a.toks} tokens · ${JSON.stringify(a.err)} · ${a.peticiones.length} peticiones${pa ? ` · enviados ${pa.enviados} de ${TOKENS.length}` : ''}`);
    const y = await casoApi(kind, forma, 'yaParada');
    ok(`api ${kind} · ${forma} · ya parada: AbortError y no sale ninguna petición`,
      y.err?.name === 'AbortError' && y.toks === 0 && y.peticiones.length === 0,
      `${JSON.stringify(y.err)} · ${y.peticiones.length} peticiones`);
  }
  const s = await casoApi(kind, SIN, 'normal');
  ok(`api ${kind} · ${SIN} · trae la respuesta entera`,
    !s.err && s.out === TOKENS.join('') && s.peticiones.length === 1 && s.peticiones[0].terminada,
    s.err ? JSON.stringify(s.err) : JSON.stringify(s.out));
}
ok('ninguna petición intentó salir a una API real', fuera.length === 0, fuera.join(' '));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ chat() acepta la señal sola y { signal, onPrefill } en los tres proveedores');
await b.close();
servidor.close();
process.exit(fails ? 1 : 0);

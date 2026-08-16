// Elffuss Lab — banco de pruebas del propio producto.
//
// Tres cosas, en la misma mesa:
//   1) ELEGIR algoritmo de generación (directo / RLM map-reduce / RLM con
//      crítica) y ENCENDER o APAGAR cada perilla del compresor de contexto.
//   2) LANZAR benchmarks reales y ver el progreso caso a caso, en vivo.
//   3) GUARDAR la corrida con su TRAZA en un historial y un ranking LOCALES:
//      todo se queda en esta máquina, no se envía nada a ningún sitio.
//
// Nada de esto simula: el banco de contexto llama al `packHistoryACER` de
// verdad, el de SWE ejecuta los tests de verdad contra el módulo arreglado, y
// el de juegos ejecuta el juego generado y lo puntúa mirándolo correr.
import { DEFAULTS, packHistoryACER, estimateTokens } from './acer-core.js';
import { TASKS } from './swe-tasks.js';

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

// ─────────────────────────── estado ───────────────────────────
const S = {
  brain: localStorage.getItem('elffusscode.model') || 'rules',
  algo: 'directo',
  algoOpts: { rounds: 1, chunkTokens: 1800, maxChunks: 24 },
  ctx: {},                       // overrides sobre DEFAULTS
  bench: 'contexto',
  provider: null,
  running: false, abort: false,
  run: null,                     // { bench, casos:[], métricas:{} } — la traza
};

// Perillas del compresor que tiene sentido tocar a mano (las demás quedan en su
// valor por defecto). El «porqué» sale del propio acer-core.
const CTX_KNOBS = [
  ['recuperación', [
    ['SEMANTIC', 'bool', 'fusiona embeddings con BM25 — INERTE en el banco de contexto (ese usa el packer sin embeddings)'],
    ['MMR', 'bool', 'diversifica lo recuperado (evita repetir lo mismo)'],
    ['DEDUP', 'bool', 'quita mensajes casi idénticos'],
    ['PIN_QUERY_TERMS', 'bool', 'clava los términos de la pregunta'],
    ['SUPERSEDE', 'bool', 'lo nuevo pisa a lo viejo cuando se contradicen'],
    ['RECENCY_WEIGHT', 'num', 'peso de lo reciente al puntuar'],
  ]],
  ['presupuesto', [
    ['ELASTIC', 'bool', 'estira/encoge según la presión real'],
    ['RECENT', 'num', 'nº de turnos recientes intocables'],
    ['TAIL_MIN_FRAC', 'num', 'suelo garantizado para la cola'],
    ['HEAD_FRAC', 'num', 'reserva para el arranque (0 = apagada)'],
    ['MAX_MSG_CHARS', 'num', 'recorte por mensaje'],
  ]],
  ['extras', [
    ['DATES', 'bool', 'anota «ayer» con la fecha del turno'],
    ['SUMMARY', 'bool', 'tarjeta de recuento (cuesta presupuesto)'],
    ['AUTO', 'bool', 'deriva las perillas de lo medido en ESTE historial'],
  ]],
];

const ALGOS = [
  ['directo', 'Directo', 'Una sola inferencia. El baremo contra el que se compara todo.'],
  ['rlm-deep', 'RLM · crear y criticar', 'Borrador → crítica → reescritura, N rondas (deepCreate).'],
  ['rlm-hard', 'RLM · Hard Work', 'Trocea el material, pregunta a cada trozo y funde (map-reduce).'],
];

const BENCHES = [
  ['contexto', 'Contexto (ACER)', 'Determinista y sin GPU: mide qué evidencia SOBREVIVE al compresor y a qué precio en tokens. Reacciona a las perillas al instante.'],
  ['swe', 'SWE-bench-style', `${TASKS.length} repos con un bug real: el agente lo arregla con sus tools y se EJECUTA el test. Métrica: resolved/N.`],
  ['juegos', 'Juegos (generar y jugar)', 'Genera un juego con el algoritmo elegido, lo ejecuta y lo puntúa: carga sin errores, arranca, se mueve y aguanta jugando.'],
];

const BRAINS = [
  ['rules', 'Reglas (sin GPU)', 'Determinista. Valida el arnés sin bajar pesos.'],
  ['onnx', 'Elffuss LM (CPU/wasm)', 'LFM2.5-1.2B por transformers.js.'],
  ['litert:gemma-e2b', 'Gemma-4 E2B (~2 GB)', 'WebGPU.'],
  ['litert:gemma-e4b', 'Gemma-4 E4B (~3 GB)', 'WebGPU. El mejor.'],
];

// ─────────────────────────── consola ───────────────────────────
function log(msg, cls = '') {
  const t = new Date().toTimeString().slice(0, 8);
  const line = el('div');
  line.appendChild(el('span', 't', t + '  '));
  line.appendChild(el('span', cls, msg));
  $('#log').appendChild(line);
  $('#log').scrollTop = $('#log').scrollHeight;
}
const setLed = (id, cls, txt) => { const n = $(id); n.className = 'led ' + cls; n.querySelector('span').textContent = txt; };
const prog = (done, total, txt) => {
  $('#prog').style.width = total ? Math.round(done / total * 100) + '%' : '0';
  $('#prog-txt').textContent = txt || (total ? `${done}/${total}` : '—');
};

function tiles(obj) {
  const box = $('#tiles'); box.innerHTML = '';
  for (const [k, v] of Object.entries(obj)) {
    const t = el('div', 'tile' + (v && v.bad ? ' bad' : v && v.warn ? ' warn' : ''));
    t.appendChild(el('div', 'k', k));
    const val = (v && typeof v === 'object') ? v.v : v;
    t.appendChild(el('div', 'v' + (String(val).length > 7 ? ' small' : ''), String(val)));
    box.appendChild(t);
  }
}
function table(cols, rows) {
  $('#res-head').innerHTML = '<tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
  $('#res-body').innerHTML = '';
  rows.forEach(addRow);
}
function addRow(cells) {
  const tr = el('tr');
  cells.forEach(c => {
    const td = el('td');
    if (c && typeof c === 'object') { td.className = c.cls || ''; td.textContent = c.t; }
    else td.textContent = c;
    tr.appendChild(td);
  });
  $('#res-body').appendChild(tr);
  return tr;
}

// ─────────────────────────── interfaz ───────────────────────────
function radio(host, items, current, onPick) {
  host.innerHTML = '';
  items.forEach(([id, title, desc]) => {
    const l = el('label', id === current ? 'sel' : '');
    const i = el('input'); i.type = 'radio'; i.name = host.id; i.checked = id === current;
    i.onchange = () => { onPick(id); radio(host, items, id, onPick); };
    const d = el('div');
    d.appendChild(el('div', 't', title));
    d.appendChild(el('div', 'd', desc));
    l.append(i, d); host.appendChild(l);
  });
}

function ctxUI() {
  const host = $('#ctx-knobs'); host.innerHTML = '';
  for (const [group, knobs] of CTX_KNOBS) {
    host.appendChild(el('div', 'group-title', group));
    const box = el('div', 'knobs');
    for (const [key, type, why] of knobs) {
      const row = el('div', 'knob');
      const cur = key in S.ctx ? S.ctx[key] : DEFAULTS[key];
      const inp = el('input');
      if (type === 'bool') { inp.type = 'checkbox'; inp.checked = !!cur; }
      else { inp.type = 'number'; inp.step = 'any'; inp.value = cur ?? 0; }
      inp.onchange = () => {
        S.ctx[key] = type === 'bool' ? inp.checked : Number(inp.value);
        ctxTag();
        if (S.bench === 'contexto') log('perilla ' + key + ' → ' + S.ctx[key] + ' (relanza para medir)', 'w');
      };
      row.append(inp, el('code', '', key), el('div', 'why', why));
      box.appendChild(row);
    }
    host.appendChild(box);
  }
  ctxTag();
}
function ctxTag() {
  const on = CTX_KNOBS.flatMap(([, k]) => k).filter(([key, t]) => t === 'bool' && (key in S.ctx ? S.ctx[key] : DEFAULTS[key])).length;
  $('#ctx-tag').textContent = on + ' activas';
}
function algoKnobs() {
  const host = $('#algo-knobs'); host.innerHTML = '';
  const defs = S.algo === 'rlm-hard'
    ? [['chunkTokens', 'tamaño de cada trozo'], ['maxChunks', 'techo de sub-llamadas']]
    : S.algo === 'rlm-deep' ? [['rounds', 'rondas de crítica + reescritura']] : [];
  if (!defs.length) { host.appendChild(el('div', 'hint', 'El modo directo no tiene parámetros: una inferencia y ya.')); return; }
  const box = el('div', 'knobs');
  defs.forEach(([k, why]) => {
    const row = el('div', 'knob');
    const i = el('input'); i.type = 'number'; i.value = S.algoOpts[k]; i.min = 0;
    i.onchange = () => { S.algoOpts[k] = Number(i.value); };
    row.append(i, el('code', '', k), el('div', 'why', why));
    box.appendChild(row);
  });
  host.appendChild(box);
}

// ─────────────────────────── cerebro ───────────────────────────
async function loadBrain() {
  const id = S.brain;
  $('#btn-load').disabled = true;
  setLed('#led-model', 'busy', 'cargando ' + id + '…');
  try {
    let mod;
    if (id === 'rules') mod = await import('./providers/rules.js');
    else if (id === 'onnx') mod = await import('./providers/onnx.js');
    else if (id.startsWith('litert:')) {
      mod = await import('./providers/litert.js');
      mod.configure(id.split(':')[1]);
    }
    if (mod.load) await mod.load(s => { $('#load-state').textContent = String(s).slice(0, 60); });
    S.provider = mod;
    setLed('#led-model', 'on', 'modelo: ' + id);
    $('#load-state').textContent = '';
    log('cerebro listo: ' + id, 'a');
  } catch (e) {
    setLed('#led-model', 'err', 'fallo al cargar');
    log('no se pudo cargar el cerebro: ' + e.message, 'e');
  }
  $('#btn-load').disabled = false;
}

// ═══════════════ BANCO 1 · contexto (determinista, sin GPU) ═══════════════
// Construye un historial largo con HECHOS plantados y ruido alrededor, lo pasa
// por el compresor con las perillas elegidas y mide qué evidencia sobrevive y
// cuántos tokens cuesta. Sin modelo: mide el COMPRESOR, no al que responde.
// Cada caso trae: el dato BUENO, una versión CADUCADA del mismo dato (dicha
// antes) y distractores que comparten vocabulario con la pregunta. Así el banco
// no premia «meter mucho», sino traer lo correcto y dejar fuera lo viejo — que
// es lo que de verdad hacen SUPERSEDE, PIN_QUERY_TERMS o DEDUP.
const HECHOS = [
  { bueno: 'Ahora el servidor de pagos escucha en el puerto 7421.', viejo: 'El servidor de pagos escuchaba en el puerto 3000.',
    q: '¿en qué puerto escucha el servidor de pagos?', clave: '7421', claveVieja: '3000',
    ruido: ['El servidor de correo va por otro puerto distinto.', 'Ese puerto del router no tiene nada que ver con pagos.'] },
  { bueno: 'La clave de despliegue caduca el 3 de marzo.', viejo: 'La clave de despliegue caducaba el 9 de enero.',
    q: '¿cuándo caduca la clave de despliegue?', clave: '3 de marzo', claveVieja: '9 de enero',
    ruido: ['La clave del wifi la cambiaron en verano.', 'El despliegue de ayer no tocó ninguna clave.'] },
  { bueno: 'Nordvik factura ahora en coronas.', viejo: 'Nordvik facturaba en euros.',
    q: '¿en qué moneda factura Nordvik?', clave: 'coronas', claveVieja: 'facturaba en euros',
    ruido: ['Nordvik cambió de comercial el trimestre pasado.', 'A otros clientes se les factura en euros.'] },
  { bueno: 'El informe trimestral lo firma Beatriz.', viejo: 'El informe trimestral lo firmaba Andrés.',
    q: '¿quién firma el informe trimestral?', clave: 'firma Beatriz', claveVieja: 'firmaba Andrés',
    ruido: ['Andrés sigue en la empresa, pero en otro equipo.', 'Beatriz también revisa el informe mensual.'] },
  { bueno: 'El backup nocturno corre a las 02:30.', viejo: 'El backup nocturno corría a las 23:00.',
    q: '¿a qué hora corre el backup nocturno?', clave: '02:30', claveVieja: '23:00',
    ruido: ['El backup semanal es otra tarea distinta.', 'A las 23:00 lo que hay es el corte de logs.'] },
  { bueno: 'El almacén de Lugo pasó a Vigo.', viejo: 'El almacén principal estaba en Lugo.',
    q: '¿a dónde se movió el almacén de Lugo?', clave: 'pasó a Vigo', claveVieja: 'estaba en Lugo',
    ruido: ['En Lugo queda solo una oficina comercial.', 'El almacén de Vigo ya existía para otra cosa.'] },
];
const RUIDO = [
  'Vale, seguimos mañana con eso.', 'Te paso el enlace en un momento.',
  'Creo que el diseño nuevo se ve mejor.', 'Nos vemos en la reunión de las cinco.',
  'Ese ticket lo cerró soporte la semana pasada.', 'Prefiero no tocar eso hoy.',
  'Lo dejo apuntado para el lunes.', 'Sí, ya lo hemos hablado antes.',
];

// Historial LARGO: el dato bueno queda enterrado y fuera de la ventana reciente.
function historialCon(c, largo = 420) {
  const h = [];
  const posViejo = Math.floor(largo * 0.10);
  const posBueno = Math.floor(largo * 0.55);
  const posRuido = [Math.floor(largo * 0.30), Math.floor(largo * 0.75)];
  for (let i = 0; i < largo; i++) {
    let txt = RUIDO[i % RUIDO.length] + ' (' + i + ')';
    if (i === posViejo) txt = c.viejo;
    else if (i === posBueno) txt = c.bueno;
    else if (i === posRuido[0]) txt = c.ruido[0];
    else if (i === posRuido[1]) txt = c.ruido[1];
    h.push({ role: i % 2 ? 'assistant' : 'user', content: txt, ts: Date.now() - (largo - i) * 60000 });
  }
  return h;
}

async function benchContexto(onCase) {
  const opts = { ...DEFAULTS, ...S.ctx };
  const budget = 320;                    // muy apretado: obliga a ELEGIR
  const filas = [];
  for (let i = 0; i < HECHOS.length; i++) {
    if (S.abort) break;
    const c = HECHOS[i];
    const hist = historialCon(c);
    hist.push({ role: 'user', content: c.q, ts: Date.now() });
    const { messages } = packHistoryACER(hist, budget, opts);
    const texto = messages.map(m => m.content).join('\n');
    const sobrevive = texto.includes(c.clave);
    const arrastraViejo = texto.includes(c.claveVieja);
    const usados = estimateTokens(texto);
    filas.push({ pregunta: c.q, sobrevive, arrastraViejo, usados, deN: hist.length, quedan: messages.length });
    onCase(filas[filas.length - 1], i, HECHOS.length);
    await new Promise(r => setTimeout(r, 25));         // deja respirar a la UI
  }
  const rec = filas.filter(f => f.sobrevive).length;
  const conf = filas.filter(f => f.arrastraViejo).length;
  return {
    filas,
    resumen: {
      'evidencia recuperada': `${rec}/${filas.length}`,
      'recall': (filas.length ? (rec / filas.length * 100).toFixed(0) : 0) + '%',
      'arrastra dato viejo': { v: `${conf}/${filas.length}`, bad: conf > 0 },
      'tokens medios': Math.round(filas.reduce((a, f) => a + f.usados, 0) / (filas.length || 1)),
      'presupuesto': budget,
      'mensajes que pasan': Math.round(filas.reduce((a, f) => a + f.quedan, 0) / (filas.length || 1)),
    },
  };
}

// ═══════════════ BANCO 2 · SWE-bench-style (ejecuta los tests) ═══════════════
async function opfsRoot() { return navigator.storage.getDirectory(); }
async function limpiarOPFS() {
  const o = await opfsRoot();
  for await (const e of o.values()) await o.removeEntry(e.name, { recursive: true }).catch(() => {});
}
async function sembrar(files) {
  const o = await opfsRoot();
  for (const [path, txt] of Object.entries(files)) {
    const parts = path.split('/'); const name = parts.pop(); let d = o;
    for (const x of parts) d = await d.getDirectoryHandle(x, { create: true });
    const w = await (await d.getFileHandle(name, { create: true })).createWritable();
    await w.write(txt); await w.close();
  }
}
async function leer(path) {
  const o = await opfsRoot();
  const parts = path.split('/'); const name = parts.pop(); let d = o;
  for (const x of parts) d = await d.getDirectoryHandle(x);
  return (await (await d.getFileHandle(name)).getFile()).text();
}
// Ejecuta DE VERDAD el módulo arreglado y le pasa el test de la tarea.
async function pasaElTest(task) {
  const src = await leer(task.target);
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  try { return !!task.test(await import(/* @vite-ignore */ url)); }
  catch { return false; }
  finally { URL.revokeObjectURL(url); }
}

async function benchSWE(onCase) {
  const code = await import('./tools/code.js');
  await code.openProject(await opfsRoot());
  const { Agent } = await import('./agent.js');
  const filas = [];
  for (let i = 0; i < TASKS.length; i++) {
    if (S.abort) break;
    const t = TASKS[i];
    await limpiarOPFS(); await sembrar(t.files);
    code.invalidateFileList();
    const t0 = performance.now();
    let pasos = 0, err = null;
    try {
      if (S.brain === 'rules') {
        // Solver de guion: valida el ARNÉS (debe dar N/N) sin gastar GPU.
        await sembrar({ [t.target]: t.solution });
      } else {
        const ag = new Agent(S.provider);
        await ag.handle(`${t.task}\n\nEl fichero a arreglar es ${t.target}. Usa code.read y code.edit.`,
          ev => { if (ev.type === 'tool') pasos++; });
      }
    } catch (e) { err = e.message; }
    const ok = err ? false : await pasaElTest(t);
    filas.push({ id: t.id, ok, pasos, secs: Math.round((performance.now() - t0) / 1000), err });
    onCase(filas[filas.length - 1], i, TASKS.length);
  }
  const res = filas.filter(f => f.ok).length;
  return { filas, resumen: { resolved: `${res}/${filas.length}`, '% resueltas': (filas.length ? (res / filas.length * 100).toFixed(0) : 0) + '%', 'pasos totales': filas.reduce((a, f) => a + f.pasos, 0) } };
}

// ═══════════════ BANCO 3 · juegos (genera, ejecuta y puntúa) ═══════════════
const BRIEF_JUEGO = 'Un juego tipo Flappy Bird: un pájaro que cae por gravedad, sube al pulsar espacio o click, ' +
  'tuberías que avanzan y hay que esquivar, colisiones, puntuación y pantalla de fin de partida.';

async function generarJuego() {
  const rlm = await import('./rlm.js').catch(() => null);
  if (!rlm) throw new Error('rlm.js no disponible en esta build');
  let inferencias = 0;
  const contando = { chat: (...a) => { inferencias++; return S.provider.chat(...a); } };
  const rondas = S.algo === 'rlm-deep' ? Math.max(1, S.algoOpts.rounds) : 0;
  const out = await rlm.deepCreate({ brief: BRIEF_JUEGO, provider: contando, rounds: rondas, onProgress: e => log('  ' + JSON.stringify(e)) });
  return { html: out.html, inferencias, trace: out.trace };
}

// Puntúa el juego EJECUTÁNDOLO en la arena: ¿carga sin errores? ¿arranca?
// ¿se mueve? ¿aguanta jugando? Cada criterio suma.
async function puntuarJuego(html) {
  const frame = $('#arena');
  $('#arena-panel').hidden = false;
  const errores = [];
  const onErr = e => errores.push(String(e.message || e).slice(0, 120));
  frame.srcdoc = html;
  await new Promise(r => frame.onload = r);
  const w = frame.contentWindow, d = frame.contentDocument;
  w.addEventListener('error', onErr);
  const hash = () => {
    const c = d.querySelector('canvas'); if (!c) return -1;
    try { const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let h = 7; for (let i = 0; i < px.length; i += 997) h = (h * 31 + px[i]) % 999983; return h;
    } catch { return -1; }
  };
  const esperar = ms => new Promise(r => setTimeout(r, ms));
  const canvas = !!d.querySelector('canvas');
  await esperar(600);
  const h0 = hash();
  // arrancar: pulsar el botón si lo hay, y quitarle el foco (si no, ESPACIO
  // re-pulsa el botón en vez de saltar — nos pasó midiéndolo a mano)
  const btn = d.querySelector('button');
  if (btn) { btn.click(); btn.blur?.(); }
  await esperar(400);
  const arranca = hash() !== h0;
  // jugar: aletear con click en el canvas, que es el manejador que sí registran
  const c = d.querySelector('canvas');
  let vivoMs = 0, puntos = 0;
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) {
    c?.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    d.dispatchEvent(new w.KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    await esperar(300);
    const run = (() => { try { return w.gameRunning; } catch { return null; } })();
    puntos = Math.max(puntos, (() => { try { return w.score || 0; } catch { return 0; } })());
    if (run === false) break;
    vivoMs = performance.now() - t0;
  }
  const criterios = {
    'carga sin errores': errores.length === 0,
    'tiene canvas': canvas,
    'arranca': arranca,
    'aguanta ≥3 s jugando': vivoMs >= 3000,
    'llega a puntuar': puntos > 0,
  };
  return { criterios, errores, vivoSegs: +(vivoMs / 1000).toFixed(1), puntos, bytes: html.length };
}

async function benchJuegos(onCase) {
  if (!S.provider || S.brain === 'rules') throw new Error('este banco necesita un modelo de verdad (Reglas no genera juegos)');
  const filas = [];
  log('generando el juego con «' + S.algo + '»… esto tarda', 'w');
  const g = await generarJuego();
  log(`generado: ${g.html.length} bytes en ${g.inferencias} inferencias`, 'a');
  const p = await puntuarJuego(g.html);
  Object.entries(p.criterios).forEach(([k, v], i) => {
    filas.push({ criterio: k, ok: v });
    onCase(filas[filas.length - 1], i, Object.keys(p.criterios).length);
  });
  S.lastGame = { html: g.html, trace: g.trace };
  const pasa = filas.filter(f => f.ok).length;
  return {
    filas,
    resumen: {
      'criterios superados': `${pasa}/${filas.length}`, inferencias: g.inferencias,
      'bytes': p.bytes, 'segundos vivo': p.vivoSegs, 'puntuación': p.puntos,
    },
  };
}

// ─────────────────────────── orquestación ───────────────────────────
async function run() {
  if (S.running) return;
  S.running = true; S.abort = false;
  $('#btn-run').disabled = true; $('#btn-stop').disabled = false;
  setLed('#led-run', 'busy', 'ejecutando ' + S.bench);
  tiles({}); prog(0, 1, 'preparando…');
  log('▶ benchmark «' + S.bench + '» · algoritmo «' + S.algo + '» · cerebro «' + S.brain + '»', 'a');
  const t0 = Date.now();
  let out = null, error = null;
  try {
    if (S.bench === 'contexto') {
      table(['pregunta', 'dato bueno', 'dato viejo', 'tokens', 'mensajes'], []);
      out = await benchContexto((f, i, n) => {
        addRow([f.pregunta.slice(0, 38),
          f.sobrevive ? { t: 'SOBREVIVE', cls: 'ok' } : { t: 'PERDIDO', cls: 'no' },
          f.arrastraViejo ? { t: 'lo arrastra', cls: 'no' } : { t: 'descartado', cls: 'ok' },
          f.usados, `${f.quedan}/${f.deN}`]);
        prog(i + 1, n, `caso ${i + 1} de ${n}`);
      });
    } else if (S.bench === 'swe') {
      table(['tarea', 'resultado', 'pasos', 'seg'], []);
      out = await benchSWE((f, i, n) => {
        addRow([f.id, f.ok ? { t: 'RESUELTA', cls: 'ok' } : { t: f.err ? 'ERROR' : 'FALLA', cls: 'no' }, f.pasos, f.secs]);
        prog(i + 1, n, `tarea ${i + 1} de ${n}`);
      });
    } else {
      table(['criterio', 'resultado'], []);
      out = await benchJuegos((f, i, n) => {
        addRow([f.criterio, f.ok ? { t: 'SÍ', cls: 'ok' } : { t: 'NO', cls: 'no' }]);
        prog(i + 1, n, `criterio ${i + 1} de ${n}`);
      });
    }
  } catch (e) { error = e.message; log('fallo: ' + e.message, 'e'); }

  if (out) {
    tiles(out.resumen);
    S.run = {
      bench: S.bench, algo: S.algo, algoOpts: { ...S.algoOpts }, brain: S.brain,
      ctx: { ...DEFAULTS, ...S.ctx }, resumen: out.resumen, casos: out.filas,
      duracionSegs: Math.round((Date.now() - t0) / 1000), cuando: new Date().toISOString(),
    };
    log('✔ terminado: ' + JSON.stringify(out.resumen), 'a');
  }
  setLed('#led-run', error ? 'err' : 'on', error ? 'con fallo' : 'listo');
  prog(1, 1, error ? 'abortado' : 'completado');
  S.running = false; $('#btn-run').disabled = false; $('#btn-stop').disabled = true;
}

// ─────────────────── historial y ranking, en local ───────────────────
// Todo se queda en esta máquina: ni se envía ni se pide permiso a nadie. La
// gracia del ranking es comparar CONFIGURACIONES entre sí — qué combinación de
// algoritmo y perillas gana en cada banco — con su traza al lado para revisarla.
const STORE = 'elffusscode.lab.runs';
const MAX_GUARDADAS = 60;

// Puntuación comparable (0-100) según el banco, para poder ordenar.
function puntuar(r) {
  const n = (s) => Number(String(s).split('/')[0]) || 0;
  const d = (s) => Number(String(s).split('/')[1]) || 1;
  if (r.bench === 'contexto') return Math.round(n(r.resumen['evidencia recuperada']) / d(r.resumen['evidencia recuperada']) * 100);
  if (r.bench === 'swe') return Math.round(n(r.resumen.resolved) / d(r.resumen.resolved) * 100);
  return Math.round(n(r.resumen['criterios superados']) / d(r.resumen['criterios superados']) * 100);
}
// Huella corta de la configuración: lo que de verdad distingue una corrida.
function huella(r) {
  const on = Object.entries(r.ctx).filter(([k, v]) => v === true).map(([k]) => k);
  const extra = r.algo === 'rlm-deep' ? `·${r.algoOpts.rounds}r` : '';
  return `${r.algo}${extra} · ${r.brain} · ${on.length} perillas`;
}
const leerRuns = () => { try { return JSON.parse(localStorage.getItem(STORE)) || []; } catch { return []; } };
function guardarCorrida() {
  if (!S.run) return log('todavía no hay ninguna corrida que guardar', 'w');
  const runs = leerRuns();
  runs.push({ ...S.run, score: puntuar(S.run), id: (S.run.cuando || '') + '·' + Math.round(performance.now()) });
  localStorage.setItem(STORE, JSON.stringify(runs.slice(-MAX_GUARDADAS)));
  log('guardada en el historial local (' + runs.length + ' corridas)', 'a');
  pintarRanking();
}
function pintarRanking() {
  const host = $('#rank-body'); host.innerHTML = '';
  const runs = leerRuns().filter(r => r.bench === S.bench).sort((a, b) => b.score - a.score);
  $('#rank-tag').textContent = runs.length ? runs.length + ' corridas · ' + S.bench : 'sin corridas de ' + S.bench;
  if (!runs.length) { host.innerHTML = '<tr><td colspan="5" class="pend">Aún no has guardado ninguna corrida de este banco.</td></tr>'; return; }
  runs.forEach((r, i) => {
    const tr = el('tr');
    const medalla = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
    [[medalla], [{ t: r.score + '%', cls: r.score >= 80 ? 'ok' : r.score >= 40 ? '' : 'no' }],
     [huella(r)], [new Date(r.cuando).toLocaleString()]].forEach(([c]) => {
      const td = el('td');
      if (c && typeof c === 'object') { td.className = c.cls || ''; td.textContent = c.t; } else td.textContent = c;
      tr.appendChild(td);
    });
    const acc = el('td');
    const ver = el('button', 'btn ghost', 'traza');
    ver.style.padding = '2px 8px'; ver.style.fontSize = '11px';
    ver.onclick = () => descargarTraza(r);
    acc.appendChild(ver); tr.appendChild(acc);
    host.appendChild(tr);
  });
}
// Exportar es un fichero en tu disco, no un envío: sirve para revisar la traza
// caso a caso o comparar dos corridas fuera del panel.
function descargarTraza(r) {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
  a.download = `elffuss-lab-${r.bench}-${r.score}.json`;
  a.click();
  log('traza exportada a tu disco', 'a');
}
function borrarHistorial() {
  if (!confirm('¿Borrar TODAS las corridas guardadas?')) return;
  localStorage.removeItem(STORE); pintarRanking(); log('historial local borrado', 'w');
}

// ─────────────────────────── arranque ───────────────────────────
radio($('#brains'), BRAINS, S.brain, id => { S.brain = id; $('#brain-tag').textContent = id; });
radio($('#algos'), ALGOS, S.algo, id => { S.algo = id; $('#algo-tag').textContent = id; algoKnobs(); });
radio($('#benches'), BENCHES, S.bench, id => { S.bench = id; $('#bench-tag').textContent = id; });
$('#brain-tag').textContent = S.brain;
$('#bench-tag').textContent = S.bench;
algoKnobs(); ctxUI();

$('#btn-load').onclick = loadBrain;
$('#btn-run').onclick = run;
$('#btn-stop').onclick = () => { S.abort = true; log('parando tras el caso en curso…', 'w'); };
$('#ctx-all').onclick = () => { CTX_KNOBS.flatMap(([, k]) => k).forEach(([k, t]) => { if (t === 'bool') S.ctx[k] = true; }); ctxUI(); };
$('#ctx-none').onclick = () => { CTX_KNOBS.flatMap(([, k]) => k).forEach(([k, t]) => { if (t === 'bool') S.ctx[k] = false; }); ctxUI(); };
$('#ctx-def').onclick = () => { S.ctx = {}; ctxUI(); };
$('#btn-launch').onclick = () => {
  localStorage.setItem('elffusscode.model', S.brain);
  localStorage.setItem('elffusscode.ctxopts', JSON.stringify(S.ctx));
  localStorage.setItem('elffusscode.algo', JSON.stringify({ algo: S.algo, opts: S.algoOpts }));
  log('configuración guardada; abriendo el IDE', 'a');
  window.open('index.html', '_blank');
};

$('#btn-save').onclick = guardarCorrida;
$('#btn-clear').onclick = borrarHistorial;
pintarRanking();

log('Elffuss Lab listo. Elige algoritmo, enciende o apaga la compresión y lanza un banco.', 'a');
log('El banco de contexto no necesita GPU: mide el compresor y responde al instante.');
log('Los resultados se quedan en esta máquina: historial y ranking local, sin enviar nada.');

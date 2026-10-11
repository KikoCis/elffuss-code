// LiteRT y parar a media respuesta.
// ─────────────────────────────────────────────────────────────────────────────
// La conversación de LiteRT guarda su propio KV y aquí solo se le manda lo
// nuevo. Al parar a mitad, el trozo de respuesta ya generado se queda DENTRO de
// esa conversación, pero el agente no lo apunta en su historial (un turno parado
// no deja respuesta). Si el turno siguiente seguía con la misma conversación, el
// modelo «recordaba» una respuesta a medias que el usuario nunca vio terminar.
// Ahora, al parar, la conversación se tira (y se borra, para que el wasm la
// libere) y la próxima llamada la rehace desde el historial: lo de antes,
// respuestas y llamadas a herramientas incluidas, en el prefacio, y solo lo nuevo
// como mensaje. Parar también corta el prefill (cancel()), y lo que se para antes
// de mandar no se manda.
//
// Y cada conversación es la suya: las pestañas del chat comparten este
// proveedor, y el turno de una no puede seguir dentro de la conversación de
// otra (partes 4, 4b y 4c).
//
// Sin GPU ni navegador: chat() contra un motor de mentira que emite la
// respuesta en varios trozos (como sendMessageStreaming).
//
//   node tests/litert-stop.mjs
const L = await import(process.env.LITERT ? 'file://' + process.env.LITERT : '../web/js/providers/litert.js');

let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${nombre}${extra ? '  — ' + extra : ''}`);
  if (!cond) fallos++;
};

// El gancho de pruebas no hace nada si la prueba no lo pide a propósito.
{
  let error = null;
  try { L.__usarMotor({ createConversation() {} }, 4096); } catch (e) { error = e.message; }
  ok('sin pedirlo, el gancho __usarMotor se niega (en la app no cambia el motor)', /solo para pruebas/.test(error || ''), error || 'no lanzó');
}
globalThis.__ELFFUSS_PRUEBAS__ = true;

function motor() {
  const conversaciones = [];
  return {
    conversaciones,
    async createConversation(cfg) {
      const c = {
        sistema: cfg.preface.messages.map(m => m.content).join('\n'), enviados: [],
        async getTokenCount() { return 50; },
        async delete() { this.borrada = true; },
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

// 1. Parar tras el segundo trozo: devuelve lo generado y tira la conversación.
{
  const m = motor(); L.__usarMotor(m, 4096);
  const h = [{ role: 'user', content: 'primera pregunta' }];
  const ac = new AbortController();
  const trozos = [];
  const out = await L.chat(h, SISTEMA, t => { trozos.push(t); if (trozos.length === 2) ac.abort(); }, ac.signal);
  ok('parado a mitad: devuelve solo lo generado hasta ahí', out === 'Una respuesta', JSON.stringify(out));
  ok('  …y no entrega más trozos tras parar', trozos.length === 2, `${trozos.length} trozos`);

  // El agente no apunta la respuesta parada: el historial sigue con dos de usuario.
  h.push({ role: 'user', content: 'segunda pregunta' });
  await L.chat(h, SISTEMA);
  ok('el turno siguiente NO sigue en la conversación que tenía la respuesta a medias',
    m.conversaciones.length === 2, `${m.conversaciones.length} conversaciones creadas`);
  ok('  …y la que se tiró se borra (delete() libera la conversación del wasm)', m.conversaciones[0]?.borrada === true,
    `borrada ${m.conversaciones[0]?.borrada}`);
  ok('  …la rehace desde el historial: la pregunta parada va en el prefacio y solo se manda la nueva',
    m.conversaciones[1]?.sistema.includes('primera pregunta') && JSON.stringify(m.conversaciones[1]?.enviados) === '["segunda pregunta"]',
    JSON.stringify(m.conversaciones[1]?.enviados));

  // Y sin parar, se vuelve a lo de siempre: misma conversación, solo lo nuevo.
  h.push({ role: 'assistant', content: 'Una respuesta bastante larga.' });
  h.push({ role: 'user', content: 'tercera' });
  await L.chat(h, SISTEMA);
  ok('sin parar: misma conversación y solo el mensaje nuevo', m.conversaciones.length === 2 && m.conversaciones[1]?.enviados.at(-1) === 'tercera',
    JSON.stringify(m.conversaciones[1]?.enviados));
}

// 1b. Un mismo trozo con varios textos: parar en el primero no deja salir el resto.
{
  const m = motor(); L.__usarMotor(m, 4096);
  m.createConversation = (crear => async cfg => {
    const c = await crear(cfg);
    c.sendMessageStreaming = function (texto) {
      this.enviados.push(texto);
      return (async function* () {
        yield { content: [{ type: 'text', text: 'uno ' }, { type: 'text', text: 'dos ' }, { type: 'text', text: 'tres' }] };
      })();
    };
    return c;
  })(m.createConversation.bind(m));
  const ac = new AbortController();
  const trozos = [];
  const out = await L.chat([{ role: 'user', content: 'hola' }], SISTEMA, t => { trozos.push(t); ac.abort(); }, ac.signal);
  ok('varios textos en un mismo trozo: tras parar no sale ni uno más', trozos.length === 1 && out === 'uno', `${trozos.length} textos · ${JSON.stringify(out)}`);
}

// 1c. Lo que el modelo ya contestó e hizo sobrevive a la parada. Antes la
// conversación rehecha recibía SOLO los mensajes de usuario, todos juntos en uno:
// ni la llamada a la herramienta ni «Hecho: a.js…» llegaban al modelo.
{
  const m = motor(); L.__usarMotor(m, 4096);
  const h = [{ role: 'user', content: 'crea a.js con una suma' }];
  await L.chat(h, SISTEMA);
  h.push({ role: 'assistant', content: '```tool\n{"tool":"code.write","args":{"path":"a.js"}}\n```' });
  h.push({ role: 'user', content: '[resultado code.write]\nescrito a.js' });
  await L.chat(h, SISTEMA);
  h.push({ role: 'assistant', content: 'Hecho: a.js tiene una función suma.' });
  h.push({ role: 'user', content: 'explícame el código' });
  const ac = new AbortController();
  let n = 0;
  await L.chat(h, SISTEMA, () => { if (++n === 2) ac.abort(); }, ac.signal);
  h.push({ role: 'user', content: 'y ahora añade una resta' });
  await L.chat(h, SISTEMA);
  const nueva = m.conversaciones.at(-1);
  ok('tras parar, la conversación rehecha lleva la llamada a la herramienta y la respuesta de antes',
    m.conversaciones.length === 2 && nueva.sistema.includes('code.write') && nueva.sistema.includes('Hecho: a.js'),
    `${m.conversaciones.length} conversaciones · prefacio con code.write ${nueva.sistema.includes('code.write')} · con «Hecho» ${nueva.sistema.includes('Hecho: a.js')}`);
  ok('  …y la pregunta parada, pero no el trozo de respuesta parada',
    nueva.sistema.includes('explícame el código') && !nueva.sistema.includes('Una respuesta'));
  ok('  …y solo se le manda el mensaje nuevo', JSON.stringify(nueva.enviados) === '["y ahora añade una resta"]', JSON.stringify(nueva.enviados));
  ok('  …y la vieja se borra', m.conversaciones[0].borrada === true);
}

// 1d. Otra conversación (historial más corto que el de la parada): de cero, sin
// arrastrar nada.
{
  const m = motor(); L.__usarMotor(m, 4096);
  const h = [{ role: 'user', content: 'uno' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'dos' }];
  const ac = new AbortController();
  await L.chat(h, SISTEMA, () => ac.abort(), ac.signal);
  await L.chat([{ role: 'user', content: 'otra conversación' }], SISTEMA);
  const nueva = m.conversaciones.at(-1);
  ok('una conversación nueva tras parar empieza de cero', nueva.sistema === SISTEMA && JSON.stringify(nueva.enviados) === '["otra conversación"]',
    JSON.stringify(nueva.enviados));
}

// 2. Señal ya abortada: ni crea conversación ni manda nada.
{
  const m = motor(); L.__usarMotor(m, 4096);
  const ac = new AbortController(); ac.abort();
  const out = await L.chat([{ role: 'user', content: 'hola' }], SISTEMA, () => {}, ac.signal);
  ok('señal ya abortada: no toca el motor', out === '' && m.conversaciones.length === 0, `${m.conversaciones.length} conversaciones`);
}

// 3. Parar durante el prefill (aún no ha llegado ningún trozo): se cancela en
// LiteRT en vez de esperar a que lo procese entero.
{
  const m = motor(); L.__usarMotor(m, 4096);
  m.createConversation = (crear => async cfg => {
    const c = await crear(cfg);
    c.sendMessageStreaming = function (texto) {
      this.enviados.push(texto);
      const self = this;
      return (async function* () {
        await new Promise(r => { self.alCancelar = r; setTimeout(r, 3000); });
        if (self.cancelada) throw new Error('CANCELLED');   // como el flujo de verdad al cancelar
        self.prefillEntero = true;
        yield { content: [{ type: 'text', text: 'tarde' }] };
      })();
    };
    c.cancel = function () { this.cancelada = true; this.alCancelar?.(); };
    return c;
  })(m.createConversation.bind(m));
  const ac = new AbortController();
  const trozos = [];
  setTimeout(() => ac.abort(), 30);
  const out = await L.chat([{ role: 'user', content: 'un resultado enorme' }], SISTEMA, t => trozos.push(t), ac.signal);
  const c = m.conversaciones[0];
  ok('parar en el prefill llama a cancel() y no espera a que termine', c.cancelada === true && !c.prefillEntero,
    `cancelada ${c.cancelada} · prefill entero ${!!c.prefillEntero}`);
  ok('  …y devuelve lo generado (nada), sin trozos', out === '' && trozos.length === 0, `${JSON.stringify(out)} · ${trozos.length} trozos`);
}

// 3b. Parar mientras se crea la conversación: no se manda nada.
{
  const m = motor(); L.__usarMotor(m, 4096);
  const ac = new AbortController();
  m.createConversation = (crear => async cfg => { const c = await crear(cfg); ac.abort(); return c; })(m.createConversation.bind(m));
  const out = await L.chat([{ role: 'user', content: 'hola' }], SISTEMA, () => {}, ac.signal);
  ok('parado mientras se prepara la conversación: no se manda nada', out === '' && m.conversaciones[0]?.enviados.length === 0,
    JSON.stringify(m.conversaciones[0]?.enviados));
  await L.chat([{ role: 'user', content: 'hola' }], SISTEMA);
  ok('  …y esa conversación, intacta, se sigue usando', m.conversaciones.length === 1 && JSON.stringify(m.conversaciones[0].enviados) === '["hola"]',
    `${m.conversaciones.length} conversaciones · ${JSON.stringify(m.conversaciones[0].enviados)}`);
}

// 3c. El envío falla sin respuesta y la parada llega mientras se rehace
// compactada: el reintento no se manda.
{
  const m = motor(); L.__usarMotor(m, 4096);
  const ac = new AbortController();
  let creadas = 0;
  m.createConversation = (crear => async cfg => {
    const c = await crear(cfg);
    if (++creadas === 1) c.sendMessageStreaming = function (texto) { this.enviados.push(texto); return (async function* () { throw new Error('Too many tokens'); })(); };
    else ac.abort();   // la parada cae mientras se rehace la conversación
    return c;
  })(m.createConversation.bind(m));
  const out = await L.chat([{ role: 'user', content: 'algo grande' }], SISTEMA, () => {}, ac.signal);
  ok('parado mientras se rehace tras un fallo: el reintento no se manda', out === '' && m.conversaciones[1]?.enviados.length === 0,
    `${m.conversaciones.length} conversaciones · reintento ${JSON.stringify(m.conversaciones[1]?.enviados)}`);
}

// 4. Dos conversaciones con el mismo proveedor (las pestañas del chat lo
// comparten). Antes solo se miraba si el historial era más corto que lo ya
// enviado: el de otra pestaña, más LARGO, seguía dentro de la conversación de la
// primera. El modelo veía lo de la otra y no recibía lo anterior de esta.
{
  const m = motor(); L.__usarMotor(m, 4096);
  const A = [{ role: 'user', content: 'A1: el sueldo de Ana es 4.200' }];
  A.push({ role: 'assistant', content: await L.chat(A, SISTEMA) });
  A.push({ role: 'user', content: 'A2: y el de Luis 3.900' });
  A.push({ role: 'assistant', content: await L.chat(A, SISTEMA) });
  const B = [
    { role: 'user', content: 'B1: hola' }, { role: 'assistant', content: 'hola' },
    { role: 'user', content: 'B2: que tal' }, { role: 'assistant', content: 'bien' },
    { role: 'user', content: 'B3: resume lo que sabes' },
  ];
  await L.chat(B, SISTEMA);
  const deB = m.conversaciones.at(-1);
  ok('dos pestañas: la otra conversación, más larga, no sigue dentro de la primera',
    m.conversaciones.length === 2 && !deB.enviados.join('|').includes('A1') && !deB.sistema.includes('A1'),
    `${m.conversaciones.length} conversaciones · enviado ${JSON.stringify(deB.enviados)}`);
  ok('  …lo anterior de ESA conversación va en el prefacio y solo se manda lo nuevo',
    deB.sistema.includes('B1: hola') && deB.sistema.includes('B2: que tal') && JSON.stringify(deB.enviados) === '["B3: resume lo que sabes"]',
    JSON.stringify(deB.enviados));
  ok('  …y la de la primera se borra', m.conversaciones[0].borrada === true);
  A.push({ role: 'user', content: 'A3: ¿y el de Ana?' });
  await L.chat(A, SISTEMA);
  const deA = m.conversaciones.at(-1);
  ok('  al volver a la primera, se rehace desde SU historial, sin nada de la otra',
    m.conversaciones.length === 3 && deA.sistema.includes('A1: el sueldo de Ana') && deA.sistema.includes('A2: y el de Luis')
      && !deA.sistema.includes('B1') && JSON.stringify(deA.enviados) === '["A3: ¿y el de Ana?"]',
    JSON.stringify(deA.enviados));
}

// 4b. Lo mismo con el agente de verdad: dos Agent (dos pestañas) con este
// proveedor. El agente mete el estado vivo del IDE («CONTEXTO AHORA») antes del
// último mensaje en cada llamada; en la siguiente ya no está, y eso no puede
// contar como «otra conversación» (si contara, se rehará en cada turno).
{
  const m = motor(); L.__usarMotor(m, 4096);
  const { Agent, mensajeContexto } = await import(process.env.AGENT_JS ? 'file://' + process.env.AGENT_JS : '../web/js/agent.js');
  const vivo = mensajeContexto('Proyecto abierto: x', 'CONTEXTO AHORA:');
  ok('agente · el estado vivo va marcado efímero, y la marca no sale en el JSON de una API',
    vivo?.efimero === true && !JSON.stringify(vivo).includes('efimero'), JSON.stringify(vivo));
  const A = new Agent(L), B = new Agent(L);
  // B viene de antes (una conversación guardada que se vuelve a abrir)
  B.history = [
    { role: 'user', content: 'B1: el proyecto se llama Ballena' }, { role: 'assistant', content: 'Apuntado.' },
    { role: 'user', content: 'B2: usa tabuladores' }, { role: 'assistant', content: 'De acuerdo.' },
  ];
  const turno = (ag, texto) => ag.handle(texto, () => {});
  await turno(A, 'A1: el sueldo de Ana es 4.200');
  await turno(B, 'B3: ¿cómo se llama el proyecto?');
  const deB = m.conversaciones.at(-1);
  const enviadoB = deB.enviados.join('\n');
  ok('agente · el turno de la pestaña B no sigue dentro de la conversación de A',
    m.conversaciones.length === 2 && !enviadoB.includes('A1') && !deB.sistema.includes('A1'),
    `${m.conversaciones.length} conversaciones · enviado ${JSON.stringify(enviadoB.slice(0, 120))}`);
  ok('  …a B le llega lo suyo de antes (B1 y B2, en el prefacio) y su pregunta',
    deB.sistema.includes('B1: el proyecto se llama Ballena') && deB.sistema.includes('B2: usa tabuladores')
      && deB.enviados.length === 1 && enviadoB.includes('B3: ¿cómo se llama el proyecto?') && !enviadoB.includes('B1'),
    JSON.stringify(enviadoB.slice(0, 160)));
  await turno(B, 'B4: gracias');
  ok('  …y el turno siguiente de B sigue en SU conversación, con solo lo nuevo (el estado vivo no la rompe)',
    m.conversaciones.length === 2 && deB.enviados.length === 2 && deB.enviados[1].includes('B4: gracias') && !deB.enviados[1].includes('B3'),
    `${m.conversaciones.length} conversaciones · ${JSON.stringify(deB.enviados.map(t => t.slice(-30)))}`);
  await turno(A, 'A2: ¿y el sueldo de Ana?');
  const deA = m.conversaciones.at(-1);
  ok('  al volver a A: su conversación, rehecha con lo suyo y nada de B',
    m.conversaciones.length === 3 && deA.sistema.includes('A1: el sueldo de Ana') && !deA.sistema.includes('Ballena')
      && !deA.enviados.join('\n').includes('B'),
    JSON.stringify(deA.enviados.map(t => t.slice(-40))));
}

// 4c. Una respuesta que el modelo no dio aquí (el informe del cerebro CEO entra
// en el historial de la conversación por appendMessage) también hay que
// dársela: antes se saltaba como si fuera la suya y el modelo no la veía nunca.
{
  const m = motor(); L.__usarMotor(m, 4096);
  const h = [{ role: 'user', content: 'revisa el proyecto' }];
  h.push({ role: 'assistant', content: await L.chat(h, SISTEMA) });
  h.push({ role: 'assistant', content: 'Informe del cerebro: falta un test de suma.' });
  h.push({ role: 'user', content: '¿qué decía el informe?' });
  await L.chat(h, SISTEMA);
  const ultimaC = m.conversaciones.at(-1);
  ok('una respuesta que el modelo no dio (el informe) le llega, en el prefacio',
    m.conversaciones.length === 2 && ultimaC.sistema.includes('Informe del cerebro') && JSON.stringify(ultimaC.enviados) === '["¿qué decía el informe?"]',
    `${m.conversaciones.length} conversaciones · ${JSON.stringify(ultimaC.enviados)}`);
}

console.log(fallos ? `\n❌ ${fallos} FALLO(S)` : '\n✅ LITERT OK — parar no deja una respuesta a medias dentro de la conversación, y cada conversación es la suya');
process.exit(fallos ? 1 : 0);

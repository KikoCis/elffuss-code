// LiteRT y parar a media respuesta.
// ─────────────────────────────────────────────────────────────────────────────
// La conversación de LiteRT guarda su propio KV y aquí solo se le manda lo
// nuevo. Al parar a mitad, el trozo de respuesta ya generado se queda DENTRO de
// esa conversación, pero el agente no lo apunta en su historial (un turno parado
// no deja respuesta). Si el turno siguiente seguía con la misma conversación, el
// modelo «recordaba» una respuesta a medias que el usuario nunca vio terminar.
// Ahora, al parar, la conversación se tira y la próxima llamada la rehace desde
// el historial.
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
  ok('  …la rehace desde el historial (le llegan las dos preguntas)',
    m.conversaciones[1]?.enviados.at(-1)?.includes('primera pregunta') && m.conversaciones[1]?.enviados.at(-1)?.includes('segunda pregunta'),
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

// 2. Señal ya abortada: ni crea conversación ni manda nada.
{
  const m = motor(); L.__usarMotor(m, 4096);
  const ac = new AbortController(); ac.abort();
  const out = await L.chat([{ role: 'user', content: 'hola' }], SISTEMA, () => {}, ac.signal);
  ok('señal ya abortada: no toca el motor', out === '' && m.conversaciones.length === 0, `${m.conversaciones.length} conversaciones`);
}

console.log(fallos ? `\n❌ ${fallos} FALLO(S)` : '\n✅ LITERT OK — parar no deja una respuesta a medias dentro de la conversación');
process.exit(fallos ? 1 : 0);

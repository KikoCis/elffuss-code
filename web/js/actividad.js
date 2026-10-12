// Bus de actividad de las herramientas: cada llamada que hace la elfa se anuncia
// al empezar y al acabar. Lo escuchan la vista de ciudad (para encender los
// ficheros que toca) y el registro de su pila, sin que ninguno conozca al otro.
//
// Un listener que lanza NO tumba la herramienta: si la vista está rota, el
// agente sigue trabajando. Mirar no debe cambiar lo que se hace.

const oyentes = new Set();

export function escuchar(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

export function anunciar(evento) {
  for (const fn of [...oyentes]) {
    try { fn(evento); } catch { /* un oyente roto no para a la elfa */ }
  }
}

// Qué fichero toca una llamada y de qué manera. Solo lectura o escritura: la
// ciudad pinta «lee» y «escribe» distinto, y `terminal.run` no toca rutas.
const ESCRIBE = new Set(['code.write', 'code.edit']);
const LEE = new Set(['code.read', 'code.tree', 'code.search', 'code.run']);

export function tocaFichero(herramienta, args) {
  if (!args || typeof args.path !== 'string') return null;
  if (ESCRIBE.has(herramienta)) return { ruta: args.path, modo: 'escribe' };
  if (LEE.has(herramienta)) return { ruta: args.path, modo: 'lee' };
  return null;
}

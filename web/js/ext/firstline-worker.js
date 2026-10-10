// Las firstLine de los paquetes, fuera del hilo de la página: si una
// expresión no termina, host.js corta este Worker por tiempo y la pestaña
// sigue viva. Avisa ANTES de probar cada expresión: así el tiempo cuenta desde
// ahí (no desde la carga del Worker) y se sabe cuál fue la que se atascó.
import { matchFirstLine } from './languages.js';

self.onmessage = ({ data: { id, candidates, line } }) => {
  for (let i = 0; i < candidates.length; i++) {
    self.postMessage({ id, trying: i });
    if (matchFirstLine([candidates[i]], line)) { self.postMessage({ id, lang: candidates[i].id }); return; }
  }
  self.postMessage({ id, lang: null });
};

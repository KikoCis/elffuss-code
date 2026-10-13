// El iframe del recinto y el apretón de manos. La página solo acepta del
// iframe dos mensajes por window.postMessage («hello» y «fatal»), con origen
// y fuente exactos; a partir de ahí todo va por un MessagePort que crea la
// página. Un segundo «load» del iframe (el recinto navegó) lo desmonta.
import { SANDBOX_DOC } from './config.js';

const fallo = (code, msg) => Object.assign(new Error(msg), { code });

export function openSandbox(origin, { timeout = 20000, onLost = () => {} } = {}) {
  const iframe = document.createElement('iframe');
  iframe.id = 'x2-sandbox';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  iframe.setAttribute('allow', '');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('title', 'Extension sandbox');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.inert = true;
  // dentro de la ventana (un iframe de otro origen fuera de ella o de tamaño
  // cero se ralentiza), pero invisible y sin recibir nada
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;pointer-events:none;z-index:-1';
  iframe.src = origin + SANDBOX_DOC;

  let cargas = 0, listo = false, cerrado = false, onMsg = null;
  const quitar = () => {
    cerrado = true;
    if (onMsg) window.removeEventListener('message', onMsg);
    iframe.remove();
  };
  const promesa = new Promise((resolve, reject) => {
    const reloj = setTimeout(() => { quitar(); reject(fallo('timeout', 'el recinto de extensiones no contestó')); }, timeout);
    iframe.addEventListener('load', () => {
      if (++cargas > 1 && !cerrado) {
        quitar();
        if (listo) onLost(fallo('navigated', 'el recinto de extensiones se recargó solo'));
        else { clearTimeout(reloj); reject(fallo('navigated', 'el recinto de extensiones se recargó solo')); }
      }
    });
    onMsg = e => {
      if (e.source !== iframe.contentWindow || e.origin !== origin) return;
      const d = e.data;
      if (!d || typeof d !== 'object' || listo) return;
      if (d.x2 === 'fatal') {
        clearTimeout(reloj); quitar();
        reject(fallo(d.reason === 'csp' ? 'csp' : 'fatal', d.reason === 'csp'
          ? 'el recinto se negó a arrancar: su política de seguridad no bloquea la red'
          : 'el recinto de extensiones falló al arrancar'));
        return;
      }
      if (d.x2 !== 'hello' || d.v !== 1) return;
      listo = true;
      clearTimeout(reloj);
      window.removeEventListener('message', onMsg);
      onMsg = null;
      const canal = new MessageChannel();
      iframe.contentWindow.postMessage({ x2: 'init' }, origin, [canal.port2]);
      resolve({ port: canal.port1, iframe, close: () => { canal.port1.close(); quitar(); } });
    };
    window.addEventListener('message', onMsg);
  });
  document.body.appendChild(iframe);
  return promesa;
}

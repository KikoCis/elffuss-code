// El service worker (web/sw.js) al pulsar una notificación, en Node: se carga
// en una sandbox con self, clients y caches de mentira y se le dispara el
// evento `notificationclick`.
//
//   1. «▶ Ejecutar» con la app cerrada: guarda la propuesta en Cache Storage y
//      abre el IDE con su id en la URL (antes abría ?notif=execute sin la
//      propuesta, y no se ejecutaba nada).
//   2. Con el IDE abierto: le manda la propuesta a esa ventana, sin abrir otra.
//   3. Con solo el Lab abierto: el Lab no es el IDE, se abre el IDE.
//   4. «Ver»: abre el IDE para ver la Mente, sin guardar nada.
//
//   node tests/sw-notif.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const SW = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'sw.js'), 'utf8');
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

function sandbox(ventanas = []) {
  const handlers = {};
  const guardado = new Map();
  const abiertas = [];
  const self = {
    addEventListener: (tipo, fn) => { handlers[tipo] = fn; },
    skipWaiting() {}, clients: {
      async matchAll() { return ventanas; },
      async openWindow(u) { abiertas.push(u); return {}; },
      claim() {},
    },
  };
  const caches = { async open(nombre) { return { async put(k, r) { guardado.set(nombre + '|' + k, await r.text()); } }; }, async delete() {} };
  const ctx = vm.createContext({ self, caches, Response: globalThis.Response, URL, console });
  vm.runInContext(SW, ctx);
  const clic = async (action, data) => {
    let espera = null;
    handlers.notificationclick({ action, notification: { data, close() {} }, waitUntil(p) { espera = p; } });
    await espera;
  };
  return { clic, guardado, abiertas };
}
const ventana = url => { const v = { url, mensajes: [], enfocada: false, postMessage(m) { v.mensajes.push(m); }, focus() { v.enfocada = true; } }; return v; };

// 1 · ▶ Ejecutar con la app cerrada
{
  const s = sandbox([]);
  await s.clic('execute', { md: '# Propuesta\nhaz pruebas' });
  const url = s.abiertas[0] || '';
  const id = (/[?&]id=([a-z0-9]+)/.exec(url) || [])[1];
  ok('1 · ▶ Ejecutar con la app cerrada abre el IDE con la acción y un id', /^\.\/\?notif=execute&id=[a-z0-9]+$/.test(url), url);
  ok('1 · …y la propuesta queda guardada bajo ese id', s.guardado.get('elffuss-notif|./notif/' + id) === '# Propuesta\nhaz pruebas', JSON.stringify([...s.guardado]));
  ok('1 · …y no va en la URL', !/Propuesta|pruebas/.test(url), url);
}
// 2 · con el IDE abierto
{
  const ide = ventana('https://code.example/?x');
  const s = sandbox([ide]);
  await s.clic('execute', { md: '# P' });
  ok('2 · con el IDE abierto le manda la propuesta a esa ventana y la enfoca', ide.mensajes[0]?.type === 'notif-action' && ide.mensajes[0]?.md === '# P' && ide.enfocada, JSON.stringify(ide.mensajes));
  ok('2 · …sin abrir otra ni guardar nada', s.abiertas.length === 0 && s.guardado.size === 0, JSON.stringify(s.abiertas));
}
// 3 · solo el Lab abierto
{
  const lab = ventana('https://code.example/lab.html');
  const s = sandbox([lab]);
  await s.clic('execute', { md: '# P' });
  ok('3 · con solo el Lab abierto, abre el IDE (el Lab no lo ejecutaría)', lab.mensajes.length === 0 && /^\.\/\?notif=execute&id=/.test(s.abiertas[0] || ''), JSON.stringify(s.abiertas));
}
// 4 · Ver
{
  const s = sandbox([]);
  await s.clic('open', { md: '# P' });
  ok('4 · «Ver» abre el IDE para la Mente y no guarda nada', s.abiertas[0] === './?notif=open' && s.guardado.size === 0, JSON.stringify(s.abiertas));
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ NOTIFICACIONES: ▶ Ejecutar llega con la propuesta, también con la app cerrada');
process.exit(fails ? 1 : 0);

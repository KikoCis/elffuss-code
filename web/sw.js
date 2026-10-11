// Service worker INERTE (a propósito).
//
// Antes cacheaba ficheros de modelo interceptando las peticiones a HuggingFace,
// pero eso ROMPÍA la carga del ONNX: el fichero de pesos externos
// `model_q4.onnx_data` fallaba con ERR_FAILED al re-fetchearlo → el modelo no
// cargaba. Resultó que el SW era INNECESARIO: el cacheo ya lo hacen
//   - transformers.js con su propia Cache Storage (modelo ONNX «healed»), y
//   - litert.js con blob cache-first en Cache Storage (Gemma .litertlm),
// y `navigator.storage.persist()` evita que el navegador los desaloje.
//
// Así que este SW ya NO intercepta nada (el navegador gestiona todas las
// peticiones de forma nativa). Se mantiene registrado solo para REEMPLAZAR
// limpiamente al SW anterior que sí interceptaba y rompía la carga.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Permite vaciar la caché de modelos desde Ajustes (sin tocar el blob de Gemma
// salvo que se pida). NO hay handler de 'fetch' → cero interceptación.
self.addEventListener('message', e => {
  if (e.data === 'clear-models') {
    caches.delete('elffuss-models-v1').then(() => e.source && e.source.postMessage('models-cleared'));
  }
});

// Botón «▶ Ejecutar» en la notificación de mejoras del cerebro CEO: las
// notificaciones normales (new Notification()) no soportan acciones, las que
// pasan por el SW (registration.showNotification) sí. Al pulsar, avisamos a
// la pestaña (postMessage) para que mande la propuesta a la cola real.
//
// A la ventana del IDE, no a la primera que haya: con el Lab abierto (lab.html)
// el aviso podía irse a él y perderse. Y si no hay ninguna ventana abierta, se
// abre el IDE con la acción en la URL (?notif=…) para que la Mente aparezca en
// cuanto el proyecto esté abierto; antes se abría «/» y la propuesta se perdía.
self.addEventListener('notificationclick', event => {
  const action = event.action; // 'execute' | 'open' | '' (clic en el cuerpo)
  const data = event.notification.data || {};
  event.notification.close();
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const esIDE = c => { try { const u = new URL(c.url); return !/\/lab\.html$/.test(u.pathname); } catch { return false; } };
    const client = clientsList.find(esIDE);
    if (client) {
      client.postMessage({ type: 'notif-action', action, md: data.md });
      client.focus?.();
    } else if (self.clients.openWindow) {
      let q = 'notif=' + (action === 'execute' ? 'execute' : 'open');
      // «▶ Ejecutar» con la app cerrada: la propuesta viaja guardada en Cache
      // Storage (la ven este SW y la página) y la URL lleva solo su id. Antes la
      // ventana nueva recibía la acción sin la propuesta: abría la Mente y no
      // ejecutaba nada, sin decirlo. En la URL entera no va: quedaría en el
      // historial del navegador.
      if (action === 'execute' && data.md) {
        try {
          const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          await (await caches.open(NOTIF_CACHE)).put('./notif/' + id, new Response(String(data.md)));
          q += '&id=' + id;
        } catch { /* sin guardarla: la página lo dice y abre la Mente */ }
      }
      await self.clients.openWindow('./?' + q);
    }
  })());
});
const NOTIF_CACHE = 'elffuss-notif';

// ── Manejador de `fetch`, añadido para poder INSTALAR el sitio ──────────────
// Chrome solo ofrece instalar si hay manifiesto Y un service worker con
// manejador de `fetch`. Y la instalación no es cosmética: es lo único que
// consigue que conceda almacenamiento PERSISTENTE —medido: sin ella
// `navigator.storage.persist()` devuelve false— y sin persistencia el navegador
// desaloja los gigas del modelo cuando le falta disco, que es lo que pasó.
//
// NO intercepta: no llama a `respondWith`, así que cada petición sigue su curso
// normal por la red. Eso importa aquí más que en otros sitios — la cabecera de
// este fichero cuenta que un SW que SÍ interceptaba rompió la carga del ONNX,
// y no se trata de repetirlo por querer un botón de instalar.
self.addEventListener('fetch', () => { /* a la red, sin tocar nada */ });

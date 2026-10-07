// Qué broker pide cada modelo. Corre en node, sin navegador: un DOM de mentira
// donde solo los orígenes que sirven la página del broker (models, m1, m2… de
// elffuss.com o del dominio anterior) contestan «elffuss-broker-ready».
// Es la misma comprobación que tests/broker-origenes.mjs de Elffuss Claw, sin
// las páginas del broker ni el canal del Translator, que aquí no están.
let fallos = 0;
const ok = (nombre, cond, extra = '') => {
  console.log(`${cond ? '✅' : '❌'} ${nombre}${extra ? '  — ' + extra : ''}`);
  if (!cond) fallos++;
};

const bus = new EventTarget();
globalThis.addEventListener = (t, h) => bus.addEventListener(t, h);
globalThis.removeEventListener = (t, h) => bus.removeEventListener(t, h);
const entregar = (data, source) => bus.dispatchEvent(Object.assign(new Event('message'), { data, source }));
const SIRVE_BROKER = /^https:\/\/(models|m\d+)\.elffuss\.(com|utopiaia\.com)\/$/;
const iframes = [];
const RESPUESTA = {
  'elffuss-model-get': () => ({ kind: 'file', file: { size: 42 } }),
  'elffuss-model-has': () => ({ kind: 'has', cached: true, size: 42 }),
  'elffuss-broker-diag': () => ({ kind: 'diag', usado: 7200, quota: 20000 }),
  'elffuss-model-clear': () => ({ kind: 'cleared', liberado: 7200, restante: 0 }),
};
globalThis.document = {
  createElement() {
    const el = { src: '', style: {}, enviados: [], setAttribute() {}, addEventListener() {} };
    el.contentWindow = {
      postMessage(msg, destino) {
        el.enviados.push({ msg, destino });
        if (destino !== new URL(el.src).origin) return;
        const r = RESPUESTA[msg.type]?.();
        if (r) setTimeout(() => entregar({ id: msg.id, ...r }, el.contentWindow), 0);
      },
    };
    return el;
  },
  body: {
    appendChild(el) {
      iframes.push(el);
      if (SIRVE_BROKER.test(el.src)) setTimeout(() => entregar({ kind: 'elffuss-broker-ready' }, el.contentWindow), 0);
    },
  },
};
const sesion = new Map();
globalThis.sessionStorage = { getItem: k => sesion.get(k) ?? null, setItem: (k, v) => sesion.set(k, String(v)) };
const embebidos = () => iframes.map(f => f.src);

const mb = await import('../web/js/runtime/model-broker.js');
const BROKER = 'https://models.elffuss.com/';
ok('el broker por defecto es models.elffuss.com', mb.BROKER_URL === BROKER, mb.BROKER_URL);

// Un modelo de Hugging Face (los de litert.js lo son) va al broker compartido:
// ni embebe huggingface.co ni se come el timeout de 8 s.
{
  const store = await import('../web/js/runtime/model-store.js');
  const t0 = Date.now();
  const f = await Promise.race([
    store.getModelFile('https://huggingface.co/litert-community/x/resolve/main/m.litertlm'),
    new Promise(r => setTimeout(() => r('timeout'), 3000)),
  ]);
  ok('getModelFile(Hugging Face) sale del broker compartido', f?.size === 42,
    `${typeof f === 'string' ? f : 'ok'} en ${Date.now() - t0} ms`);
  ok('  y no embebe huggingface.co', !embebidos().some(s => s.includes('huggingface.co')), embebidos().join(' '));
  const enviado = iframes.find(x => x.src === BROKER)?.enviados.at(-1);
  ok('  la petición va con models.elffuss.com como destino', enviado?.destino === 'https://models.elffuss.com', enviado?.destino);
  ok('  y el broker no queda marcado como caído', sesion.get('elffuss.broker.down') !== '1');
}

if (typeof mb.brokerFor !== 'function') {
  console.log('— brokerFor() no está en este árbol (un solo broker para todo): se salta');
} else {
  // El origen del propio fichero solo cuando sirve la página del broker. Una web
  // de la app (claw, code, git…) no la sirve: embeberla sería esperar 8 s para
  // nada y dar el broker por caído el resto de la sesión.
  const CASOS = [
    ['https://huggingface.co/litert-community/x/resolve/main/m.litertlm', BROKER],
    ['https://m1.elffuss.com/bonsai-27b.p0', 'https://m1.elffuss.com/'],
    ['https://m2.elffuss.utopiaia.com/bonsai-27b.p1', 'https://m2.elffuss.utopiaia.com/'],
    ['https://models.elffuss.com/x.onnx', BROKER],
    ['https://code.elffuss.com/__e4b.litertlm', BROKER],
    ['https://claw.elffuss.com/models/qwen38-27b.gguf', BROKER],
    ['https://git.elffuss.com/a/b/raw/main/m.gguf', BROKER],
    ['https://key.elffuss.utopiaia.com/m.gguf', BROKER],
    ['http://m1.elffuss.com/x', BROKER],
    ['https://m1.elffuss.com.evil.net/x', BROKER],
  ];
  for (const [url, esperado] of CASOS) {
    const r = mb.brokerFor(url);
    ok(`brokerFor(${new URL(url).origin})`, r === esperado, r);
  }
  let lanzo = false;
  try { mb.brokerFor('models/x.gguf'); } catch { lanzo = true; }
  ok('una URL relativa lanza en vez de ir a un broker que la resolvería mal', lanzo);

  const f = await mb.getSharedModel('https://m1.elffuss.com/bonsai-27b.p0');
  ok('un fragmento de m1 lo guarda el broker de m1', f?.size === 42 && embebidos().includes('https://m1.elffuss.com/'));
}

// Esto vale con un broker o con uno por origen: un modelo servido desde una web
// de la app (o desde git.*) nunca hace de broker.
for (const url of ['https://code.elffuss.com/__e4b.litertlm', 'https://git.elffuss.com/a/b/raw/main/m.gguf']) {
  const t0 = Date.now();
  const g = await Promise.race([
    mb.getSharedModel(url),
    new Promise(r => setTimeout(() => r('timeout'), 3000)),
  ]);
  const o = new URL(url).origin;
  ok(`un modelo servido desde ${o} sale del compartido, sin esperar`, g?.size === 42,
    `${typeof g === 'string' ? g : 'ok'} en ${Date.now() - t0} ms`);
  ok('  y no embebe ese origen como broker', !embebidos().includes(o + '/'), embebidos().join(' '));
}

if (typeof mb.sharedUsage !== 'function' || typeof mb.clearShared !== 'function') {
  console.log('— sharedUsage()/clearShared() no están en este árbol: se saltan');
} else {
  const uso = await mb.sharedUsage().catch(e => ({ error: e.message }));
  ok('sharedUsage() devuelve lo que dice el broker', uso.ok === true && uso.usage === 7200 && uso.quota === 20000, JSON.stringify(uso));
  const vac = await mb.clearShared().catch(e => ({ error: e.message }));
  ok('clearShared() devuelve lo liberado', vac.ok === true && vac.liberado === 7200, JSON.stringify(vac));
}

console.log(fallos ? `\n❌ ${fallos} fallo(s)` : '\n✅ brokers OK');
process.exit(fallos ? 1 : 0);

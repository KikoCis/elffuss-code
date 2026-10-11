// ¿El agente REINTENTA tras un error en vez de rendirse?
// Proveedor de guion: 1ª vez pide code.read de un fichero que no existe (falla);
// 2ª vez, viendo el ERROR + la pista en el historial, corrige y lee el bueno.
import { chromium } from 'playwright';
const b = await chromium.launch({ channel: 'chrome', headless: true });
// Modo Básico: esta prueba pone su propio proveedor y no necesita modelo. Sin
// esto, al abrir la página main.js se pone a cargar el modelo local por defecto
// (con GPU, Gemma; sin ella, el ONNX ligero) mientras la prueba corre.
const ctxPrueba = await b.newContext();
await ctxPrueba.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctxPrueba.newPage();
// Por defecto contra producción, como siempre; BASE=… la corre contra otro
// servidor (un árbol local), que es lo que hace falta antes de desplegar.
await p.goto((process.env.BASE || 'https://code.elffuss.com') + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
const r = await p.evaluate(async () => {
  const { Agent } = await import('/js/agent.js?v=' + Date.now());
  const code = await import('/js/tools/code.js');
  const raiz = await navigator.storage.getDirectory();
  for await (const [n] of raiz.entries()) await raiz.removeEntry(n, { recursive: true }).catch(()=>{});
  const w = await (await raiz.getFileHandle('bueno.js', { create: true })).createWritable();
  await w.write('export const x = 42;'); await w.close();
  await code.openProject(raiz);
  // proveedor: falla la 1ª, y si ve ERROR en el historial reintenta con el bueno
  let llamadas = 0; const vistos = [];
  const guion = { chat: async (history) => {
    llamadas++;
    const huboError = history.some(m => /ERROR|Reanaliza/.test(m.content || ''));
    vistos.push(huboError ? 'vio-error' : 'primera');
    if (!huboError) return '```tool\n{"tool":"code.read","args":{"path":"noexiste.js"}}\n```';
    if (llamadas <= 3) return '```tool\n{"tool":"code.read","args":{"path":"bueno.js"}}\n```';
    return 'Ya está, leído bueno.js.';
  }};
  const ev = [];
  await new Agent(guion).handle('lee el fichero', e => ev.push(e.type + (e.tool ? ':' + e.tool : '')));
  return { llamadas, vistos, tipos: [...new Set(ev)], reintentó: vistos.includes('vio-error') };
});
console.log('  llamadas al modelo:', r.llamadas, '·', r.vistos.join(' → '));
console.log('  eventos:', r.tipos.join(', '));
console.log(r.reintentó ? '\n✅ reintenta: tras el ERROR, el modelo recibe la pista y corrige (no se rinde)'
                        : '\n❌ no reintentó');
await b.close();
process.exit(r.reintentó ? 0 : 1);

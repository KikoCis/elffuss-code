// Guardia: sin WebGPU, el ONNX ligero NO se ofrece en ningún sitio.
// ─────────────────────────────────────────────────────────────────────────────
// Bug reportado desde la consola de producción: `GatherBlockQuantized … 
// CPUExecutionProvider`. En un navegador sin WebGPU, el modelo por defecto
// (Qwen3.5-0.8B) se cargaba en wasm, el backend de CPU no tiene kernel para ese
// operador, y el usuario se comía ~600 MB de descarga para acabar en modo
// básico. Lo peor: `pickLocalBrain()` y la vieja `defaultBrain()` elegían ESE
// modelo precisamente en la rama SIN GPU.
//
// Y no hay variante que lo salve: su dtype es q4f16 (sin kernel en CPU) y `q4`
// peta con bad_alloc en este modelo, según el propio comentario de
// model-config.js. O sea que NINGÚN dtype funciona sin GPU, así que la única
// salida honesta es no ofrecerlo — decisión de Kiko el 2026-10-12.
//
// Se comprueba con el DOM y no con la función, porque lo que importa es lo que
// el usuario PUEDE elegir. Y en los dos sentidos: con GPU tiene que seguir
// apareciendo, o este guardia estaría «pasando» por haber roto el caso bueno.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8790';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const b = await chromium.launch();

// Lee lo que el panel de Ajustes ofrece como cerebros locales.
async function ofrecidos({ sinGpu }) {
  const ctx = await b.newContext();
  if (sinGpu) {
    // Se quita navigator.gpu ENTERO: es el caso de un navegador que no lo trae.
    await ctx.addInitScript(() => {
      try { Object.defineProperty(navigator, 'gpu', { get: () => undefined, configurable: true }); } catch {}
    });
  }
  const p = await ctx.newPage();
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1800);
  const r = await p.evaluate(async () => {
    const abrir = document.querySelector('[data-panel="settings"], #act-settings, .act-settings');
    if (abrir) abrir.click();
    await new Promise((x) => setTimeout(x, 700));
    const tarjetas = [...document.querySelectorAll('.model-grid [data-id], .model-grid button')]
      .map((n) => n.dataset?.id || n.textContent.trim()).filter(Boolean);
    const nota = document.querySelector('.sk-nota[role="note"]')?.textContent || '';
    return { tarjetas, nota, gpu: !!navigator.gpu };
  });
  await ctx.close();
  return r;
}

const sin = await ofrecidos({ sinGpu: true });
ok('⊕ control: el navegador de prueba de verdad NO tiene navigator.gpu', sin.gpu === false, `gpu=${sin.gpu}`);
const mencionaOnnx = (xs) => xs.some((x) => /onnx:qwen3\.5-0\.8b|Qwen3\.5-0\.8B/.test(x));
ok('sin WebGPU, el ONNX ligero NO se ofrece', !mencionaOnnx(sin.tarjetas),
   sin.tarjetas.join(' · ').slice(0, 120) || 'ninguna tarjeta');
ok('…y se DICE por qué, en vez de dejar la lista casi vacía sin explicación',
   /WebGPU/.test(sin.nota), sin.nota.slice(0, 90) || 'sin nota');

const con = await ofrecidos({ sinGpu: false });
ok('⊕ control del caso bueno: con navigator.gpu presente sigue habiendo API', con.gpu === true, `gpu=${con.gpu}`);
// Ojo: el chromium del arnés puede no dar ADAPTADOR real aunque exista la API, y
// entonces el modelo tampoco debe ofrecerse — eso es correcto, no un fallo. Lo
// que este caso comprueba es que la nota NO sale cuando hay adaptador.
ok('con adaptador real, ni se oculta el modelo ni sale la nota; sin adaptador, las dos cosas van juntas',
   mencionaOnnx(con.tarjetas) !== /WebGPU/.test(con.nota),
   `ofrecido=${mencionaOnnx(con.tarjetas)} nota=${/WebGPU/.test(con.nota)}`);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ sin WebGPU no se ofrece lo que sin WebGPU no funciona');
await b.close(); process.exit(fails ? 1 : 0);

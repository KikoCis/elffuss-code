// Play/stop del cerebro CEO dentro de la Mente: pausa/reanuda, y la elección
// sobrevive a recargar la página de verdad (antes no había forma de pararlo
// desde la Mente, y nada se persistía salvo el "encendido" desde la elfa).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext(); await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

// clic en la elfa activa el cerebro (comportamiento ya existente)
await p.locator('#activity img').click(); await p.waitForTimeout(1000);
ok('al entrar por primera vez, el botón dice "pausar" (el cerebro quedó activo)', /pausar/.test(await p.locator('#mind-playstop').innerText()));
const en1 = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('ceo.isEnabled() es true tras el primer clic en la elfa', en1);

// pausar desde la Mente
await p.click('#mind-playstop'); await p.waitForTimeout(200);
ok('tras pulsar, el botón pasa a "reanudar" (pausado)', /reanudar/.test(await p.locator('#mind-playstop').innerText()));
ok('el botón se ve marcado como pausado (estilo distinto)', await p.locator('#mind-playstop').evaluate(el => el.classList.contains('paused')));
const en2 = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('ceo.isEnabled() es false tras pausar', !en2);

// RECARGA REAL: la elección (pausado) debe sobrevivir
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
const enAfterReload = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('tras recargar, sigue PAUSADO (la elección se guardó)', !enAfterReload);

// reabrir la Mente NO debe reactivarlo por sorpresa (lo pausaste a propósito)
await p.locator('#activity img').click(); await p.waitForTimeout(1000);
ok('al reabrir la Mente tras una pausa explícita, SIGUE pausado (no se pisa la elección)', /reanudar/.test(await p.locator('#mind-playstop').innerText()));
const stillPaused = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('ceo.isEnabled() confirma que reabrir la Mente no lo reactivó', !stillPaused);

// reanudarlo EXPLÍCITAMENTE con el play/stop, y comprobar que ESO persiste
await p.click('#mind-playstop'); await p.waitForTimeout(200);
ok('reanudado a propósito desde la Mente, el botón dice "pausar"', /pausar/.test(await p.locator('#mind-playstop').innerText()));
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);
const enAfterReload2 = await p.evaluate(async () => (await import('/js/ceo.js')).isEnabled());
ok('tras recargar de nuevo, sigue ACTIVO (también se guardó al reanudar)', enAfterReload2);

// PAUSAR A MITAD DE CICLO. Antes «pausar» solo apagaba la bandera: el ciclo en
// curso seguía generando por detrás, escribía su propuesta igual, y «Pensar
// ahora» podía arrancar un segundo ciclo encima (dos generate() contra el mismo
// modelo). Con un modelo de mentira, lento y que respeta la señal:
//   - pausar corta el ciclo (el modelo recibe la parada y no hay más llamadas),
//   - no se escribe ninguna propuesta,
//   - y forceCycle() devuelve false mientras el ciclo parado se desmonta.
await p.locator('#activity img').click(); await p.waitForTimeout(800);
const mid = await p.evaluate(async () => {
  const ceo = await import('/js/ceo.js');
  const conv = await import('/js/conversations.js');
  const st = { llamadas: 0, abortadas: 0, terminadas: 0, trasPausa: 0 };
  let pausado = false;
  const lento = {
    name: 'lento',
    chat: async (h, s, cb, signal) => {
      st.llamadas++; if (pausado) st.trasPausa++;
      for (let i = 0; i < 60; i++) {
        if (signal?.aborted) { st.abortadas++; throw new DOMException('Parado', 'AbortError'); }
        cb('·'); await new Promise(r => setTimeout(r, 50));
      }
      st.terminadas++;
      return 'Propuesta: dividir el módulo grande en dos ficheros con responsabilidades claras.';
    },
  };
  const antes = conv.getProvider();
  conv.setProvider(lento);
  const soulFiles = async () => {
    try {
      let d = await navigator.storage.getDirectory();
      for (const seg of ceo.getSoulDir().split('/')) d = await d.getDirectoryHandle(seg);
      const n = []; for await (const e of d.values()) if (e.kind === 'file' && e.name.endsWith('.md')) n.push(e.name);
      return n;
    } catch { return []; }
  };
  const ficherosAntes = (await soulFiles()).length;
  const primero = ceo.forceCycle();
  for (let i = 0; i < 100 && st.llamadas === 0; i++) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 300));       // el ciclo ya está generando
  const enMarcha = ceo.isRunning();
  // El botón de la Mente (onclick → ceo.disable()) y, en el MISMO instante,
  // «Pensar ahora»: el ciclo parado aún no ha terminado de soltarse.
  pausado = true;
  document.getElementById('mind-playstop').click();
  const segundo = await ceo.forceCycle();
  const resPrimero = await Promise.race([primero, new Promise(r => setTimeout(() => r('SIGUE'), 8000))]);
  await new Promise(r => setTimeout(r, 400));
  const out = { ...st, enMarcha, segundo, resPrimero, sigueCorriendo: ceo.isRunning(), habilitado: ceo.isEnabled(),
    nuevos: (await soulFiles()).length - ficherosAntes };
  conv.setProvider(antes);
  return out;
});
ok('el ciclo estaba en marcha con el modelo lento', mid.enMarcha && mid.llamadas >= 1, `${mid.llamadas} llamadas`);
ok('pausar a mitad corta el ciclo: el modelo recibe la parada', mid.abortadas === mid.llamadas && mid.terminadas === 0,
  `${mid.abortadas} de ${mid.llamadas} abortadas, ${mid.terminadas} terminadas`);
ok('  …y no se le vuelve a llamar después de pausar', mid.trasPausa === 0, `${mid.trasPausa} llamadas tras la pausa`);
ok('forceCycle() devuelve false mientras el ciclo parado se desmonta (no hay dos a la vez)', mid.segundo === false, String(mid.segundo));
ok('el ciclo parado termina de verdad (isRunning() vuelve a false)', mid.resPrimero !== 'SIGUE' && mid.sigueCorriendo === false,
  `forceCycle → ${mid.resPrimero}, isRunning ${mid.sigueCorriendo}`);
ok('no se escribe ninguna propuesta', mid.nuevos === 0, `${mid.nuevos} ficheros nuevos en la carpeta-alma`);
ok('el cerebro queda en pausa', mid.habilitado === false);

// VOLVER A USAR LA APP a mitad de ciclo (una tecla fuera de la Mente →
// noteActivity()) corta el ciclo igual que pausar, sin escribir nada.
const act = await p.evaluate(async () => {
  const ceo = await import('/js/ceo.js');
  const conv = await import('/js/conversations.js');
  const st = { llamadas: 0, abortadas: 0, terminadas: 0 };
  const lento = { name: 'lento', chat: async (h, s, cb, signal) => {
    st.llamadas++;
    for (let i = 0; i < 60; i++) {
      if (signal?.aborted) { st.abortadas++; throw new DOMException('Parado', 'AbortError'); }
      cb('·'); await new Promise(r => setTimeout(r, 50));
    }
    st.terminadas++;
    return 'Propuesta: documentar la API pública con ejemplos de uso reales.';
  } };
  const antes = conv.getProvider();
  conv.setProvider(lento);
  const contar = async () => { try { let d = await navigator.storage.getDirectory(); for (const seg of ceo.getSoulDir().split('/')) d = await d.getDirectoryHandle(seg); let n = 0; for await (const e of d.values()) if (e.name.endsWith('.md')) n++; return n; } catch { return 0; } };
  const ficherosAntes = await contar();
  const primero = ceo.forceCycle();
  for (let i = 0; i < 100 && st.llamadas === 0; i++) await new Promise(r => setTimeout(r, 20));
  await new Promise(r => setTimeout(r, 300));
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  const segundo = await ceo.forceCycle();
  await Promise.race([primero, new Promise(r => setTimeout(r, 8000))]);
  await new Promise(r => setTimeout(r, 300));
  const out = { ...st, segundo, corriendo: ceo.isRunning(), nuevos: (await contar()) - ficherosAntes };
  conv.setProvider(antes);
  return out;
});
ok('volver a usar la app a mitad de ciclo lo corta (el modelo recibe la parada)', act.llamadas >= 1 && act.abortadas === act.llamadas && act.terminadas === 0,
  `${act.abortadas} de ${act.llamadas} abortadas`);
ok('  …sin segundo ciclo encima, sin propuesta y sin quedarse «en marcha»', act.segundo === false && act.nuevos === 0 && act.corriendo === false,
  `forceCycle ${act.segundo} · ${act.nuevos} ficheros · isRunning ${act.corriendo}`);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ PLAY/STOP DEL CEREBRO OK — persiste de verdad entre recargas y pausar corta el ciclo');
await b.close();
process.exit(fails ? 1 : 0);

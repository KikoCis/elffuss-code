// Con la interfaz en inglés, nada en español colado:
//   1. La ayuda del modo Básico (era siempre en español y mandaba a «Ajustes →
//      Cerebro» mientras la interfaz decía «Settings → Brain»), y las órdenes
//      en inglés que esa ayuda promete («tree», «read <file>»…) funcionan.
//   2. Lo que se para dice «(Stopped.)», no «(Parado.)».
//   3. La carpeta del almacenamiento del navegador es «OPFS (browser)».
// Y en español sigue todo igual.
//
//   BASE=http://localhost:8799 node tests/english-ui.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const b = await chromium.launch();
const errs = [];

async function abre(locale) {
  const ctx = await b.newContext({ locale });
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
  const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.goto(BASE + '/manifest.json');
  await p.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle('notes.md', { create: true })).createWritable(); await w.write('# notes\nhello\n'); await w.close();
  });
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 20000 });
  return { ctx, p };
}
const di = async (p, texto) => {
  const antes = await p.locator('#chat-log .msg.assistant').count();
  await p.fill('#prompt', texto);
  await p.press('#prompt', 'Enter');
  await p.waitForFunction(n => document.querySelectorAll('#chat-log .msg.assistant').length > n && !window.elffussClaw.conv.isBusy(), antes, { timeout: 10000 }).catch(() => {});
  return p.evaluate(() => ({ ultima: [...document.querySelectorAll('#chat-log .msg.assistant')].at(-1)?.textContent || '',
    herramientas: [...document.querySelectorAll('#chat-log .msg.tool b')].map(b => b.textContent) }));
};

// 1 · inglés
{
  const { ctx, p } = await abre('en-US');
  const hola = await di(p, 'hello');
  ok('1 · en inglés, la ayuda del modo Básico sale en inglés', /basic mode/.test(hola.ultima) && /Settings → Brain/.test(hola.ultima) && !/Ajustes|Cerebro|Entiendo/.test(hola.ultima), hola.ultima.slice(0, 160));
  const arbol = await di(p, 'tree');
  ok('1 · …y entiende las órdenes en inglés que promete («tree»)', arbol.herramientas.includes('code.tree'), JSON.stringify(arbol.herramientas));
  const lee = await di(p, 'read notes.md');
  ok('1 · …(«read <file>»)', lee.herramientas.includes('code.read'), JSON.stringify(lee.herramientas));

  // 2 · parar
  await p.evaluate(() => {
    window.elffussClaw.conv.setProvider({ chat: async (h, s, cb, signal) => {
      for (let i = 0; i < 200; i++) { if (signal?.aborted) throw new DOMException('Stopped', 'AbortError'); cb('·'); await new Promise(r => setTimeout(r, 25)); }
      return 'done';
    } });
  });
  await p.fill('#prompt', 'a long job');
  await p.press('#prompt', 'Enter');
  await p.waitForFunction(() => document.getElementById('btn-send').classList.contains('is-stop'), null, { timeout: 5000 }).catch(() => {});
  await p.click('#btn-send');
  await p.waitForFunction(() => !window.elffussClaw.conv.isBusy(), null, { timeout: 8000 }).catch(() => {});
  const nota = await p.evaluate(() => [...document.querySelectorAll('#chat-log .msg.muted')].map(n => n.textContent).at(-1) || '');
  ok('2 · lo que se para dice «(Stopped.)»', nota === '(Stopped.)', JSON.stringify(nota));

  // 3 · carpeta OPFS: el proyecto de prueba vive en la OPFS, y su carpeta es la
  // que se adopta como espacio de trabajo («Use the project's»)
  await p.click('#btn-settings');
  await p.waitForTimeout(400);
  await p.locator('#settings-panel button', { hasText: "Use the project's" }).click();
  await p.waitForTimeout(400);
  const ajustes = await p.evaluate(() => document.getElementById('settings-panel').textContent);
  ok('3 · la carpeta del navegador se llama «OPFS (browser)»', /OPFS \(browser\)/.test(ajustes) && !/navegador/.test(ajustes), (ajustes.match(/[^.]{0,40}OPFS[^.]{0,30}/) || [''])[0]);
  await ctx.close();
}

// 4 · español: igual que antes
{
  const { ctx, p } = await abre('es-ES');
  const hola = await di(p, 'hola');
  ok('4 · en español, la ayuda sigue en español', /modo básico/.test(hola.ultima) && /Ajustes → Cerebro/.test(hola.ultima), hola.ultima.slice(0, 120));
  const arbol = await di(p, 'árbol');
  ok('4 · …y «árbol» sigue funcionando', arbol.herramientas.includes('code.tree'), JSON.stringify(arbol.herramientas));
  await ctx.close();
}

console.log('\n  errores JS:', errs[0] || 'ninguno');
ok('sin errores de página', errs.length === 0, errs.join(' | '));
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ INTERFAZ EN INGLÉS SIN ESPAÑOL COLADO');
await b.close();
process.exit(fails ? 1 : 0);

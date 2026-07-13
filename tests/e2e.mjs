// Suite E2E de Elffuss Code — valida FUNCIONALIDAD REAL del IDE de punta a punta.
// Usa el gancho ?test-opfs (proyecto en OPFS del navegador, sin picker nativo)
// y el modo básico determinista. Ejercita árbol, Monaco, herramientas y chrome.
//
//   BASE=https://elffuss-code.utopiaia.com node e2e.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'https://elffuss-code.utopiaia.com';
let fails = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!cond) fails++; };

const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });

// siembra un proyecto en OPFS y entra al IDE
async function ide() {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
  const page = await ctx.newPage({ viewport: { width: 1500, height: 900 } });
  page.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) console.log('   pageerror:', e.message.slice(0, 100)); });
  await page.goto(BASE + '/?seed-only', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const w = async (dir, name, txt) => { const fh = await dir.getFileHandle(name, { create: true }); const s = await fh.createWritable(); await s.write(txt); await s.close(); };
    await w(opfs, 'README.md', '# demo project\nUn proyecto de prueba para Elffuss Code.');
    await w(opfs, 'index.js', 'function saludo(n){ return `hola ${n}` }\nconsole.log(saludo("mundo"));');
    const src = await opfs.getDirectoryHandle('src', { create: true });
    await w(src, 'utils.py', 'def suma(a,b):\n    return a+b\n');
  });
  await page.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000); // Monaco desde CDN
  return page;
}
const say = async (page, text, wait = 1500) => {
  await page.fill('#prompt', text); await page.press('#prompt', 'Enter'); await page.waitForTimeout(wait);
};

// ============ 1 · IDE se abre con el proyecto ============
{
  const p = await ide();
  const shown = await p.isVisible('#ide');
  const files = await p.locator('#tree .file').allTextContents();
  ok('1 · IDE abierto con árbol de archivos', shown && files.length >= 2, JSON.stringify(files));
  await p.context().close();
}

// ============ 2 · abrir archivo en Monaco desde el árbol ============
{
  const p = await ide();
  await p.locator('#tree .file', { hasText: 'index.js' }).click();
  await p.waitForTimeout(1000);
  const hasCode = await p.evaluate(() => window.monaco?.editor.getModels().some(m => m.getValue().includes('saludo')));
  const tab = await p.locator('.tab.active').textContent().catch(() => '');
  ok('2 · abrir archivo del árbol → Monaco con su contenido', hasCode && /index\.js/.test(tab));
  await p.context().close();
}

// ============ 3 · el agente busca en el código (code.search) ============
{
  const p = await ide();
  await say(p, 'busca saludo', 1800);
  const res = (await p.locator('.msg.assistant, .msg.tool-result').allTextContents()).join(' ');
  ok('3 · «busca saludo» encuentra el símbolo en el código', /index\.js:1|saludo/.test(res));
  await p.context().close();
}

// ============ 4 · el agente ESCRIBE un archivo (code.write → disco) ============
{
  const p = await ide();
  await say(p, 'escribe src/nuevo.js: export const pi = 3.1416;', 1800);
  const written = await p.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const src = await opfs.getDirectoryHandle('src');
    return (await (await (await src.getFileHandle('nuevo.js')).getFile()).text()).includes('3.1416');
  });
  ok('4 · «escribe archivo» persiste a disco de verdad', written);
  await p.context().close();
}

// ============ 5 · Command Palette (Cmd/Ctrl+P) encuentra archivos ============
{
  const p = await ide();
  await p.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true, bubbles: true })));
  await p.waitForTimeout(400);
  const open = await p.isVisible('#palette');
  await p.fill('#pal-input', 'utils'); await p.waitForTimeout(400);
  const hits = await p.locator('.pal-item .pi-name').allTextContents();
  await p.locator('.pal-item').first().click(); await p.waitForTimeout(700);
  const tab = await p.locator('.tab.active').textContent().catch(() => '');
  ok('5 · Command Palette abre, busca y abre el archivo', open && hits.some(h => /utils\.py/.test(h)) && /utils\.py/.test(tab));
  await p.context().close();
}

// ============ 6 · barra de menú File/Edit/View/Git ============
{
  const p = await ide();
  const menus = await p.locator('#menubar button').allTextContents();
  await p.click('#menubar button[data-menu="view"]'); await p.waitForTimeout(300);
  const viewItems = await p.locator('#topmenu .menu-item b').allTextContents();
  ok('6 · barra de menú con File/Edit/View/Git y desplegable', JSON.stringify(menus) === JSON.stringify(['File', 'Edit', 'View', 'Git']) && viewItems.length > 0);
  await p.context().close();
}

// ============ 7 · Skills (catálogo real) accesible ============
{
  const p = await ide();
  await p.click('#act-skills'); await p.waitForTimeout(500);
  const repos = await p.locator('#settings-panel a').allTextContents().catch(() => []);
  ok('7 · icono Skills abre el panel con los repos', repos.some(r => /anthropics\/skills/.test(r)));
  await p.context().close();
}

// ============ 8 · el E4B roto NO es cargable (anti-crash) ============
{
  const p = await ide();
  const opts = await p.$$eval('#model-select option', os => os.map(o => o.textContent));
  ok('8 · Gemma E4B roto no se ofrece en el selector', !opts.some(o => /E4B/.test(o)), JSON.stringify(opts));
  await p.context().close();
}

// ============ 9 · histórico del chat persiste tras refresco ============
{
  const p = await ide();
  await say(p, 'árbol', 1500);
  const before = await p.locator('#chat-log .msg').count();
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4000);
  const after = await p.locator('#chat-log .msg').count();
  ok('9 · histórico del chat sobrevive al refresco', after >= before && before > 0, `${before}→${after}`);
  await p.context().close();
}

// ============ 10 · OG image para compartir ============
{
  const p = await ide();
  const og = await p.getAttribute('meta[property="og:image"]', 'content');
  const r = await p.request.get(og);
  ok('10 · OG image existe y se sirve', r.ok() && (+r.headers()['content-length'] > 10000), og);
  await p.context().close();
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ TODO VERDE — IDE validado end-to-end');
await browser.close();
process.exit(fails ? 1 : 0);

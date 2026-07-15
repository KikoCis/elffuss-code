// code.edit invocado por el AGENTE de verdad (tool-calling real, no import directo)
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const f = await o.getFileHandle('config.py', { create: true });
  const s = await f.createWritable();
  await s.write('DEBUG = False\nMAX_RETRIES = 3\n');
  await s.close();
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

await p.evaluate(() => {
  window.elffussClaw.conv.getActive().agent.provider = {
    chat: async (h, s, cb) => {
      const res = h.find(m => m.role === 'user' && m.content.startsWith('[resultado code.edit]'));
      if (!res) return '```tool\n{"tool":"code.edit","args":{"path":"config.py","search":"DEBUG = False","replace":"DEBUG = True"}}\n```';
      return 'Hecho: ' + res.content;
    },
  };
});
await p.fill('#prompt', 'activa el modo debug en config.py');
await p.press('#prompt', 'Enter');
await p.waitForTimeout(800);

const content = await p.evaluate(async () => (await import('/js/tools/code.js')).read({ path: 'config.py' }));
ok('el agente aplicó la edición parcial de verdad vía tool-calling', content.includes('DEBUG = True'));
ok('el resto del fichero se conservó intacto', content.includes('MAX_RETRIES = 3'));
const chatLog = await p.locator('#chat-log').innerText();
ok('el chat muestra la tool-call code.edit', /code\.edit/.test(chatLog));

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ code.edit vía tool-calling real del agente OK');
await b.close();
process.exit(fails ? 1 : 0);

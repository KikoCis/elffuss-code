// Historial del prompt del chat: ↑/↓ recuperan lo enviado y ciclan.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

const val = () => p.locator('#prompt').inputValue();
const submit = async (t) => { await p.locator('#prompt').fill(t); await p.locator('#prompt').press('Enter'); await p.waitForTimeout(250); };

await submit('primer mensaje');
await submit('segundo mensaje');
ok('el prompt se vacía al enviar', (await val()) === '');

await p.locator('#prompt').focus();
await p.keyboard.press('ArrowUp');
ok('↑ recupera el último enviado', (await val()) === 'segundo mensaje', await val());
await p.keyboard.press('ArrowUp');
ok('↑↑ recupera el anterior', (await val()) === 'primer mensaje', await val());
await p.keyboard.press('ArrowDown');
ok('↓ vuelve al siguiente', (await val()) === 'segundo mensaje', await val());
await p.keyboard.press('ArrowDown');
ok('↓ al final restaura el borrador vacío', (await val()) === '', JSON.stringify(await val()));

// persistencia entre recargas
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1200);
await p.locator('#prompt').focus();
await p.keyboard.press('ArrowUp');
ok('el historial persiste tras recargar', (await val()) === 'segundo mensaje', await val());

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ HISTORIAL DEL CHAT OK');
await b.close();
process.exit(fails ? 1 : 0);

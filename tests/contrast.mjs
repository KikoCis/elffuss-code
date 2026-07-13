// Verifica el contraste de las tarjetas de modelo (CEREBRO) tras el fix.
// Abre Ajustes, mide luminancia de título+subtítulo vs fondo y captura.
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';

const lum = ([r, g, b]) => { const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a) + 0.05, lum(b) + 0.05]; return (Math.max(x, y) / Math.min(x, y)); };
const parse = s => s.match(/\d+/g).slice(0, 3).map(Number);

const br = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await br.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1200, height: 820 } });
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(800);
// abrir Ajustes
await p.click('#act-settings').catch(() => p.click('#btn-settings'));
await p.waitForTimeout(600);
await p.waitForSelector('.model-card', { timeout: 4000 });

const cards = await p.$$('.model-card');
let worst = 99;
for (const c of cards) {
  const b = await c.$('b'); const span = await c.$('span');
  const bg = await c.evaluate(el => getComputedStyle(el).backgroundColor);
  const bCol = await b.evaluate(el => getComputedStyle(el).color);
  const sCol = await span.evaluate(el => getComputedStyle(el).color);
  const name = await b.evaluate(el => el.textContent);
  // el fondo puede ser gradiente (active) → usa bg3 base para medir peor caso
  const bgRGB = bg.includes('gradient') || bg === 'rgba(0, 0, 0, 0)' ? [23, 27, 38] : parse(bg);
  const rB = ratio(parse(bCol), bgRGB), rS = ratio(parse(sCol), bgRGB);
  worst = Math.min(worst, rB, rS);
  console.log(`  ${name.padEnd(22)} título ${rB.toFixed(1)}:1  ·  subtítulo ${rS.toFixed(1)}:1`);
}
const pass = worst >= 4.5; // WCAG AA texto normal
console.log((pass ? '✅' : '❌') + ` peor contraste = ${worst.toFixed(1)}:1 (AA exige ≥4.5:1)`);
await p.screenshot({ path: OUT + '/contrast_settings.png' });
console.log('captura → contrast_settings.png');
await br.close();
process.exit(pass ? 0 : 1);

import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'fs';

const SB = '/tmp/trabajo';
const tpl = readFileSync(SB + '/og_template.html', 'utf8');
const svgCode = readFileSync('/Users/dev/work2026/elffuss-code/web/img/elffuss-code.svg', 'utf8').replace(/`/g,'\\`');
const svgClaw = readFileSync('/Users/dev/work2026/elffuss-claw/web/img/elffuss.svg', 'utf8').replace(/`/g,'\\`');
const html = tpl.replace('__SVG_CODE__', svgCode).replace('__SVG_CLAW__', svgClaw);
writeFileSync(SB + '/og_built.html', html);

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
for (const p of ['code','claw']) {
  await page.goto('file://' + SB + '/og_built.html?p=' + p, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true).catch(()=>{});
  await page.waitForTimeout(300);
  const el = await page.$('.og');
  await el.screenshot({ path: `${SB}/og-${p}-en.png` });
  console.log('OK og-' + p + '-en.png');
}
await b.close();

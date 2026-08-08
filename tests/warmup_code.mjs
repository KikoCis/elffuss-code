import { chromium } from 'playwright';
const BASE = process.env.BASE || 'https://elffuss-code.utopiaia.com';
const PROFILE = (process.env.SCRATCH || '/tmp/elffuss-test') + '/profile-code-gemma';
const ctx = await chromium.launchPersistentContext(PROFILE, {
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu', '--use-angle=metal'],
  viewport: { width: 1440, height: 900 },
});
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'litert:gemma-e2b'); } catch {} });
const p = ctx.pages()[0] || await ctx.newPage();
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
console.log('warming up Gemma-4 E2B (Code)…');
const t0 = Date.now();
let loaded = false;
while (Date.now() - t0 < 300000) {
  const cls = await p.locator('#model-dot').getAttribute('class').catch(() => '');
  if (cls && /\bon\b/.test(cls)) { loaded = true; break; }
  await p.waitForTimeout(1000);
}
console.log(loaded ? `OK loaded in ${Math.round((Date.now()-t0)/1000)}s` : 'TIMEOUT');
await ctx.close();

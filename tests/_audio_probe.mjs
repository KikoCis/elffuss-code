import { chromium } from 'playwright';
const BASE = process.env.BASE || 'https://elffuss-code.utopiaia.com';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
const hits = [];
p.on('response', r => {
  const u = r.url();
  if (/sndcdn|soundcloud/i.test(u) && /\.(mp3|m4a|ts|aac)|media\/|stream/i.test(u)) hits.push({ url: u, type: r.headers()['content-type'], status: r.status() });
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
await p.click('#activity img');
console.log('esperando audio…');
await p.waitForTimeout(8000);
console.log('hits:', JSON.stringify(hits.slice(0, 15), null, 2));
await b.close();

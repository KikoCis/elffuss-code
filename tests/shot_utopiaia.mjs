import { chromium } from 'playwright';
const OUT = '/tmp/trabajo';
const b = await chromium.launch();
const p = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-ES' }).then(c => c.newPage());
await p.goto('https://utopiaia.com/#elffuss', { waitUntil: 'networkidle' }).catch(()=>{});
await p.waitForTimeout(3500);
// scroll a la sección elffuss y captura
await p.evaluate(() => document.querySelector('#elffuss')?.scrollIntoView());
await p.waitForTimeout(1500);
await p.screenshot({ path: OUT + '/utopiaia_elffuss_section.png' });
await b.close();
console.log('OK');

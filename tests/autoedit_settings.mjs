// El interruptor </> Auto (barra) ahora también vive en Ajustes → Permisos de
// ejecución, como el mismo estado (misma clave de localStorage) — para que se
// pueda ver/gestionar desde un único sitio, sin tener que ir a la barra.
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

ok('por defecto, </> Auto está en modo automático (sin preguntar)', await p.evaluate(() => localStorage.getItem('elffusscode.autoedit') !== '0'));

await p.click('#btn-settings');
await p.waitForTimeout(300);
const checkbox = p.locator('#perm-autoedit');
ok('el checkbox de Ajustes existe y aparece marcado por defecto', await checkbox.isChecked());

// desmarcarlo desde Ajustes debe apagar el modo auto también en la barra
await checkbox.uncheck();
await p.waitForTimeout(150);
ok('desmarcar en Ajustes actualiza localStorage a modo Revisar', await p.evaluate(() => localStorage.getItem('elffusscode.autoedit') === '0'));
await p.click('#btn-settings'); // cerrar
await p.waitForTimeout(200);
const btnText = await p.locator('#btn-autoedit .ae-txt').innerText();
ok('el botón </> de la barra refleja "Revisar" tras desmarcar en Ajustes', btnText === 'Revisar', btnText);

// volver a marcarlo desde la BARRA debe reflejarse en Ajustes al reabrir
await p.click('#btn-autoedit');
await p.waitForTimeout(150);
await p.click('#btn-settings');
await p.waitForTimeout(300);
ok('el checkbox de Ajustes refleja "Auto" tras activarlo desde la barra', await p.locator('#perm-autoedit').isChecked());

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ PERMISOS DE EJECUCIÓN: mismo estado en Ajustes y en la barra');
await b.close();
process.exit(fails ? 1 : 0);

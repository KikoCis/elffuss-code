// 📨 Errores y feedback: opt-in (apagado por defecto — "nada sale de tu
// máquina" sigue siendo cierto salvo que el usuario lo active), captura de
// errores no capturados cuando está activo, y envío manual de feedback que
// funciona SIEMPRE (acción explícita) sin activar el automático de fondo.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();

// intercepta /proxy/report para no depender de un backend real
const reports = [];
await p.route('**/proxy/report', async route => {
  reports.push(JSON.parse(route.request().postData() || '{}'));
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
});

await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);

// 1) apagado por defecto — nada se manda sin acción explícita
ok('telemetría apagada por defecto', await p.evaluate(async () => (await import('/js/telemetry.js')).isEnabled()) === false);
await p.evaluate(async () => { const t = await import('/js/telemetry.js'); await t.reportError('no debería salir'); });
await p.waitForTimeout(200);
ok('con telemetría apagada, reportError() no manda nada', reports.length === 0);

// 2) panel de Ajustes: checkbox existe, refleja el estado, y lo cambia de verdad
await p.click('#btn-settings');
await p.waitForTimeout(300);
ok('el checkbox de errores/feedback existe y empieza desmarcado', await p.locator('#tel-enabled').isChecked() === false);
await p.locator('#tel-enabled').check();
await p.waitForTimeout(100);
ok('marcarlo activa telemetry.isEnabled()', await p.evaluate(async () => (await import('/js/telemetry.js')).isEnabled()) === true);
ok('persiste en localStorage', await p.evaluate(() => localStorage.getItem('elffuss.telemetry.elffuss-code') === '1'));

// 3) con telemetría activa, un error SÍ se manda
await p.evaluate(async () => { const t = await import('/js/telemetry.js'); await t.reportError('fallo de prueba', { stack: 'en algún sitio' }); });
await p.waitForTimeout(200);
ok('con telemetría activa, reportError() manda el informe', reports.some(r => r.kind === 'error' && r.message === 'fallo de prueba'));
ok('el informe lleva app, url y user-agent, nunca código', reports.some(r => r.app === 'elffuss-code' && r.url && r.userAgent));

// 4) errores globales no capturados también se mandan cuando está activo
await p.evaluate(() => { setTimeout(() => { throw new Error('crash-no-capturado-de-prueba'); }, 0); });
await p.waitForTimeout(300);
ok('un error global no capturado también se reporta solo', reports.some(r => /crash-no-capturado-de-prueba/.test(r.message)));

// 5) lo desactivamos y confirmamos que deja de mandar automáticos…
await p.locator('#tel-enabled').uncheck();
await p.waitForTimeout(100);
const before = reports.length;
await p.evaluate(async () => { const t = await import('/js/telemetry.js'); await t.reportError('esto no debería salir ya'); });
await p.waitForTimeout(200);
ok('al desactivarlo, reportError() vuelve a no mandar nada', reports.length === before);

// …pero el feedback MANUAL sigue funcionando (acción explícita del usuario)
await p.fill('#tel-feedback', 'esto es un feedback manual de prueba');
await p.click('#tel-send');
await p.waitForTimeout(300);
ok('el feedback manual SÍ se manda aunque el automático esté apagado', reports.some(r => r.kind === 'feedback' && /feedback manual de prueba/.test(r.message)));
ok('tras mandar el feedback manual, el automático sigue apagado', await p.evaluate(async () => (await import('/js/telemetry.js')).isEnabled()) === false);
ok('el textarea se limpia tras enviar', await p.locator('#tel-feedback').inputValue() === '');

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ TELEMETRÍA/FEEDBACK: opt-in real, nunca automático sin permiso, manual siempre disponible');
await b.close();
process.exit(fails ? 1 : 0);

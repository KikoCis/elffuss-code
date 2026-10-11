// Gestor de extensiones con código (parte B2): todo por el panel, con Open VSX
// simulado (tests/lib/openvsx-mock.mjs) que sirve los .vsix REALES fijados de
// Tyriar.sort-lines 1.12.0 y esbenp.prettier-vscode 12.4.0 (tests/.cache/vsix,
// SHA-256 comprobada) y tres manifiestos sintéticos.
//
//   node tests/x2_manager.mjs        (sin los .vsix en caché ni red: NOT RUN)
//
// Comprueba: buscar no carga nada del nivel 2; el detalle dice qué funcionará
// (R4); el consentimiento enseña el tamaño ANTES de bajar nada y Cancelar no
// cambia nada; instalar y ejecutar; los comandos con su botón «Ejecutar»;
// Prettier formatea; el formateador por lenguaje; los ajustes (validados);
// tras recargar todo vuelve solo; apagar el código de una; desinstalar (sin
// ficheros en IndexedDB y sin recinto al final); el filtro «Funciona en Code»;
// la suma SHA-256 obligatoria; «Necesita Node»; el ancho de un teléfono; y que
// a Open VSX solo le habla la página de Code, el recinto pide solo sus dos
// documentos y la baliza queda a 0.
import { chromium } from 'playwright';
import { startServer } from './lib/x2-server.mjs';
import { startBeacon } from './lib/beacon.mjs';
import { fetchVsix, PINNED } from './lib/x2-vsix.mjs';
import { mockOpenVsx } from './lib/openvsx-mock.mjs';
import { openZip } from '../web/js/ext/unzip.js';
import { parseJsonc } from '../web/js/ext/formats.js';

let fails = 0;
const ok = (name, c, extra = '') => { console.log((c ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, { timeout = 30000, every = 200 } = {}) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch { /* reintenta */ } await sleep(every); }
  return v;
}

// ── paquetes ──
const packages = [];
for (const p of PINNED) {
  let v;
  try { v = await fetchVsix({ ...p, offline: process.env.X2_OFFLINE === '1' }); }
  catch (e) { console.log(`⏭️  NOT RUN x2_manager — ${p.namespace}.${p.name}@${p.version}: ${e.message}`); process.exit(0); }
  const zip = openZip(v.bytes, { maxEntry: 32 << 20, maxTotal: 64 << 20 });
  const manifest = parseJsonc(new TextDecoder().decode(await zip.read('extension/package.json')));
  packages.push({ namespace: p.namespace, name: p.name, version: p.version, manifest, vsix: v.bytes, published: v.sha256, downloadCount: 1000 });
}
const fake = (name, extra) => ({ namespace: 'elffuss-test', name, version: '1.0.0', keywords: ['elffuss-filter'], published: null,
  manifest: { name, publisher: 'elffuss-test', version: '1.0.0', displayName: 'Fake ' + name, engines: { vscode: '^1.80.0' }, ...extra } });
packages.push(
  fake('nodeonly', { main: './out/ext.js', contributes: { commands: [{ command: 'n.x', title: 'X' }] } }),
  fake('nohash', { browser: './web.js', contributes: { commands: [{ command: 'h.x', title: 'X' }] } }),
  fake('themeonly', { contributes: { themes: [{ label: 'T', uiTheme: 'vs-dark', path: './t.json' }] } }),
);
// el .vsix de nohash existe pero Open VSX no publica su suma
packages.find(p => p.name === 'nohash').vsix = packages[0].vsix;

const srv = await startServer();
const beacon = await startBeacon();
const browser = await chromium.launch({ args: [`--host-resolver-rules=${beacon.resolverRules}`] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch { /* — */ } });
const mock = await mockOpenVsx(ctx, packages);
const page = await ctx.newPage();
const requests = [], errors = [];
ctx.on('request', r => requests.push(r.url()));
page.on('pageerror', e => { if (e.message !== 'Canceled') errors.push(e.message); });
const x2errors = [];                                  // lo que el recinto avisa por consola ([x2] …)
page.on('console', m => { if (/\[x2\]/.test(m.text()) && /already exists|ext\.add/.test(m.text())) x2errors.push(m.text().slice(0, 200)); });
page.on('dialog', d => d.accept());                      // confirmar desinstalar
await page.goto(srv.codeOrigin + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  const o = await navigator.storage.getDirectory();
  const w = async (n, t) => { const f = await o.getFileHandle(n, { create: true }); const s = await f.createWritable(); await s.write(t); await s.close(); };
  await w('fruits.txt', 'pear\napple\nfig\n');
  await w('ugly.js', 'const  x = {a:1,b:[1,2,3]}\n');
});
const openIde = async () => {
  await page.goto(srv.codeOrigin + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.monaco?.editor?.getEditors?.().length, null, { timeout: 30000 });
};
await openIde();
const open = p => page.evaluate(async p => { await (await import('/js/ide.js')).openFile(p); }, p);
const value = () => page.evaluate(() => window.monaco.editor.getEditors()[0].getModel().getValue());
const setValue = v => page.evaluate(v => window.monaco.editor.getEditors()[0].getModel().setValue(v), v);
const formatDoc = () => page.evaluate(async () => { const ed = window.monaco.editor.getEditors()[0]; ed.focus(); await ed.getAction('editor.action.formatDocument').run(); });
const L2 = u => /\/vendor\/x2\/|\/js\/ext2\//.test(u);
// abrir un fichero cierra el panel (como siempre): se vuelve a abrir para usarlo
const panel = async () => { await page.click('#act-ext'); await until(() => page.evaluate(() => !document.getElementById('settings-panel').hidden && !!document.getElementById('ext-panel'))); };
const row = id => page.locator(`#ext-results .ext-row[data-id="${id}"]`);
const installed = id => page.locator(`#ext-installed .ext-row[data-id="${id}"]`);
const search = async q => { await page.fill('#ext-q', q); await page.press('#ext-q', 'Enter'); };
const codeState = id => page.evaluate(id => document.querySelector(`#ext-installed .ext-row[data-id="${id}"] .ext-x2-state`)?.textContent || null, id);
const idbKeys = prefix => page.evaluate(prefix => new Promise((res, rej) => {
  const r = indexedDB.open('elffuss-code-ext', 1);
  r.onsuccess = () => { const q = r.result.transaction('files').objectStore('files').getAllKeys(); q.onsuccess = () => { res(q.result.filter(k => String(k).startsWith(prefix)).length); r.result.close(); }; q.onerror = () => rej(q.error); };
  r.onerror = () => rej(r.error);
}), prefix);

// ── M1–M5: buscar, detalle, consentimiento ──
await page.click('#act-ext');
await until(() => page.evaluate(() => !!document.getElementById('ext-panel')));
ok('M1 sin extensiones con código, la explicación de siempre (que ya dice que su código solo corre si lo enciendes)', /No extension code runs unless you turn it on for one extension/.test(await page.textContent('#ext-panel .ext-intro')));
requests.length = 0;
await search('sort');
await until(async () => (await row('Tyriar.sort-lines').count()) === 1);
ok('M2 buscar no carga nada del nivel 2', !requests.some(L2), requests.filter(L2).join(' '));
await row('Tyriar.sort-lines').locator('.ext-name').click();
const det1 = await until(async () => { const t = await row('Tyriar.sort-lines').locator('.ext-detail').innerText(); return /Not tested in Code yet/.test(t) ? t : null; });
ok('M3 el detalle dice qué funcionará: se ejecuta en el recinto con sus comandos, aún no probada', !!det1 && /Runs in Code’s sandbox: \d+ commands/.test(det1) && /No internet; sees only the files you open/.test(det1), det1);
const btns = await row('Tyriar.sort-lines').evaluate(r => ({ code: r.querySelector('.ext-install-code')?.textContent, install: r.querySelector('.ext-install')?.getAttribute('aria-disabled'), why: r.querySelector('.ext-install')?.title }));
ok('M3b «Instalar y ejecutar su código…»; «Instalar» a secas queda inerte (solo trae código)', btns.code === 'Install and run its code…' && btns.install === 'true' && /only brings code/.test(btns.why), JSON.stringify(btns));
ok('M3c abrir el detalle no baja el recinto ni lo abre', !requests.some(u => u.includes('/vendor/x2/')) && !requests.some(u => u.startsWith(srv.sandboxOrigin)));
await row('Tyriar.sort-lines').locator('.ext-install-code').click();
const consent = await until(() => page.evaluate(() => {
  const d = document.querySelector('#x2-consent [role="dialog"]');
  // (lo que pesa la extensión llega de una petición HEAD, sin hacer esperar al diálogo)
  return d && /This extension: \d/.test(d.textContent) ? { text: d.textContent, focused: document.activeElement?.textContent, buttons: [...d.querySelectorAll('button')].map(b => b.textContent) } : null;
}));
ok('M4 consentimiento: qué verá, sin internet, el tamaño del recinto y que se baja al aceptar', !!consent && /Run the code of Sort lines\?/.test(consent.text) && /can’t read your project, conversations or keys/.test(consent.text)
  && /Code’s extension runtime: 2\.6 MB, downloaded once and then cached/.test(consent.text) && /downloaded from Open VSX when you accept/.test(consent.text)
  && consent.focused === 'Cancel' && consent.buttons.join() === 'Cancel,Install and run code', JSON.stringify(consent));
const mbOf = n => (n / 1e6).toFixed(1) + ' MB';
ok('M4a …y lo que pesa la extensión, antes de bajarla (una petición HEAD)', consent.text.includes(`This extension: ${mbOf(packages[0].vsix.length)}, downloaded from Open VSX when you accept`) && mock.sizeLookups().length === 1, JSON.stringify({ text: consent.text.slice(-200), heads: mock.sizeLookups() }));
ok('M4b con el diálogo abierto todavía no se ha bajado nada', !requests.some(u => u.includes('/vendor/x2/')) && !mock.downloads().length);
await page.keyboard.press('Escape');
await sleep(500);
ok('M5 Cancelar: nada instalado ni bajado', (await installed('tyriar.sort-lines').count()) === 0 && !mock.downloads().length && !requests.some(u => u.includes('/vendor/x2/')));

// ── M6–M8: instalar sort-lines y ejecutar su comando desde el panel ──
await row('Tyriar.sort-lines').locator('.ext-install-code').click();
await until(() => page.evaluate(() => !!document.querySelector('#x2-consent')));
await page.click('#x2-consent button:has-text("Install and run code")');
// sort-lines arranca con su primer comando: «lista» hasta entonces
const READY = s => s === 'running' || s === 'ready (starts when first used)';
const st1 = await until(async () => { const s = await codeState('tyriar.sort-lines'); return READY(s) ? s : null; }, { timeout: 90000 });
ok('M6 instalada con su código: el recinto arrancó y ella está lista', !!st1, String(await codeState('tyriar.sort-lines')));
ok('M6a aceptar en el diálogo no cierra el panel de extensiones', !(await page.evaluate(() => document.getElementById('settings-panel').hidden)));
ok('M6b la explicación del panel pasa a la del nivel 2', /sealed sandbox on a separate site/.test(await page.textContent('#ext-panel .ext-intro')));
const vendorReqs = requests.filter(u => u.includes('/vendor/x2/'));
ok('M6c el recinto se bajó una vez (3 ficheros verificados)', vendorReqs.length === 3, vendorReqs.join(' '));
const cmds = await until(async () => { const c = await installed('tyriar.sort-lines').locator('.ext-x2-cmds li').allInnerTexts(); return c.length >= 10 ? c : null; });
ok('M7 sus comandos, cada uno con su botón Ejecutar (también en el teléfono)', !!cmds && cmds.some(t => /Sort lines \(ascending, case sensitive\)/.test(t)), JSON.stringify(cmds?.slice(0, 3)));
await open('fruits.txt');
await page.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 4 }); });
await sleep(300);
await panel();
await installed('tyriar.sort-lines').locator('[data-k="cmd:sortLines.sortLines"]').click();
ok('M8 Ejecutar desde el panel ordena el fichero abierto', !!(await until(async () => (await value()) === 'apple\nfig\npear\n')), JSON.stringify(await value()));

// ── M9–M13: Prettier ──
await panel();
await search('prettier');
await until(async () => (await row('esbenp.prettier-vscode').count()) === 1);
await row('esbenp.prettier-vscode').locator('.ext-name').click();
const det2 = await until(async () => { const t = await row('esbenp.prettier-vscode').locator('.ext-detail').innerText(); return /Tested in Code/.test(t) ? t : null; });
ok('M9 Prettier: lo declarativo, el código en el recinto y el resultado del censo (formateador)', !!det2 && /Works now \(no code\): \d+ languages?/.test(det2) && /Runs in Code’s sandbox/.test(det2) && /Tested in Code: starts.*formatter/.test(det2), det2);
await row('esbenp.prettier-vscode').locator('.ext-install-code').click();
const consent2 = await until(() => page.evaluate(() => { const d = document.querySelector('#x2-consent [role="dialog"]'); return d && /This extension: \d/.test(d.textContent) ? { text: d.textContent, buttons: [...d.querySelectorAll('button')].map(b => b.textContent) } : null; }));
ok('M10 su tamaño (el del .vsix, antes de bajarlo) y la opción de instalarla sin su código', !!consent2 && consent2.text.includes(`This extension: ${mbOf(packages.find(p => p.name === 'prettier-vscode').vsix.length)}, downloaded`) && consent2.buttons.includes('Install without its code'), JSON.stringify(consent2));
await page.click('#x2-consent button:has-text("Install and run code")');
await until(async () => ((await codeState('esbenp.prettier-vscode')) === 'running' ? 1 : null), { timeout: 90000 });
await open('ugly.js');
let formatted = null;
for (let i = 0; i < 20 && !formatted; i++) { await formatDoc(); formatted = await until(async () => ((await value()) === 'const x = { a: 1, b: [1, 2, 3] };\n' ? 1 : null), { timeout: 1500 }); }
ok('M11 Format Document con Prettier', !!formatted, JSON.stringify(await value()));
// formateador por lenguaje: el de serie para javascript, y vuelta a Prettier
await panel();
const fmt = installed('esbenp.prettier-vscode').locator('.ext-x2-fmt');
await until(async () => (await fmt.count()) === 1);
await fmt.locator('summary').click();
await fmt.locator('[data-k="fmt:javascript"]').selectOption('builtin');
await setValue('const  y = {a:1}\n');
await sleep(800);
await formatDoc();
ok('M12 «el de serie» para javascript: formatea Monaco, sin el punto y coma de Prettier', !!(await until(async () => ((await value()) === 'const y = { a: 1 }\n' ? 1 : null), { timeout: 8000 })), JSON.stringify(await value()));
await installed('esbenp.prettier-vscode').locator('.ext-x2-fmt').evaluate(d => { d.open = true; });
await installed('esbenp.prettier-vscode').locator('[data-k="fmt:javascript"]').selectOption('extension');
await setValue('const  y = {a:1}\n');
await sleep(800);
let back = null;
for (let i = 0; i < 10 && !back; i++) { await formatDoc(); back = await until(async () => ((await value()) === 'const y = { a: 1 };\n' ? 1 : null), { timeout: 1500 }); }
ok('M12b y de vuelta a Prettier', !!back, JSON.stringify(await value()));
// ajustes en JSON, validados contra los que declara Prettier
const settings = installed('esbenp.prettier-vscode').locator('.ext-x2-settings');
await settings.locator('summary').click();
await settings.locator('textarea').fill('{"prettier.nope": 1}');
await settings.locator('[data-k="x2save"]').click();
const bad = await until(async () => { const t = await settings.locator('.ext-x2-msg').textContent(); return /unknown setting/.test(t) ? t : null; });
ok('M13 un ajuste que la extensión no declara se rechaza', !!bad && (await settings.locator('.ext-x2-msg').getAttribute('role')) === 'alert', String(bad));
await installed('esbenp.prettier-vscode').locator('.ext-x2-settings').evaluate(d => { d.open = true; });
await installed('esbenp.prettier-vscode').locator('.ext-x2-settings textarea').fill('{"prettier.singleQuote": true}');
await installed('esbenp.prettier-vscode').locator('.ext-x2-settings [data-k="x2save"]').click();
await until(async () => /Settings applied/.test(await installed('esbenp.prettier-vscode').locator('.ext-x2-msg').textContent()));
await setValue('const s = "a"\n');
let quoted = null;
for (let i = 0; i < 20 && !quoted; i++) { await formatDoc(); quoted = await until(async () => ((await value()) === "const s = 'a';\n" ? 1 : null), { timeout: 1500 }); }
ok('M13b sus ajustes llegan a la extensión («prettier.singleQuote»)', !!quoted, JSON.stringify(await value()));

// ── M14: al recargar todo vuelve solo (instaladas, encendidas, con sus ajustes) ──
await openIde();
await open('ugly.js');
await until(() => page.evaluate(async () => (await import('/js/ext2/bridge.js')).state().state === 'running'), { timeout: 90000 });
await setValue('const t = "b"\n');
let again = null;
for (let i = 0; i < 30 && !again; i++) { await formatDoc(); again = await until(async () => ((await value()) === "const t = 'b';\n" ? 1 : null), { timeout: 1500 }); }
ok('M14 tras recargar: el recinto arranca solo con las dos y los ajustes siguen', !!again, JSON.stringify(await value()));
await page.click('#act-ext');
await until(async () => READY(await codeState('tyriar.sort-lines')) && (await codeState('esbenp.prettier-vscode')) === 'running', { timeout: 60000 });

// ── M15: el ancho de un teléfono ──
await page.setViewportSize({ width: 390, height: 844 });
await sleep(500);
const phone = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth, runBtn: !!document.querySelector('#ext-installed .ext-x2-cmd') }));
ok('M15 a 390 px: sin desplazamiento horizontal y con los botones Ejecutar a mano', phone.sw <= phone.w && phone.runBtn, JSON.stringify(phone));
await page.setViewportSize({ width: 1280, height: 860 });

// ── M16–M18: apagar, desinstalar ──
await installed('tyriar.sort-lines').locator('[data-k="x2run"]').click();
// (quitar una extensión del host de extensiones no para su código: el recinto
// se rehace con las demás, así que la otra vuelve a «en marcha» enseguida)
ok('M16 apagar el código de una: queda instalada y apagada; la otra sigue', !!(await until(async () => (await codeState('tyriar.sort-lines')) === 'off'))
  && !!(await until(async () => (await codeState('esbenp.prettier-vscode')) === 'running', { timeout: 60000 }))
  && !(await page.evaluate(() => (window.elffussClaw?.commands || []).some(c => c.x2 === 'tyriar.sort-lines'))));
await open('fruits.txt');
await setValue('zz\nyy\n');
await page.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 3 }); });
await page.evaluate(async () => (await import('/js/ext2/bridge.js')).runCommand('sortLines.sortLines'));
await sleep(800);
ok('M16b y su código está parado de verdad: su comando ya no hace nada en el recinto', (await value()) === 'zz\nyy\n', JSON.stringify(await value()));
await panel();
// volver a encenderla en la misma sesión (el recinto sigue en marcha por Prettier):
// sus ficheros se vuelven a registrar y sus comandos funcionan
await installed('tyriar.sort-lines').locator('[data-k="x2run"]').click();
const back2 = await until(async () => { const s = await codeState('tyriar.sort-lines'); return READY(s) ? s : null; }, { timeout: 30000 });
await open('fruits.txt');
await setValue('zz\nyy\n');
await page.evaluate(() => { const ed = window.monaco.editor.getEditors()[0]; ed.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 3 }); });
await panel();
await installed('tyriar.sort-lines').locator('[data-k="cmd:sortLines.sortLines"]').click();
ok('M16c apagar y volver a encender su código en la misma sesión: vuelve a funcionar, sin ficheros «que ya existen»', !!back2 && !!(await until(async () => (await value()) === 'yy\nzz\n')) && x2errors.length === 0, JSON.stringify({ back2, v: await value(), x2errors: x2errors.slice(0, 2) }));
await installed('tyriar.sort-lines').locator('.ext-uninstall').click();
ok('M17 desinstalar sort-lines: sin fila y sin ficheros en IndexedDB', !!(await until(async () => (await installed('tyriar.sort-lines').count()) === 0)) && (await idbKeys('tyriar.sort-lines@')) === 0);
await installed('esbenp.prettier-vscode').locator('.ext-uninstall').click();
await until(async () => (await installed('esbenp.prettier-vscode').count()) === 0);
ok('M18 desinstalar la última: sin recinto, sin ficheros y la explicación de siempre', !!(await until(() => page.evaluate(() => !document.getElementById('x2-sandbox'))))
  && (await idbKeys('esbenp.prettier-vscode@')) === 0 && /No extension code runs unless you turn it on for one extension/.test(await page.textContent('#ext-panel .ext-intro')));

// ── M19–M21: filtro, suma obligatoria, Node ──
await search('elffuss-filter');
await until(async () => (await page.locator('#ext-results .ext-row').count()) === 3);
await page.click('#ext-works');
const filtered = await until(async () => {
  const ids = await page.locator('#ext-results .ext-row').evaluateAll(rs => rs.map(r => r.dataset.id));
  const head = await page.textContent('#ext-results .sk-h');
  return ids.length === 2 && /checked 3 of 3/.test(head) ? { ids, head } : null;
});
ok('M19 «Funciona en Code»: fuera la de Node; quedan la del tema y la de código para navegador', !!filtered && !filtered.ids.includes('elffuss-test.nodeonly'), JSON.stringify(filtered));
ok('M19b con el filtro se avisa de que Open VSX ve esas consultas', await page.isVisible('#ext-works-note'));
// el consentimiento cabe en un teléfono
await page.setViewportSize({ width: 390, height: 844 });
await row('elffuss-test.nohash').locator('.ext-install-code').click();
const fit = await until(() => page.evaluate(() => { const d = document.querySelector('#x2-consent [role="dialog"]'); if (!d) return null; const r = d.getBoundingClientRect(); const b = [...d.querySelectorAll('button')].map(x => x.getBoundingClientRect()); return { left: r.left, right: r.right, w: window.innerWidth, sw: document.documentElement.scrollWidth, buttonsIn: b.every(x => x.left >= 0 && x.right <= window.innerWidth) }; }));
ok('M19c a 390 px el consentimiento cabe, con sus botones', !!fit && fit.left >= 0 && fit.right <= fit.w && fit.sw <= fit.w && fit.buttonsIn, JSON.stringify(fit));
await page.keyboard.press('Escape');
await page.setViewportSize({ width: 1280, height: 860 });
await sleep(300);
await row('elffuss-test.nohash').locator('.ext-install-code').click();
await until(() => page.evaluate(() => !!document.querySelector('#x2-consent')));
await page.click('#x2-consent button:has-text("Install and run code")');
const nosha = await until(async () => { const t = await page.textContent('#ext-msg'); return /publishes no SHA-256/.test(t) ? t : null; });
ok('M20 sin suma SHA-256 publicada, su código no se instala (y ni se baja)', !!nosha && (await page.getAttribute('#ext-msg', 'role')) === 'alert' && !mock.downloads().some(d => d.includes('nohash'))
  && (await installed('elffuss-test.nohash').count()) === 0, String(nosha));
await page.click('#ext-works');
await until(async () => (await page.locator('#ext-results .ext-row').count()) === 3);
await row('elffuss-test.nodeonly').locator('.ext-name').click();
const det3 = await until(async () => { const t = await row('elffuss-test.nodeonly').locator('.ext-detail').innerText(); return /Needs Node/.test(t) ? t : null; });
ok('M21 la de Node dice que no está disponible en el navegador, sin botón de ejecutar', !!det3 && (await row('elffuss-test.nodeonly').locator('.ext-install-code').count()) === 0, det3);

// ── M23: instalar un .vsix suelto que solo trae código ──
await page.setInputFiles('#ext-file', { name: 'sort-lines.vsix', mimeType: 'application/zip', buffer: packages[0].vsix });
const fileConsent = await until(() => page.evaluate(() => { const d = document.querySelector('#x2-consent [role="dialog"]'); return d ? d.textContent : null; }));
ok('M23 un .vsix con solo código pide el consentimiento y dice que no hay suma publicada', !!fileConsent && /From a \.vsix file: there is no published SHA-256/.test(fileConsent), String(fileConsent).slice(0, 160));
await page.click('#x2-consent button:has-text("Install and run code")');
ok('M23b instalada desde el fichero con su código, y en marcha', !!(await until(async () => { const s = await codeState('tyriar.sort-lines'); return s === 'running' || s === 'ready (starts when first used)'; }, { timeout: 90000 })));
await installed('tyriar.sort-lines').locator('.ext-uninstall').click();
await until(async () => (await installed('tyriar.sort-lines').count()) === 0);

// ── M22: privacidad ──
await sleep(500);
const fromSandbox = mock.log.filter(r => !r.frame.startsWith(srv.codeOrigin));
ok('M22 a Open VSX solo le habla la página de Code (ninguna petición del recinto)', mock.log.length > 0 && fromSandbox.length === 0, JSON.stringify(fromSandbox.slice(0, 3)));
const sbx = [...new Set(srv.requests.filter(r => r.host.startsWith('localhost:')).map(r => r.url.split('?')[0]))];
ok('M22b del recinto solo sus dos documentos', sbx.every(u => u === '/x2/v1/sandbox.html' || u === '/x2/v1/exthost-iframe.html'), sbx.join(' '));
ok('M22c baliza: 0 visitas', beacon.hits.length === 0, JSON.stringify(beacon.hits.slice(0, 3)));
ok('M22d sin errores de página', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
await beacon.close();
await srv.close();
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

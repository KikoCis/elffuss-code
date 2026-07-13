// Prueba de integración del TERMINAL de Elffuss Code.
// Siembra un proyecto en OPFS, comprueba el motor del shell (ls/cat/grep/mkdir/
// echo>/pipe/&&) contra los ficheros REALES, y la UI de xterm (teclear → salida).
// El shell importado en page.evaluate es el MISMO singleton que usa la app
// (los módulos ES se cachean por realm) → comparte el proyecto abierto.
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0;
const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1500, height: 900 } });
p.on('pageerror', e => { if (!/allow-same-origin/.test(e.message)) console.log('   pageerror:', e.message.slice(0, 160)); });

// sembrar proyecto en OPFS
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.evaluate(async () => {
  const opfs = await navigator.storage.getDirectory();
  const w = async (dir, name, txt) => { const fh = await dir.getFileHandle(name, { create: true }); const s = await fh.createWritable(); await s.write(txt); await s.close(); };
  const src = await opfs.getDirectoryHandle('src', { create: true });
  await w(opfs, 'README.md', '# demo\nProyecto de prueba para el terminal.');
  await w(opfs, 'package.json', '{ "name": "demo", "version": "1.0.0" }');
  await w(src, 'app.js', "import { greet } from './utils.js';\nexport function app(){ return greet('mundo'); }");
  await w(src, 'utils.js', "export const greet = (d) => `hola ${d}`;\nexport const TODO = 'refactor';");
});
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);

// ---- Motor del shell (mismo singleton que la app) ----
const sh = async (cmd) => p.evaluate(async (c) => {
  const s = await import('/js/shell.js');
  const raw = await s.exec(c);
  return s.stripAnsi(raw);
}, cmd);

ok('ls lista los ficheros reales del proyecto', /README\.md/.test(await sh('ls')) && /src\//.test(await sh('ls')), await sh('ls'));
ok('cat lee contenido real', (await sh('cat package.json')).includes('"name": "demo"'));
ok('cd + pwd navegan el árbol', (await sh('cd src')) !== undefined && (await sh('pwd')) === '/src');
ok('ls dentro de src tras cd', /app\.js/.test(await sh('ls')) && /utils\.js/.test(await sh('ls')));
await sh('cd ..');
ok('grep recursivo encuentra el símbolo', /utils\.js/.test(await sh('grep -n greet src')), (await sh('grep -n greet src')).replace(/\n/g, ' | '));
ok('tubería cat | grep', (await sh('cat src/utils.js | grep TODO')).includes('TODO'));
ok('mkdir + echo> escriben en disco', (await sh('mkdir tests && echo hola-terminal > tests/nota.txt'), (await sh('cat tests/nota.txt')).trim()) === 'hola-terminal');
ok('find -name localiza por patrón', /utils\.js/.test(await sh('find src -name *.js')));
ok('wc -l cuenta líneas', (await sh('wc -l src/utils.js')).trim() === '2', await sh('wc -l src/utils.js'));
ok('runtime real avisa con honestidad (npm)', /WebContainers/i.test(await sh('npm install').catch(e => e.message || '')) || /WebContainers/i.test(await p.evaluate(async () => { const s = await import('/js/shell.js'); try { await s.exec('npm install'); return ''; } catch (e) { return e.message; } })));

// el fichero creado por el shell aparece en el árbol del explorador (fsChange)
await p.waitForTimeout(400);
ok('el árbol del IDE refleja el fichero creado por el shell', await p.locator('#tree').getByText('tests', { exact: false }).count() > 0);

// ---- Tool de la elfa (terminal.run) ----
const agentOut = await p.evaluate(async () => {
  const t = await import('/js/tools/index.js');
  return t.runTool('terminal.run', { command: 'ls src' });
});
ok('la elfa puede ejecutar comandos (tool terminal.run)', /app\.js/.test(agentOut), String(agentOut).slice(0, 60));

// ---- UI de xterm ----
await p.click('#act-term');
await p.waitForTimeout(1500);
ok('el panel del terminal se abre', !(await p.locator('#terminal-panel').getAttribute('hidden').catch(() => 'x')));
ok('xterm se monta (canvas/rows presentes)', await p.locator('#terminal-host .xterm').count() > 0);
// teclear un comando en el terminal real
await p.locator('#terminal-host').click();
await p.locator('#terminal-host .xterm-helper-textarea').focus().catch(() => {});
await p.waitForTimeout(200);
await p.keyboard.type('ls');
await p.keyboard.press('Enter');
await p.waitForTimeout(700);
const rows = await p.locator('#terminal-host .xterm-rows').innerText().catch(() => '');
ok('teclear «ls» en la UI muestra los ficheros', /README\.md/.test(rows) || /package\.json/.test(rows), rows.replace(/\n+/g, ' | ').slice(0, 120));
await p.screenshot({ path: OUT + '/terminal.png' });
console.log('captura → terminal.png');

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ TERMINAL OK — shell real + xterm + tool de la elfa');
await b.close();
process.exit(fails ? 1 : 0);

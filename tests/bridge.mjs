// Bridge local: arranca el binario REAL compilado, conecta desde la UI (token
// pegado a mano, como haría el usuario), verifica los fuegos artificiales, y
// ejecuta un comando REAL (node/python) que solo un runtime de verdad puede
// producir — no algo que el shell emulado en JS pudiera fingir.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
const BRIDGE_BIN = '/Users/kikocisneros/work2026/elffuss-code/web/bridge-dl/elffuss-bridge-mac-arm64';
const PORT = 8765; // puerto real que usa bridge.js (fijo)
const TOKEN = 'test-token-e2e-' + Math.random().toString(36).slice(2);
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const bp = spawn(BRIDGE_BIN, ['-port', String(PORT), '-token', TOKEN], { stdio: 'pipe' });
let bridgeLog = '';
bp.stdout.on('data', d => bridgeLog += d.toString());
bp.stderr.on('data', d => bridgeLog += d.toString());
await new Promise(r => setTimeout(r, 800)); // que el bridge levante el puerto

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1300, height: 900 } });
p.on('console', m => { if (m.type() === 'error' && !/allow-same-origin/.test(m.text())) console.log('   err:', m.text().slice(0, 160)); });
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

ok('el bridge real arrancó y escucha', /Escuchando SOLO en 127\.0\.0\.1/.test(bridgeLog), bridgeLog.slice(0, 80));
const probed = await p.evaluate(async () => (await import('/js/bridge.js')).probe());
ok('la web detecta el bridge escuchando (/ping)', probed);

// abrir Ajustes, pegar el token real, conectar — flujo real de usuario
await p.click('#btn-settings'); await p.waitForTimeout(400);
await p.fill('#br-token', TOKEN);
await p.fill('#br-folder', '/tmp');
await p.click('#br-connect');
await p.waitForTimeout(1200);
ok('el punto de estado pasa a "conectado" (verde)', await p.evaluate(() => document.getElementById('br-dot')?.classList.contains('on')));
ok('el texto de estado confirma la conexión', /conectado/.test(await p.locator('#br-status').innerText()));
ok('fuegos artificiales al conectar (canvas de celebración)', await p.locator('#fireworks-fx').count() > 0);

// capabilities() ya refleja el bridge conectado
const caps = await p.evaluate(async () => (await import('/js/shell.js')).capabilities());
ok('shell.capabilities() confirma bridge:true', caps.bridge === true, JSON.stringify(caps));

// EJECUCIÓN REAL: node -e con una marca única que solo un node real produce.
// (Aserción ESTRICTA: sin "syntax error" ni el eco del comando roto — antes
// un bug de comillas hacía que el propio mensaje de error "aprobara" el test
// por casualidad, al repetir la marca dentro de la línea rota.)
const MARK = 'REAL-NODE-' + Math.floor(Math.random() * 1e6);
const nodeOut = await p.evaluate(async (mark) => {
  const s = await import('/js/shell.js');
  return s.stripAnsi(await s.exec(`node -e "console.log('${mark}')"`));
}, MARK);
ok('node ejecuta de VERDAD en la máquina real (vía el bridge)', nodeOut.trim() === MARK, nodeOut);

// python3 también, otra marca distinta
const MARK2 = 'REAL-PY-' + Math.floor(Math.random() * 1e6);
const pyOut = await p.evaluate(async (mark) => {
  const s = await import('/js/shell.js');
  return s.stripAnsi(await s.exec(`python3 -c "print('${mark}')"`));
}, MARK2);
ok('python3 ejecuta de VERDAD en la máquina real (vía el bridge)', pyOut.trim() === MARK2, pyOut);

// el tool terminal.run del AGENTE también lo usa (mismo camino real)
const agentOut = await p.evaluate(async (mark) => {
  const t = await import('/js/tools/index.js');
  return t.runTool('terminal.run', { command: `node -e "console.log('${mark}')"` });
}, MARK + '-agent');
ok('la elfa (terminal.run) también ejecuta de verdad vía el bridge', agentOut.trim() === MARK + '-agent', agentOut.slice(0, 60));

// origen NO permitido: el bridge debe rechazar conexiones de otro origen
const originCheck = await fetch(`http://127.0.0.1:${PORT}/ping`, { headers: { Origin: 'https://evil.example' } }).then(r => r.status).catch(() => 'err');
ok('el bridge RECHAZA orígenes no permitidos (seguridad)', originCheck === 403, `status ${originCheck}`);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ BRIDGE LOCAL OK — conexión real + ejecución real + seguridad de origen');
await b.close();
bp.kill();
process.exit(fails ? 1 : 0);

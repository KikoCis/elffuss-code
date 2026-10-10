// Bridge local: arranca el binario REAL compilado, conecta desde la UI (token
// pegado a mano, como haría el usuario), verifica los fuegos artificiales, y
// ejecuta un comando REAL (node/python) que solo un runtime de verdad puede
// producir — no algo que el shell emulado en JS pudiera fingir.
//
// Y PARAR: un comando largo se corta con la señal (resuelve en el acto con 130
// y el proceso desaparece), cerrar el socket suelta los trabajos pendientes en
// vez de dejarlos colgados para siempre, y Ctrl+C en el terminal corta el
// comando en curso.
//
// Necesita el puerto 8765 (el del bridge, fijo en bridge.js) y servir la web en
// http://localhost:8799 (el único origen local que el bridge acepta).
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const BASE = process.env.BASE || 'http://localhost:8799';
const BRIDGE_BIN = process.env.BRIDGE_BIN
  || new URL('../web/bridge-dl/elffuss-bridge-mac-arm64', import.meta.url).pathname;
const PORT = 8765; // puerto real que usa bridge.js (fijo)
const TOKEN = 'test-token-e2e-' + Math.random().toString(36).slice(2);
// La ejecución está acotada a una carpeta raíz (-root). La carpeta de trabajo que
// se pone en la UI tiene que estar DENTRO; antes se arrancaba sin -root (raíz =
// la carpeta desde la que se lanzaba el test) y se ponía /tmp, que el bridge
// rechaza con razón.
const ROOT = realpathSync(process.env.BRIDGE_ROOT || mkdtempSync(join(tmpdir(), 'elffuss-bridge-')));
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

// Grupo de procesos propio: al terminar se mata el bridge Y lo que haya lanzado.
const bp = spawn(BRIDGE_BIN, ['-port', String(PORT), '-token', TOKEN, '-root', ROOT], { stdio: 'pipe', detached: true });
let bridgeLog = '';
bp.stdout.on('data', d => bridgeLog += d.toString());
bp.stderr.on('data', d => bridgeLog += d.toString());
await new Promise(r => setTimeout(r, 800)); // que el bridge levante el puerto
const hijosDelBridge = () => { try { return execFileSync('pgrep', ['-P', String(bp.pid)]).toString().trim().split('\n').filter(Boolean); } catch { return []; } };
const vivos = marca => { try { return execFileSync('pgrep', ['-f', marca]).toString().trim().split('\n').filter(Boolean).length; } catch { return 0; } };
const esperar = ms => new Promise(r => setTimeout(r, ms));

const b = await chromium.launch();
const ctx = await b.newContext({ locale: 'es-ES' });
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage({ viewport: { width: 1300, height: 900 } });
p.on('console', m => { if (m.type() === 'error' && !/allow-same-origin/.test(m.text())) console.log('   err:', m.text().slice(0, 160)); });
try {
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

  ok('el bridge real arrancó y escucha', /Escuchando SOLO en 127\.0\.0\.1/.test(bridgeLog), bridgeLog.slice(0, 80));
  const probed = await p.evaluate(async () => (await import('/js/bridge.js')).probe());
  ok('la web detecta el bridge escuchando (/ping)', probed);

  // abrir Ajustes, pegar el token real, conectar — flujo real de usuario
  await p.click('#btn-settings'); await p.waitForTimeout(400);
  await p.fill('#br-token', TOKEN);
  await p.fill('#br-folder', ROOT);
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

  // ── PARAR ────────────────────────────────────────────────────────────────
  // 1. `sleep 30` con la señal abortada a mitad: resuelve en el acto con 130 y
  //    el bridge mata el proceso (deja de ser hijo suyo).
  const r1 = await p.evaluate(async () => {
    const br = await import('/js/bridge.js');
    const ac = new AbortController();
    const prom = br.exec('sleep 30', { signal: ac.signal });
    await new Promise(r => setTimeout(r, 700));
    ac.abort();
    // 5 s de margen frente a los 30 del comando: si espera al proceso, no llega.
    return Promise.race([prom, new Promise(r => setTimeout(() => r('SIGUE ESPERANDO'), 5000))]);
  });
  ok('`sleep 30` parado con la señal: resuelve en el acto con código 130', r1 === 130, String(r1));
  await esperar(500);
  ok('  …y el bridge mató el proceso (ya no es hijo suyo)', hijosDelBridge().length === 0, `${hijosDelBridge().length} hijos vivos`);

  // 2. Cerrar el socket con un comando en marcha: el trabajo se resuelve (-1) y
  //    se avisa, en vez de quedarse pendiente para siempre.
  const r2 = await p.evaluate(async () => {
    const br = await import('/js/bridge.js');
    let err = '';
    const prom = br.exec('sleep 30', { onErr: t => { err += t; } });
    await new Promise(r => setTimeout(r, 500));
    br.disconnect();
    const code = await Promise.race([prom, new Promise(r => setTimeout(() => r('SIGUE ESPERANDO'), 5000))]);
    return { code, err };
  });
  ok('cerrar el socket suelta el trabajo pendiente (resuelve con -1)', r2.code === -1, String(r2.code));
  ok('  …y lo dice: «[bridge desconectado]»', /\[bridge desconectado\]/.test(r2.err), JSON.stringify(r2.err));
  // reconectar para lo que sigue
  const reconecta = await p.evaluate(async (tok) => { const br = await import('/js/bridge.js'); try { await br.connect(tok); return br.isConnected(); } catch (e) { return e.message; } }, TOKEN);
  ok('se vuelve a conectar tras el corte', reconecta === true, String(reconecta));

  // 3. Ctrl+C en el terminal corta el comando en curso (antes se ignoraba).
  const MARK3 = 'CTRLC-' + Math.floor(Math.random() * 1e6);
  await p.click('#act-term');
  await p.waitForTimeout(1500);
  await p.locator('#terminal-host').click();
  await p.locator('#terminal-host .xterm-helper-textarea').focus().catch(() => {});
  // 'FI'+'N-…': la marca de final no aparece tal cual en la línea tecleada,
  // solo en la salida si el comando llegara a terminar.
  await p.keyboard.type(`node -e "setTimeout(()=>console.log('FI'+'N-${MARK3}'),30000)" ${MARK3}`);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1200);
  const corriendo = vivos(MARK3);
  await p.keyboard.press('Control+C');
  await p.waitForTimeout(1200);
  const rows = await p.locator('#terminal-host .xterm-rows').innerText().catch(() => '');
  ok('el comando largo estaba corriendo de verdad antes del Ctrl+C', corriendo >= 1, `${corriendo} procesos con la marca`);
  ok('Ctrl+C mata el proceso', vivos(MARK3) === 0, `${vivos(MARK3)} procesos con la marca`);
  ok('  …el terminal lo enseña (^C y código 130) y no llega al final', /\^C/.test(rows) && /130/.test(rows) && !rows.includes('FIN-' + MARK3),
    rows.replace(/\n+/g, ' | ').slice(-200));
  await p.keyboard.type('echo de-vuelta');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(600);
  const rows2 = await p.locator('#terminal-host .xterm-rows').innerText().catch(() => '');
  ok('  …y el terminal vuelve a aceptar órdenes', /de-vuelta[\s\S]*de-vuelta/.test(rows2), rows2.replace(/\n+/g, ' | ').slice(-120));

  // origen NO permitido: el bridge debe rechazar conexiones de otro origen
  const originCheck = await fetch(`http://127.0.0.1:${PORT}/ping`, { headers: { Origin: 'https://evil.example' } }).then(r => r.status).catch(() => 'err');
  ok('el bridge RECHAZA orígenes no permitidos (seguridad)', originCheck === 403, `status ${originCheck}`);
} finally {
  await b.close().catch(() => {});
  try { process.kill(-bp.pid, 'SIGTERM'); } catch { /* ya no estaba */ }
}

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ BRIDGE LOCAL OK — conexión real + ejecución real + parar + seguridad de origen');
process.exit(fails ? 1 : 0);

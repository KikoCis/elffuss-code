// Baliza de las pruebas de privacidad: cualquier cosa que llegue aquí es una
// fuga. Un solo puerto TCP que mira el primer byte (0x16 = TLS → HTTPS con un
// certificado propio de esta ejecución; si no, HTTP), cuenta cada conexión
// aceptada (aunque no llegue a pedir nada), las mejoras a WebSocket y los
// CONNECT, y un puerto UDP para STUN (WebRTC).
//
//   const b = await startBeacon();         b.hits, b.tcp, b.udp, b.resolverRules
//   const b = await startBeacon({ tls: true })   (necesita openssl; sin él, sin HTTPS)
//
// resolverRules (las de siempre): *.test, open-vsx.org y openvsx.eclipsecontent.org
// van a la baliza. strictRules además deja sin resolver cualquier otro nombre
// menos el bucle local y cdn.jsdelivr.net (Monaco, el camino de siempre).
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function selfSigned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x2-beacon-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=beacon.test',
      '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
    return { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
  } catch { return null; }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export async function startBeacon({ tls = false } = {}) {
  const hits = [];                                  // peticiones HTTP(S), mejoras y CONNECT
  const tcp = [];                                   // conexiones TCP aceptadas
  const udp = [];                                   // paquetes UDP (STUN)
  const record = kind => (req, res) => {
    hits.push({ kind, host: String(req.headers.host || ''), url: req.url, method: req.method });
    res.writeHead(req.url === '/favicon.ico' ? 404 : 200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('beacon');
  };
  const plain = http.createServer(record('http'));
  const cert = tls ? selfSigned() : null;
  const secure = cert ? https.createServer(cert, record('https')) : null;
  for (const s of [plain, secure].filter(Boolean)) {
    s.on('upgrade', (req, socket) => { hits.push({ kind: 'upgrade', host: String(req.headers.host || ''), url: req.url }); socket.destroy(); });
    s.on('connect', (req, socket) => { hits.push({ kind: 'connect', host: String(req.headers.host || ''), url: req.url }); socket.destroy(); });
  }
  const server = net.createServer(socket => {
    tcp.push({ at: tcp.length + 1 });
    socket.once('data', buf => {
      socket.pause();
      socket.unshift(buf);
      (buf[0] === 0x16 && secure ? secure : plain).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
    socket.on('error', () => {});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const stun = dgram.createSocket('udp4');
  stun.on('message', (msg, rinfo) => udp.push({ bytes: msg.length, from: rinfo.port }));
  await new Promise(r => stun.bind(0, '127.0.0.1', r));
  const map = `MAP *.test 127.0.0.1:${port}, MAP open-vsx.org 127.0.0.1:${port}, MAP openvsx.eclipsecontent.org 127.0.0.1:${port}`;
  return {
    port, hits, tcp, udp, udpPort: stun.address().port, https: !!secure,
    resolverRules: map,
    strictRules: `${map}, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE cdn.jsdelivr.net, MAP * ~NOTFOUND`,
    // lo que cuenta como fuga (favicon aparte: una pestaña abierta a propósito lo pide sola)
    leaks: () => hits.filter(h => h.url !== '/favicon.ico'),
    close: () => Promise.all([
      new Promise(r => server.close(r)), new Promise(r => plain.close(r)), secure ? new Promise(r => secure.close(r)) : null,
      new Promise(r => stun.close(r)),
    ].filter(Boolean)),
  };
}

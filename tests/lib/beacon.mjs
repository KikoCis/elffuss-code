// Baliza para los canarios del nivel 2: un servidor HTTP en 127.0.0.1 que
// apunta CUALQUIER cosa que le llegue (peticiones, WebSocket, CONNECT). Con
// Chromium arrancado con --host-resolver-rules que mandan *.test aquí, todo lo
// que se escape del recinto hacia un nombre del canario acaba en `hits`.
// (La baliza completa, con HTTPS, TCP y UDP/STUN, es de la parte B2.)
import http from 'node:http';

export async function startBeacon() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ kind: 'http', host: String(req.headers.host || ''), url: req.url, method: req.method });
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('beacon');
  });
  server.on('upgrade', (req, socket) => { hits.push({ kind: 'upgrade', host: String(req.headers.host || ''), url: req.url }); socket.destroy(); });
  server.on('connect', (req, socket) => { hits.push({ kind: 'connect', host: String(req.headers.host || ''), url: req.url }); socket.destroy(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port, hits,
    // Chromium: *.test y los hosts de Open VSX → la baliza; el resto de nombres, sin resolver
    resolverRules: `MAP *.test 127.0.0.1:${port}, MAP open-vsx.org 127.0.0.1:${port}, MAP openvsx.eclipsecontent.org 127.0.0.1:${port}`,
    close: () => new Promise(r => server.close(r)),
  };
}

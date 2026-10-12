// Test server for level 2: ONE loopback server, routed by the Host header.
//
//   127.0.0.1:<port>   Code: web/ with server/serve.py's semantics (static files
//                      with no-store, /v1 forwarding, /proxy), plus the vendor
//                      bundle under /vendor/x2/ with its production headers
//   localhost:<port>   the sandbox site: only its two documents, with the
//                      headers from sandbox/x2/headers.json and only for the
//                      exact query shape; 404 for anything else, no log
//
// The two hosts are different sites, as Code and the sandbox are in
// production. Test-only switches, as positive controls:
//   insecure: 'exthost' (X2_INSECURE=1 or =exthost) serves the extension-host
//     document without its CSP, so extension code CAN reach the network: the
//     canary must then hit the beacon; 'all' (X2_INSECURE=all) drops the CSP of
//     both documents, and the sandbox's own self-test must refuse to start;
//   tamper (X2_TAMPER=1) flips one byte in the middle of sandbox-main.js.gz.
//
//   node tests/lib/x2-server.mjs [--port N]     serve until killed
//   import { startServer } from './lib/x2-server.mjs'
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFor, queryAllowed, originsFor, loadSpec, DOCS_DIR } from '../../sandbox/x2/headers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const MAX_PROXY_BYTES = 2_000_000;
const LM_UPSTREAM = process.env.ELFFUSS_LM || 'https://elffuss.com';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.webmanifest': 'application/manifest+json', '.map': 'application/json', '.gz': 'application/octet-stream',
};

function safeJoin(root, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  const full = path.resolve(root, '.' + path.posix.normalize('/' + p));
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

const envInsecure = () => { const v = process.env.X2_INSECURE; return v === 'all' ? 'all' : v === '1' || v === 'exthost' ? 'exthost' : false; };

// codeAliases: other host names that also get Code (with the browser told to
// resolve them to 127.0.0.1), to see Code on a host config.js gives no sandbox.
export async function startServer({ port = 0, webRoot = path.join(REPO, 'web'), insecure = envInsecure(), tamper = process.env.X2_TAMPER === '1', quiet = true, codeAliases = [] } = {}) {
  const requests = [];                        // { host, method, url }
  let codeHost = null, sandboxHost = null, origins = null;

  function sendFile(res, file, extraHeaders = {}) {
    let st;
    try { st = fs.statSync(file); } catch { return notFound(res); }
    if (st.isDirectory()) return sendFile(res, path.join(file, 'index.html'), extraHeaders);
    let body = fs.readFileSync(file);
    if (tamper && file.includes(path.sep + 'vendor' + path.sep + 'x2' + path.sep) && path.basename(file) === 'sandbox-main.js.gz') {
      body = Buffer.from(body);
      body[body.length >> 1] ^= 0xff;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': body.length, ...extraHeaders });
    res.end(body);
  }
  const notFound = res => { res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); res.end('not found'); };

  async function proxy(req, res, u) {
    const target = u.searchParams.get('url');
    if (!target || !/^https?:\/\//.test(target)) { res.writeHead(400); return res.end('url invalida'); }
    try {
      const r = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (Elffuss Code)' }, signal: AbortSignal.timeout(20000) });
      const reader = r.body.getReader();
      const chunks = []; let n = 0;
      while (n < MAX_PROXY_BYTES) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; }
      reader.cancel().catch(() => {});
      const body = Buffer.concat(chunks).subarray(0, MAX_PROXY_BYTES);
      res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'text/html', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (e) { res.writeHead(502); res.end('proxy: ' + (e?.message || e)); }
  }

  async function forwardLm(req, res) {
    const body = await new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
    try {
      const r = await fetch(LM_UPSTREAM + req.url, { method: req.method, body: body.length ? body : undefined, headers: { 'Content-Type': req.headers['content-type'] || 'application/json' } });
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
      for await (const chunk of r.body) res.write(chunk);
      res.end();
    } catch (e) { res.writeHead(502); res.end('lm: ' + (e?.message || e)); }
  }

  function code(req, res, u) {
    if (u.pathname.startsWith('/x2/')) return notFound(res);               // Code's host never serves the sandbox
    if (u.pathname === '/proxy') return proxy(req, res, u);
    if (u.pathname.startsWith('/v1/')) return forwardLm(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(404); return res.end(); }
    const file = safeJoin(webRoot, u.pathname);
    if (!file) return notFound(res);
    if (u.pathname.startsWith('/vendor/x2/')) {
      return sendFile(res, file, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    }
    return sendFile(res, file, { 'Cache-Control': 'no-store' });
  }

  function sandbox(req, res, u) {
    const spec = loadSpec();
    const name = Object.keys(spec.documents).find(n => spec.documents[n].path === u.pathname);
    if (!name || req.method !== 'GET' || !queryAllowed(name, u.search, origins)) return notFound(res);
    const body = fs.readFileSync(path.join(DOCS_DIR, name));
    const open = insecure === 'all' || (insecure === 'exthost' && name === 'exthost-iframe.html');
    const h = headersFor(name, origins, { insecure: open });
    // the positive control drops the meta CSP as well as the header
    const out = open ? Buffer.from(body.toString('utf8').replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*"\/?>/, '')) : body;
    res.writeHead(200, { ...h, 'Content-Length': out.length });
    res.end(out);
  }

  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || '');
    requests.push({ host, method: req.method, url: req.url });
    let u;
    try { u = new URL(req.url, 'http://' + host); } catch { res.writeHead(400); return res.end(); }
    if (host === codeHost || codeAliases.some(a => host === `${a}:${server.address().port}`)) return code(req, res, u);
    if (host === sandboxHost) return sandbox(req, res, u);
    res.writeHead(421, { 'Content-Type': 'text/plain' }); res.end('unknown host');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const actual = server.address().port;
  // localhost may resolve to ::1 first; serve it there too when the stack allows
  const server6 = http.createServer(server.listeners('request')[0]);
  await new Promise(resolve => { server6.once('error', () => resolve()); server6.listen(actual, '::1', resolve); });
  codeHost = '127.0.0.1:' + actual;
  sandboxHost = 'localhost:' + actual;
  origins = originsFor('dev', { port: actual });
  if (!quiet) console.log(`Code    http://${codeHost}/\nsandbox http://${sandboxHost}/x2/v1/sandbox.html`);
  return {
    port: actual,
    codeOrigin: 'http://' + codeHost,
    sandboxOrigin: 'http://' + sandboxHost,
    requests,
    close: () => Promise.all([new Promise(r => server.close(r)), new Promise(r => (server6.listening ? server6.close(r) : r()))]),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--port');
  await startServer({ port: i > 0 ? Number(process.argv[i + 1]) : 0, quiet: false });
}

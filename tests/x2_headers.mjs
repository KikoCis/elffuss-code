// Headers of the level 2 sandbox, as served. Read-only: only GET requests.
//
//   node tests/x2_headers.mjs
//       against its own test server (tests/lib/x2-server.mjs)
//   X2_SANDBOX=https://x2.utopiaia.com X2_CODE=https://code.elffuss.com node tests/x2_headers.mjs
//       against production, once deploy-sandbox.sh and deploy-vendor.sh ran
//       (it needs nothing from deploy.sh, so it can check before it too)
//
// Checks:
//   H1  both sandbox documents, with their exact query shape: status 200, every
//       header from sandbox/x2/headers.json with exactly its value, and no
//       cookie, no reporting endpoint, no CORS header; the body is the
//       committed document byte for byte;
//   H2  anything else on the sandbox site is a 404: other paths, the documents
//       with any other query (an extra parameter, another parent origin, an
//       upper-case id, none), other methods;
//   H3  Code's site never serves /x2/;
//   H4  the vendor files of the committed manifest on Code's site: octet-stream,
//       immutable for a year, nosniff, never re-compressed, and their SRI holds;
//   H5  a vendor file that is not there is a 404 that is not cached as
//       immutable (a cached failure would outlive the upload);
//   H6  (local only) the generated nginx snippets set the charset the way
//       headers.json says, and the template's vendor location has no
//       `always` on Cache-Control.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { headersFor, originsFor, loadSpec, DOCS_DIR } from '../sandbox/x2/headers.mjs';
import { startServer } from './lib/x2-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (name, c, extra = '') => { console.log((c ? '✅' : '❌') + ' ' + name + (extra ? '  — ' + extra : '')); if (!c) fails++; };

const remote = !!process.env.X2_SANDBOX;
let srv = null, code, sandbox, origins;
if (remote) {
  sandbox = new URL(process.env.X2_SANDBOX).origin;
  code = new URL(process.env.X2_CODE || loadSpec().environments.production.code[0]).origin;
  origins = { code: loadSpec().environments.production.code, sandbox };
} else {
  srv = await startServer();
  code = srv.codeOrigin;
  sandbox = srv.sandboxOrigin;
  origins = originsFor('dev', { port: srv.port });
}
console.log(`Code ${code} · sandbox ${sandbox}`);

const get = (url, opts = {}) => fetch(url, { redirect: 'manual', cache: 'no-store', ...opts });
const uuid = () => crypto.randomUUID();
const exthostQuery = (parent = sandbox, id = uuid()) => `?parentOrigin=${encodeURIComponent(parent)}&vscodeWebWorkerExtHostId=${id}`;
const spec = loadSpec();
const DOC = name => spec.documents[name].path;

// ── H1: los dos documentos ──
for (const [name, query] of [['sandbox.html', ''], ['exthost-iframe.html', exthostQuery()]]) {
  const r = await get(sandbox + DOC(name) + query);
  const body = Buffer.from(await r.arrayBuffer());
  ok(`H1 ${name}: 200`, r.status === 200, String(r.status));
  const want = headersFor(name, origins);
  const wrong = Object.entries(want).filter(([k, v]) => r.headers.get(k) !== v).map(([k, v]) => `${k}: got ${JSON.stringify(r.headers.get(k))}, want ${JSON.stringify(v.slice(0, 80))}…`);
  ok(`H1 ${name}: every header from headers.json, with exactly its value (${Object.keys(want).length})`, !wrong.length, wrong.slice(0, 3).join(' | '));
  const csp = r.headers.get('content-security-policy') || '';
  const fa = /frame-ancestors ([^;]*)/.exec(csp)?.[1].split(/\s+/) || [];
  const wantFa = name === 'exthost-iframe.html' ? ["'self'", ...origins.code] : origins.code;
  ok(`H1 ${name}: framed only by ${name === 'exthost-iframe.html' ? 'the sandbox and ' : ''}Code`, JSON.stringify(fa) === JSON.stringify(wantFa), fa.join(' '));
  const extra = ['set-cookie', 'report-to', 'reporting-endpoints', 'nel', 'access-control-allow-origin', 'content-security-policy-report-only'].filter(k => r.headers.has(k));
  ok(`H1 ${name}: no cookie, no reporting endpoint, no CORS`, !extra.length && !/report-(uri|to)/.test(csp), extra.join(' '));
  const committed = fs.readFileSync(path.join(DOCS_DIR, name));
  ok(`H1 ${name}: the committed document, byte for byte`, body.equals(committed), `${body.length} vs ${committed.length} bytes`);
}

// ── H2: nada más en el sitio del recinto ──
const goodId = uuid();
const notFound = [
  ['/', ''], ['/x2/', ''], ['/x2/v1/', ''], ['/x2/v1/other.html', ''], ['/x2/v2/sandbox.html', ''], ['/X2/v1/sandbox.html', ''],
  ['/x2/v1/sandbox.html/', ''], ['/index.html', ''], ['/js/main.js', ''], ['/robots.txt', ''],
  [DOC('sandbox.html'), '?x=1'], [DOC('sandbox.html'), '?parentOrigin=' + encodeURIComponent(sandbox)],
  [DOC('exthost-iframe.html'), ''],
  [DOC('exthost-iframe.html'), exthostQuery(sandbox, goodId) + '&x=1'],
  [DOC('exthost-iframe.html'), exthostQuery(code, goodId)],
  [DOC('exthost-iframe.html'), exthostQuery('https://evil.invalid', goodId)],
  [DOC('exthost-iframe.html'), exthostQuery(sandbox, goodId.toUpperCase())],
  [DOC('exthost-iframe.html'), exthostQuery(sandbox, 'not-a-uuid')],
  [DOC('exthost-iframe.html'), `?vscodeWebWorkerExtHostId=${goodId}&parentOrigin=${encodeURIComponent(sandbox)}`],
];
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '../web/js/ext2/vendor-manifest.json'), 'utf8'));
notFound.push([`/vendor/x2/${manifest.buildId}/${manifest.files[0].name}.gz`, '']);
const served = [];
for (const [p, q] of notFound) {
  const r = await get(sandbox + p + q);
  await r.arrayBuffer().catch(() => {});
  if (r.status !== 404) served.push(`${p}${q.slice(0, 40)} → ${r.status}`);
}
ok(`H2 on the sandbox site everything else is a 404 (${notFound.length} paths and query shapes)`, !served.length, served.slice(0, 4).join(' | '));
const methods = [];
for (const m of ['POST', 'PUT', 'DELETE']) {
  const r = await get(sandbox + DOC('sandbox.html'), { method: m, body: m === 'DELETE' ? undefined : 'x' });
  await r.arrayBuffer().catch(() => {});
  if (r.status !== 404 && r.status !== 405) methods.push(`${m} → ${r.status}`);
}
ok('H2 other methods are refused (404 or 405)', !methods.length, methods.join(' | '));

// ── H3: el sitio de Code no sirve /x2/ ──
const fromCode = [];
for (const [p, q] of [[DOC('sandbox.html'), ''], [DOC('exthost-iframe.html'), exthostQuery()], ['/x2/', '']]) {
  const r = await get(code + p + q);
  await r.arrayBuffer().catch(() => {});
  if (r.status !== 404) fromCode.push(`${p} → ${r.status}`);
}
ok('H3 Code’s site never serves /x2/', !fromCode.length, fromCode.join(' | '));

// ── H4: el bundle en el sitio de Code ──
const local = path.join(HERE, '../web/vendor/x2', manifest.buildId);
if (!remote && !fs.existsSync(local)) {
  console.log(`⏭️  NOT RUN H4 — web/vendor/x2/${manifest.buildId} is not built here (vendor/vscode-ext2/build.mjs)`);
} else {
  for (const f of manifest.files) {
    const r = await get(`${code}/vendor/x2/${manifest.buildId}/${f.name}.gz`, { headers: { 'Accept-Encoding': 'gzip, br' } });
    const body = Buffer.from(await r.arrayBuffer());
    const sri = 'sha256-' + crypto.createHash('sha256').update(body).digest('base64');
    const h = k => r.headers.get(k) || '';
    const problems = [];
    if (r.status !== 200) problems.push('status ' + r.status);
    if (h('content-type') !== 'application/octet-stream') problems.push('type ' + h('content-type'));
    if (!/max-age=31536000/.test(h('cache-control')) || !/immutable/.test(h('cache-control'))) problems.push('cache ' + h('cache-control'));
    if (h('x-content-type-options') !== 'nosniff') problems.push('no nosniff');
    if (r.headers.has('content-encoding')) problems.push('re-compressed: ' + h('content-encoding'));
    if (sri !== f.sriGz) problems.push('SRI does not match the manifest');
    if (body.length !== f.gz) problems.push(`${body.length} bytes, manifest says ${f.gz}`);
    ok(`H4 ${f.name}.gz: octet-stream, immutable, nosniff, not re-compressed, SRI as in the manifest`, !problems.length, problems.join(' | '));
  }
}

// ── H5: un fichero del bundle que no está es un 404 que NO se guarda un año ──
// (con «always» en el Cache-Control de nginx, el fallo quedaría en la caché
// del navegador como inmutable, y el buildId es un hash: subir luego los
// mismos bytes no lo arreglaría)
{
  const r = await get(`${code}/vendor/x2/ffffffffffffffff/sandbox-main.js.gz`);
  await r.arrayBuffer().catch(() => {});
  const cc = r.headers.get('cache-control') || '';
  ok('H5 a missing vendor file: 404, and not cached as immutable', r.status === 404 && !/immutable|max-age=[1-9]/.test(cc), `${r.status} cache-control: ${JSON.stringify(cc)}`);
}

// ── H6: lo que se genera para nginx dice lo mismo que headers.json ──
if (!remote) {
  const { nginx } = await import('../sandbox/x2/headers.mjs');
  const conf = nginx('https://x2.sandbox.example');
  ok('H6 the nginx snippets set the charset (charset utf-8;), not default_type, and every header with always',
    (conf.match(/^charset utf-8;$/gm) || []).length === 2 && !/default_type/.test(conf) && (conf.match(/^add_header /gm) || []).every(Boolean)
    && (conf.match(/^add_header .* always;$/gm) || []).length === (conf.match(/^add_header /gm) || []).length, conf.slice(0, 200));
  const example = fs.readFileSync(path.join(HERE, '../sandbox/x2/nginx.conf.example'), 'utf8');
  const vendorBlock = /location \^~ \/vendor\/x2\/ \{[\s\S]*?\}/.exec(example)?.[0] || '';
  ok('H6 the template for Code’s vendor location adds Cache-Control only to successful responses (no always)',
    /add_header Cache-Control "public, max-age=31536000, immutable";/.test(vendorBlock) && !/Cache-Control[^\n]*always/.test(vendorBlock), vendorBlock.replace(/\s+/g, ' ').slice(0, 200));
  // el vhost del recinto nombra el mismo host que headers.json (y config.js)
  const prodHost = new URL(spec.environments.production.sandbox).hostname;
  const esc = prodHost.replace(/\./g, '\\.');
  const names = [...example.matchAll(/^\s*server_name ([^;]+);/gm)].map(m => m[1]);
  ok(`H6 the sandbox vhost of the template is ${prodHost}: server name, certificate, folder and the extension-host query`,
    names.length === 2 && names.every(n => n === prodHost)
    && example.includes(`/etc/letsencrypt/live/${prodHost}/fullchain.pem`) && example.includes(`root /var/www/${prodHost};`)
    && example.includes(`parentOrigin=https%3A%2F%2F${esc}&vscodeWebWorkerExtHostId=`), JSON.stringify(names));
}

await srv?.close();
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

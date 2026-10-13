#!/usr/bin/env node
// Headers of the two sandbox documents, generated from headers.json (the only
// source). Used by the test server (tests/lib/x2-server.mjs), by the unit
// tests, and to print the nginx snippets for production.
//
//   node sandbox/x2/headers.mjs --check
//       the documents' inline scripts match their pinned hashes, the meta CSPs
//       match headers.json, no fetch directive names a host, and (when the
//       vendor build folder is installed) exthost-iframe.html equals the
//       library's copy apart from its CSP meta
//   node sandbox/x2/headers.mjs --pin
//       recompute sandbox.html's bootstrap hash and write it to headers.json
//       and to the document's meta CSP
//   node sandbox/x2/headers.mjs --nginx [--sandbox https://x2.<domain>]
//       print snippets/x2-sandbox.conf and snippets/x2-exthost.conf for the
//       production sandbox of headers.json (https://x2.utopiaia.com), or for
//       the one given (refused when it is not the one headers.json and
//       config.js name, or is the same site as Code)
//   node sandbox/x2/headers.mjs --site-check [https://x2.<domain>]
//       that sandbox origin (by default headers.json's) is another registrable
//       domain than every Code origin, and both headers.json and
//       web/js/ext2/config.js name it (deploy-sandbox.sh)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
export const DOCS_DIR = path.join(HERE, 'v1');
// fetch directives: none of them may carry a host or a scheme that reaches one
const FETCH_DIRECTIVES = ['default-src', 'script-src', 'worker-src', 'child-src', 'connect-src', 'img-src', 'font-src', 'style-src', 'media-src', 'object-src', 'manifest-src'];
const ALLOWED_SOURCES = new Set(["'none'", "'self'", 'blob:', 'data:', "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"]);

export function loadSpec() {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'headers.json'), 'utf8'));
}

export const inlineScripts = html => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
export const sha256Source = text => "'sha256-" + crypto.createHash('sha256').update(text, 'utf8').digest('base64') + "'";

const fill = (s, vars) => s.replace(/\{(sandbox|code|self-script|sandbox-uri)\}/g, (_, k) => vars[k]);

function vars(doc, { sandbox, code }) {
  if (!sandbox) throw new Error('the sandbox origin is not set');
  return {
    sandbox,
    code: code.join(' '),
    'self-script': "'" + doc.inlineScript + "'",
    'sandbox-uri': encodeURIComponent(sandbox).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  };
}

export function cspFor(name, origins, { meta = false } = {}) {
  const spec = loadSpec();
  const doc = spec.documents[name];
  const v = vars(doc, origins);
  return doc.csp
    .filter(d => !(meta && d.startsWith('frame-ancestors')))
    .map(d => (meta && d.startsWith('frame-src') && doc.metaFrameSrc ? 'frame-src ' + doc.metaFrameSrc : fill(d, v)))
    .join('; ');
}

export function headersFor(name, origins, { insecure = false } = {}) {
  const spec = loadSpec();
  const h = { ...spec.common };
  if (!insecure) h['Content-Security-Policy'] = cspFor(name, origins);
  return h;
}

export function queryAllowed(name, search, origins) {
  const spec = loadSpec();
  const doc = spec.documents[name];
  const q = search.startsWith('?') ? search.slice(1) : search;
  return new RegExp(fill(doc.query, vars(doc, origins))).test(q);
}

export function originsFor(env, { port, sandbox } = {}) {
  const e = loadSpec().environments[env];
  if (!e) throw new Error('unknown environment ' + env);
  const p = s => s && s.replace('{port}', String(port));
  return { code: e.code.map(p), sandbox: sandbox || p(e.sandbox) };
}

// The meta CSP each document must carry: the header policy without
// frame-ancestors (a meta tag cannot carry it), with frame-src 'self' where
// the header names the exact document of the sandbox origin.
export function expectedMeta(name) {
  return cspFor(name, { sandbox: 'https://sandbox.invalid', code: ['https://code.invalid'] }, { meta: true });
}
export const metaOf = html => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? null;

export function check() {
  const spec = loadSpec();
  const problems = [];
  for (const [name, doc] of Object.entries(spec.documents)) {
    const html = fs.readFileSync(path.join(DOCS_DIR, name), 'utf8');
    const scripts = inlineScripts(html);
    if (scripts.length !== 1) problems.push(`${name}: expected exactly one inline script, found ${scripts.length}`);
    else if (sha256Source(scripts[0]) !== "'" + doc.inlineScript + "'") problems.push(`${name}: inline script hash ${sha256Source(scripts[0])} is not the pinned ${doc.inlineScript}`);
    if (/<script[^>]+src=/i.test(html)) problems.push(`${name}: loads a script by URL`);
    if (metaOf(html) !== expectedMeta(name)) problems.push(`${name}: meta CSP differs from headers.json`);
    for (const d of doc.csp) {
      const [dir, ...srcs] = d.split(/\s+/);
      if (!FETCH_DIRECTIVES.includes(dir)) continue;
      for (const s of srcs) if (!ALLOWED_SOURCES.has(s) && !s.startsWith('{self-script}')) problems.push(`${name}: ${dir} names ${s}`);
    }
  }
  // exthost-iframe.html = the library's document apart from the CSP meta
  const lib = path.join(REPO, 'vendor/vscode-ext2/node_modules', spec.documents['exthost-iframe.html'].library);
  if (fs.existsSync(lib)) {
    const strip = h => h.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*"\/?>/, '<meta CSP>');
    const ours = fs.readFileSync(path.join(DOCS_DIR, 'exthost-iframe.html'), 'utf8');
    if (strip(ours) !== strip(fs.readFileSync(lib, 'utf8'))) problems.push('exthost-iframe.html: differs from the library copy beyond the CSP meta');
  }
  return problems;
}

function pin() {
  const spec = loadSpec();
  const file = path.join(DOCS_DIR, 'sandbox.html');
  let html = fs.readFileSync(file, 'utf8');
  const [script] = inlineScripts(html);
  spec.documents['sandbox.html'].inlineScript = sha256Source(script).slice(1, -1);
  fs.writeFileSync(path.join(HERE, 'headers.json'), JSON.stringify(spec, null, 2) + '\n');
  html = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/, `$1${expectedMeta('sandbox.html')}$2`);
  fs.writeFileSync(file, html);
  console.log('pinned ' + spec.documents['sandbox.html'].inlineScript);
}

// The nginx snippets. Content-Type comes from nginx's own mime types (the
// documents are .html): `charset utf-8;` adds "; charset=utf-8" to it, as
// headers.json asks. (`default_type` would only apply to unknown extensions.)
export function nginx(sandbox) {
  const spec = loadSpec();
  const code = spec.environments.production.code;
  const out = [];
  for (const [name, file] of [['sandbox.html', 'x2-sandbox.conf'], ['exthost-iframe.html', 'x2-exthost.conf']]) {
    out.push(`# snippets/${file} (generated by sandbox/x2/headers.mjs from headers.json)`);
    for (const [k, v] of Object.entries(headersFor(name, { sandbox, code }))) {
      if (k === 'Content-Type') {
        if (!/^text\/html; charset=utf-8$/i.test(v)) throw new Error('headers.json: Content-Type must be text/html; charset=utf-8');
        out.push('charset utf-8;');
      } else out.push(`add_header ${k} "${v.replace(/"/g, '\\"')}" always;`);
    }
    out.push('');
  }
  return out.join('\n');
}

// The sandbox must be ANOTHER SITE than every Code origin (another
// registrable domain), or it would share cookies and a process with Code.
// web/js/ext2/config.js refuses a same-site sandbox at run time; this refuses
// it before anything is deployed.
export const productionSandbox = () => loadSpec().environments.production.sandbox || null;

export async function siteProblems(sandbox) {
  const { sameSite, sandboxOrigin } = await import('../../web/js/ext2/config.js');
  const problems = [];
  let u;
  try { u = new URL(sandbox); } catch { return ['not a URL: ' + sandbox]; }
  if (u.protocol !== 'https:' || u.origin !== sandbox.replace(/\/$/, '')) problems.push('the sandbox origin must be https://host, with nothing after it: ' + sandbox);
  const named = productionSandbox();
  if (named !== u.origin) problems.push(`sandbox/x2/headers.json names ${named || 'no sandbox'} for production, not ${u.origin}`);
  for (const code of loadSpec().environments.production.code) {
    if (sameSite(code, u.origin)) problems.push(`${u.origin} is the same site as ${code}: use another registrable domain`);
    const c = new URL(code);
    const configured = sandboxOrigin({ hostname: c.hostname, origin: c.origin, port: c.port });
    if (configured !== u.origin) problems.push(`web/js/ext2/config.js names ${configured || 'no sandbox'} for ${c.hostname}, not ${u.origin}`);
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--pin')) pin();
  // the origin after a flag, or headers.json's production sandbox when none is given
  const after = flag => { const v = args[args.indexOf(flag) + 1]; return v && !v.startsWith('--') ? v : null; };
  if (args.includes('--site-check')) {
    const s = after('--site-check') || productionSandbox() || '';
    const problems = await siteProblems(s);
    for (const p of problems) console.error('  ✗ ' + p);
    console.log(problems.length ? `${problems.length} problems` : `${s} is another site than Code`);
    process.exit(problems.length ? 1 : 0);
  }
  if (args.includes('--nginx')) {
    const s = (args.includes('--sandbox') ? after('--sandbox') : productionSandbox()) || '';
    if (!/^https:\/\/[a-z0-9.-]+$/.test(s)) { console.error('--nginx needs a sandbox origin https://x2.<domain> (headers.json or --sandbox)'); process.exit(2); }
    const problems = await siteProblems(s);
    if (problems.length) { for (const p of problems) console.error('  ✗ ' + p); process.exit(1); }
    process.stdout.write(nginx(s));
  }
  if (args.includes('--check') || !args.length) {
    const problems = check();
    for (const p of problems) console.error('  ✗ ' + p);
    console.log(problems.length ? `${problems.length} problems` : 'sandbox documents match headers.json');
    process.exit(problems.length ? 1 : 0);
  }
}

#!/usr/bin/env node
// Checks a built vendor folder against web/js/ext2/vendor-manifest.json:
// exactly the files the manifest names and nothing else, the SRI of every
// .gz, the sha256 of every inflated file and of LICENSES.txt, and the path
// sweep.
//
//   node check-output.mjs [<web dir>]
//       the local build folder (deploy-vendor.sh runs it before uploading)
//   node check-output.mjs --sums [<web dir>]
//       the sha256 of each file as `sha256sum` prints it, from the local
//       files once they are checked
//   node check-output.mjs --files [<web dir>]
//       the names of the files the manifest names, one per line (what
//       deploy-vendor.sh uploads)
//   node check-output.mjs --manifest-sums [<web dir>]
//       the sums `sha256sum` must print on the server, from the manifest
//       alone (no local build needed: deploy.sh uses it)
//   node check-output.mjs --live [<web dir>]
//       exit 0 when browsers will ask for this build: the manifest is enabled
//       and web/js/ext2/config.js names a sandbox for a production Code origin
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sweepBuffers } from './sweep.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const readManifest = webDir => JSON.parse(fs.readFileSync(path.join(webDir, 'js/ext2/vendor-manifest.json'), 'utf8'));
export const fileNames = manifest => [...manifest.files.map(f => f.name + '.gz'), manifest.licenses.name].sort();

// lo que `sha256sum` tiene que dar en el servidor, sacado solo del manifiesto
export function manifestSums(manifest) {
  const sums = manifest.files.map(f => `${Buffer.from(f.sriGz.replace(/^sha256-/, ''), 'base64').toString('hex')}  ${f.name}.gz`);
  sums.push(`${manifest.licenses.sha256}  ${manifest.licenses.name}`);
  return sums.sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : 1));
}

export function checkOutput(webDir) {
  const manifest = readManifest(webDir);
  const dir = path.join(webDir, 'vendor/x2', manifest.buildId);
  const problems = [];
  const sums = [];
  const swept = [];
  // nada más que lo que nombra el manifiesto: otro fichero junto al bundle
  // (un .DS_Store, unas notas, una copia del editor) no se ha barrido
  let present = [];
  try { present = fs.readdirSync(dir); } catch { problems.push(`${dir} does not exist`); }
  const named = new Set(fileNames(manifest));
  for (const f of present) if (!named.has(f)) problems.push(`${f} is not in the manifest (remove it: only the manifest's files are deployed)`);
  for (const f of manifest.files) {
    let gz;
    try { gz = fs.readFileSync(path.join(dir, f.name + '.gz')); } catch { problems.push(`${f.name}.gz is missing`); continue; }
    const digest = crypto.createHash('sha256').update(gz).digest();
    if ('sha256-' + digest.toString('base64') !== f.sriGz) problems.push(`${f.name}.gz does not match its SRI`);
    if (gz.length !== f.gz) problems.push(`${f.name}.gz is ${gz.length} bytes, the manifest says ${f.gz}`);
    let raw;
    try { raw = zlib.gunzipSync(gz); } catch (e) { problems.push(`${f.name}.gz does not inflate (${String(e.message || e).slice(0, 80)})`); continue; }
    if (crypto.createHash('sha256').update(raw).digest('hex') !== f.sha256Raw) problems.push(`${f.name} does not match its sha256`);
    sums.push(`${digest.toString('hex')}  ${f.name}.gz`);
    swept.push({ name: f.name, bytes: raw });
  }
  let lic = null;
  try { lic = fs.readFileSync(path.join(dir, manifest.licenses.name)); } catch { problems.push(manifest.licenses.name + ' is missing'); }
  if (lic) {
    const h = crypto.createHash('sha256').update(lic).digest('hex');
    if (h !== manifest.licenses.sha256) problems.push(manifest.licenses.name + ' does not match its sha256');
    sums.push(`${h}  ${manifest.licenses.name}`);
    swept.push({ name: manifest.licenses.name, bytes: lic });
  }
  const allow = JSON.parse(fs.readFileSync(path.join(HERE, 'sweep-allowlist.json'), 'utf8'));
  const report = sweepBuffers(swept, allow, { buildRoot: HERE });
  problems.push(...report.problems);
  return { manifest, dir, problems, sums: sums.sort((a, b) => (a.slice(66) < b.slice(66) ? -1 : 1)) };
}

// ¿Pedirá algún navegador este bundle? Solo si el manifiesto está encendido y
// config.js da un recinto a algún origen de producción de Code.
export async function live(webDir) {
  const manifest = readManifest(webDir);
  if (!manifest.enabled) return false;
  const { sandboxOrigin } = await import(pathToFileURL(path.join(webDir, 'js/ext2/config.js')).href);
  const spec = JSON.parse(fs.readFileSync(path.join(HERE, '../../sandbox/x2/headers.json'), 'utf8'));
  return spec.environments.production.code.some(o => { const u = new URL(o); return !!sandboxOrigin({ hostname: u.hostname, origin: u.origin, port: u.port }); });
}

// (por su ruta real: /var y /tmp son enlaces en macOS)
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const webDir = path.resolve(args.find(a => !a.startsWith('--')) || path.join(HERE, '../../web'));
  if (args.includes('--files')) { for (const f of fileNames(readManifest(webDir))) console.log(f); process.exit(0); }
  if (args.includes('--manifest-sums')) { for (const s of manifestSums(readManifest(webDir))) console.log(s); process.exit(0); }
  if (args.includes('--live')) process.exit((await live(webDir)) ? 0 : 3);
  const r = checkOutput(webDir);
  if (args.includes('--sums')) { if (!r.problems.length) for (const s of r.sums) console.log(s); }
  else console.log(`${r.manifest.buildId}: ${r.problems.length ? r.problems.length + ' problems' : 'matches the manifest, sweep passed'}`);
  for (const p of r.problems) console.error('  ✗ ' + p);
  process.exit(r.problems.length ? 1 : 0);
}

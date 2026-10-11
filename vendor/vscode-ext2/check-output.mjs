#!/usr/bin/env node
// Checks a built vendor folder against web/js/ext2/vendor-manifest.json:
// the SRI of every .gz, the sha256 of every inflated file and of
// LICENSES.txt, and the path sweep. With --sums it prints the sha256 of each
// file as `sha256sum` would, so deploy-vendor.sh can compare the server's copy.
//
//   node check-output.mjs [--sums] [<web dir>]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sweepBuffers } from './sweep.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function checkOutput(webDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(webDir, 'js/ext2/vendor-manifest.json'), 'utf8'));
  const dir = path.join(webDir, 'vendor/x2', manifest.buildId);
  const problems = [];
  const sums = [];
  const swept = [];
  for (const f of manifest.files) {
    let gz;
    try { gz = fs.readFileSync(path.join(dir, f.name + '.gz')); } catch { problems.push(`${f.name}.gz is missing`); continue; }
    const digest = crypto.createHash('sha256').update(gz).digest();
    if ('sha256-' + digest.toString('base64') !== f.sriGz) problems.push(`${f.name}.gz does not match its SRI`);
    if (gz.length !== f.gz) problems.push(`${f.name}.gz is ${gz.length} bytes, the manifest says ${f.gz}`);
    const raw = zlib.gunzipSync(gz);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const webDir = path.resolve(args.find(a => !a.startsWith('--')) || path.join(HERE, '../../web'));
  const r = checkOutput(webDir);
  if (args.includes('--sums')) { for (const s of r.sums) console.log(s); }
  else console.log(`${r.manifest.buildId}: ${r.problems.length ? r.problems.length + ' problems' : 'matches the manifest, sweep passed'}`);
  for (const p of r.problems) console.error('  ✗ ' + p);
  process.exit(r.problems.length ? 1 : 0);
}

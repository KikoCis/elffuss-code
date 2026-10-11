#!/usr/bin/env node
// Path sweep for the level 2 vendor bundle: no file that leaves this machine
// may carry a path of the machine that built it.
//
//   node sweep.mjs                    sweep web/vendor/x2/<buildId>/ named by the manifest
//   node sweep.mjs <dir>              sweep every file in <dir> (.gz files are inflated first)
//   node sweep.mjs --list [<dir>]     print every hit with its context, to review an allowlist change
//
// Always fatal, wherever they appear: the user name, the home folder and the
// absolute build folder. Generic patterns (home prefixes of macOS, Linux and
// Windows, file:// and sourceMappingURL) are fatal unless the exact hit is in
// sweep-allowlist.json, which stores the sha256 of each hit's context and how
// many times it appears: a new hit or a changed count fails the sweep. Base64
// data: URLs are decoded and their printable strings swept too, the way
// `strings` would see them.
//
// The patterns are assembled at run time, so this file (like every committed
// file) contains none of them literally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const S = '/';
const B = '\\';

export function patterns() {
  return [
    { id: 'mac-home', re: new RegExp(S + 'Users' + S, 'g') },
    { id: 'linux-home', re: new RegExp(S + 'home' + S, 'g') },
    { id: 'windows-home', re: new RegExp('[A-Za-z]:' + B + B + '+Users' + B + B, 'g') },
    { id: 'file-url', re: new RegExp('file:' + S + S, 'g') },
    { id: 'source-map', re: new RegExp('source' + 'MappingURL', 'g') },
  ];
}

function fatalNeedles(buildRoot) {
  const out = [];
  const add = (label, v) => { if (typeof v === 'string' && v.length >= 3) out.push({ label, needle: v }); };
  let user = '';
  try { user = os.userInfo().username; } catch { /* no user database */ }
  add('user name', user);
  add('home folder', os.homedir());
  add('build folder', buildRoot && path.resolve(buildRoot));
  add('repository folder', buildRoot && path.resolve(buildRoot, '../..'));
  return out;
}

// printable runs of 4+ bytes, as `strings` prints them
function printable(bytes) {
  let s = '', run = '';
  for (const b of bytes) {
    if (b >= 0x20 && b < 0x7f) run += String.fromCharCode(b);
    else { if (run.length >= 4) s += run + '\n'; run = ''; }
  }
  if (run.length >= 4) s += run + '\n';
  return s;
}

// The text views of one file: itself, plus the printable strings of every
// base64 data: URL inside it.
function views(name, bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const out = [{ where: name, text }];
  const re = /data:[\w.+-]+\/[\w.+-]+(?:;[\w.+-]+=[\w.+-]+)*;base64,([A-Za-z0-9+/=]+)/g;
  let m, k = 0;
  while ((m = re.exec(text))) {
    const decoded = Buffer.from(m[1], 'base64');
    out.push({ where: `${name}#data${k++}`, text: printable(decoded) });
  }
  return out;
}

const CONTEXT = 40;
const contextHash = (where, id, text, i, len) =>
  crypto.createHash('sha256').update(`${where}\0${id}\0${text.slice(Math.max(0, i - CONTEXT), i + len + CONTEXT)}`).digest('hex');

export function collectHits(files) {
  const hits = new Map();                     // key → { file, pattern, context, count, sample }
  for (const { name, bytes } of files) {
    for (const v of views(name, bytes)) {
      for (const { id, re } of patterns()) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(v.text))) {
          const context = contextHash(v.where.replace(/#data\d+$/, '#data'), id, v.text, m.index, m[0].length);
          const key = `${name}|${id}|${context}`;
          const h = hits.get(key) || { file: name, pattern: id, context, count: 0, sample: v.text.slice(Math.max(0, m.index - CONTEXT), m.index + m[0].length + CONTEXT) };
          h.count++;
          hits.set(key, h);
        }
      }
    }
  }
  return [...hits.values()];
}

export function sweepBuffers(files, allowlist, { buildRoot = HERE } = {}) {
  const problems = [];
  for (const { name, bytes } of files) {
    for (const v of views(name, bytes)) {
      for (const { label, needle } of fatalNeedles(buildRoot)) {
        if (v.text.includes(needle)) problems.push(`${v.where}: contains the ${label}`);
      }
    }
  }
  const allowed = new Map((allowlist?.hits || []).map(h => [`${h.file}|${h.pattern}|${h.context}`, h]));
  const seen = new Set();
  const hits = collectHits(files);
  for (const h of hits) {
    const key = `${h.file}|${h.pattern}|${h.context}`;
    const a = allowed.get(key);
    seen.add(key);
    if (!a) problems.push(`${h.file}: new ${h.pattern} hit (${h.count}×), not in sweep-allowlist.json`);
    else if (a.count !== h.count) problems.push(`${h.file}: ${h.pattern} hit "${a.why}" appears ${h.count}×, the allowlist says ${a.count}×`);
  }
  const names = new Set(files.map(f => f.name));
  for (const [key, a] of allowed) {
    if (!seen.has(key) && names.has(a.file)) problems.push(`${a.file}: allowed ${a.pattern} hit "${a.why}" is gone; update sweep-allowlist.json`);
  }
  return { ok: problems.length === 0, problems, hits };
}

// files of a folder; .gz inflated and named without the suffix
export function readDir(dir) {
  return fs.readdirSync(dir).sort().filter(n => fs.statSync(path.join(dir, n)).isFile()).map(n => {
    const bytes = fs.readFileSync(path.join(dir, n));
    return n.endsWith('.gz') ? { name: n.slice(0, -3), bytes: zlib.gunzipSync(bytes) } : { name: n, bytes };
  });
}

function defaultDir() {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, '../../web/js/ext2/vendor-manifest.json'), 'utf8'));
  return path.join(HERE, '../../web/vendor/x2', manifest.buildId);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const list = args.includes('--list');
  const dir = args.find(a => !a.startsWith('--')) || defaultDir();
  const files = readDir(dir);
  const allow = JSON.parse(fs.readFileSync(path.join(HERE, 'sweep-allowlist.json'), 'utf8'));
  const report = sweepBuffers(files, allow, { buildRoot: HERE });
  if (list) for (const h of report.hits) console.log(JSON.stringify({ file: h.file, pattern: h.pattern, context: h.context, count: h.count }), '\n   ', JSON.stringify(h.sample));
  console.log(`swept ${files.length} files in ${path.basename(dir)}: ${report.hits.length} distinct generic hits, ${report.problems.length} problems`);
  for (const p of report.problems) console.log('  ✗ ' + p);
  process.exit(report.ok ? 0 : 1);
}

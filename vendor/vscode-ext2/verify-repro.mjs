#!/usr/bin/env node
// Reproducibility check for the level 2 vendor bundle.
//
//   node verify-repro.mjs [--keep]
//
// Copies the build inputs into two fresh temporary folders with different
// absolute paths, runs `npm ci --ignore-scripts` and `node build.mjs --out …`
// in each, and requires:
//   - byte-identical outputs from the two builds (every .gz, LICENSES.txt and
//     the manifest);
//   - that output equal to the committed web/js/ext2/vendor-manifest.json;
//   - the path sweep passing in both (build.mjs runs it, with each temporary
//     folder as a forbidden needle).
// It refuses to start with less than 15 GB of free disk. The temporary
// folders go under $X2_REPRO_TMP when set, else under the system temp folder,
// and are removed afterwards unless --keep is given.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const MIN_FREE = 15 * 1024 ** 3;
const INPUTS = ['package.json', 'package-lock.json', '.npmrc', '.node-version', 'vite.config.mjs', 'build.mjs', 'postbuild.mjs', 'sweep.mjs', 'sweep-allowlist.json', 'src'];

function freeBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

function listFiles(dir, rel = '') {
  const out = [];
  for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? rel + '/' + name : name;
    if (fs.statSync(path.join(dir, r)).isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out;
}

function prepare(base, label) {
  const dir = fs.mkdtempSync(path.join(base, `x2-repro-${label}-`));
  const work = path.join(dir, label === 'a' ? 'w' : 'another-work-folder');
  return { dir, work, out: path.join(dir, 'out') };
}

function buildIn({ work, out }) {
  fs.mkdirSync(work, { recursive: true });
  for (const f of INPUTS) fs.cpSync(path.join(HERE, f), path.join(work, f), { recursive: true });
  const env = { ...process.env, npm_config_update_notifier: 'false' };
  execFileSync('npm', ['ci', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: work, env, stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync(process.execPath, ['build.mjs', '--out', out], { cwd: work, env, stdio: ['ignore', 'pipe', 'inherit'] });
}

function main() {
  const keep = process.argv.includes('--keep');
  const base = path.resolve(process.env.X2_REPRO_TMP || os.tmpdir());
  fs.mkdirSync(base, { recursive: true });
  const free = freeBytes(base);
  if (free < MIN_FREE) throw new Error(`only ${(free / 1024 ** 3).toFixed(1)} GB free; this check needs at least 15 GB`);

  const runs = [];
  try {
    for (const label of ['a', 'b']) { const r = prepare(base, label); runs.push(r); buildIn(r); }
    const [a, b] = runs;
    const fa = listFiles(a.out), fb = listFiles(b.out);
    const problems = [];
    if (JSON.stringify(fa) !== JSON.stringify(fb)) problems.push(`different file lists:\n    ${fa.join(', ')}\n    ${fb.join(', ')}`);
    for (const f of fa) {
      if (!fb.includes(f)) continue;
      if (!fs.readFileSync(path.join(a.out, f)).equals(fs.readFileSync(path.join(b.out, f)))) problems.push(`${f} differs between the two builds`);
    }
    const committed = fs.readFileSync(path.join(REPO, 'web/js/ext2/vendor-manifest.json'));
    const built = fs.readFileSync(path.join(a.out, 'js/ext2/vendor-manifest.json'));
    if (!committed.equals(built)) problems.push('the rebuilt manifest differs from the committed web/js/ext2/vendor-manifest.json');
    const manifest = JSON.parse(built);
    if (problems.length) throw new Error('NOT reproducible:\n  ' + problems.join('\n  '));
    console.log(`reproducible: buildId ${manifest.buildId}, ${fa.length} files byte-identical across two clean builds in different folders, equal to the committed manifest; sweep passed in both`);
  } finally {
    if (!keep) for (const r of runs) fs.rmSync(r.dir, { recursive: true, force: true });
  }
}

try { main(); } catch (e) { console.error(String(e?.message || e)); process.exit(1); }

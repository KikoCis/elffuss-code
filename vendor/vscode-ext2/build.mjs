#!/usr/bin/env node
// Builds the level 2 vendor bundle for Elffuss Code.
//
//   npm ci --ignore-scripts      (once; npm never runs anywhere else in the repo)
//   node build.mjs               → web/vendor/x2/<buildId>/ + web/js/ext2/vendor-manifest.json
//   node build.mjs --out <dir>   → <dir>/vendor/x2/<buildId>/ + <dir>/js/ext2/vendor-manifest.json
//
// Steps: refuse to run on another Node version or with installed packages that
// differ from the pins; one Vite build per entry (one ES module file each, every
// asset inlined, no source map); then postbuild.mjs (gzip, hashes, buildId,
// licences, manifest) and sweep.mjs (no machine paths). Any failure stops the
// build before anything is written to the output folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');

export function checkToolchain() {
  const want = fs.readFileSync(path.join(HERE, '.node-version'), 'utf8').trim();
  if (process.versions.node !== want) {
    throw new Error(`This build only runs on Node ${want} (this is ${process.versions.node}): the output must be byte-identical everywhere.`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(HERE, 'package-lock.json'), 'utf8'));
  const bad = [];
  for (const [name, spec] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const alias = /^npm:(@?[^@]+)@(.+)$/.exec(spec);
    const realName = alias ? alias[1] : name;
    const version = alias ? alias[2] : spec;
    if (!/^\d+\.\d+\.\d+$/.test(version)) bad.push(`${name}: "${spec}" is not an exact version`);
    let installed = null;
    try { installed = JSON.parse(fs.readFileSync(path.join(HERE, 'node_modules', name, 'package.json'), 'utf8')); } catch { /* missing */ }
    if (!installed) { bad.push(`${name} is not installed (run npm ci --ignore-scripts)`); continue; }
    if (installed.name !== realName || installed.version !== version) bad.push(`${name}: installed ${installed.name}@${installed.version}, pinned ${realName}@${version}`);
  }
  // every package npm put in node_modules must be the one the lockfile names
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    if (!key || entry.optional) continue;
    let installed = null;
    try { installed = JSON.parse(fs.readFileSync(path.join(HERE, key, 'package.json'), 'utf8')); } catch { /* missing */ }
    if (!installed) bad.push(`${key} is missing (run npm ci --ignore-scripts)`);
    else if (installed.version !== entry.version) bad.push(`${key}: installed ${installed.version}, lockfile ${entry.version}`);
  }
  if (bad.length) throw new Error('Installed packages do not match the pins:\n  ' + bad.join('\n  '));
}

export async function buildRaw(rawDir) {
  const { build } = await import('vite');
  const { ENTRIES, configFor } = await import('./vite.config.mjs');
  fs.rmSync(rawDir, { recursive: true, force: true });
  const out = {};
  for (const entry of ENTRIES) {
    const dir = path.join(rawDir, entry);
    await build(configFor(entry, { outDir: dir }));
    const files = fs.readdirSync(dir).sort();
    const js = files.filter(f => f.endsWith('.js'));
    const extra = files.filter(f => !f.endsWith('.js') && !f.endsWith('.licenses.json'));
    if (js.length !== 1 || js[0] !== entry + '.js' || extra.length) {
      throw new Error(`${entry}: expected exactly one file ${entry}.js, got ${files.join(', ')}`);
    }
    out[entry] = { file: path.join(dir, entry + '.js'), licenses: JSON.parse(fs.readFileSync(path.join(dir, entry + '.licenses.json'), 'utf8')) };
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outRoot = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(REPO, 'web');
  checkToolchain();
  const rawDir = path.join(HERE, '.build', 'raw');
  const raw = await buildRaw(rawDir);
  const { postbuild } = await import('./postbuild.mjs');
  const result = await postbuild(raw, { outRoot, buildRoot: HERE });
  console.log(`buildId ${result.manifest.buildId}: ${result.manifest.files.map(f => `${f.name} ${f.raw} raw, ${f.gz} gz`).join('; ')}; total ${result.totalGz} gz`);
  console.log('manifest: ' + path.relative(process.cwd(), result.manifestPath));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('BUILD FAILED: ' + (e?.message || e)); process.exit(1); });
}

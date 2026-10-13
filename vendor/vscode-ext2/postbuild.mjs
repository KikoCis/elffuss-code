// Post-build for the level 2 vendor bundle (called by build.mjs).
//
// 1. Sweep the raw files for machine paths (sweep.mjs); nothing is written if
//    the sweep fails.
// 2. Gzip each file at level 9 into a gzip container written here, so the
//    header carries no time stamp and no OS byte.
// 3. sha256 of every raw file, SRI (sha256-…) of every .gz.
// 4. buildId = first 16 hex characters of the sha256 over the sorted
//    [name, sha256] list: the folder name changes exactly when the bytes do.
// 5. Write <outRoot>/vendor/x2/<buildId>/{*.js.gz, LICENSES.txt} (git-ignored)
//    and <outRoot>/js/ext2/vendor-manifest.json (committed, a few KB).
// 6. Fail if the three .gz files together exceed the size budget.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { sweepBuffers } from './sweep.mjs';

export const BUDGET_GZ = 2_800_000;           // bytes, the three .gz files together
export const ROLES = { 'sandbox-main': 'main', 'exthost-worker': 'extensionHostWorkerMain', 'editor-worker': 'editorWorkerService' };
export const PROTOCOL = 1;

const sha256 = buf => crypto.createHash('sha256').update(buf).digest();
const hex = buf => sha256(buf).toString('hex');

// RFC 1952 container around zlib's raw deflate: ID1 ID2 CM FLG, MTIME = 0,
// XFL = 2 (maximum compression), OS = 255 (unknown); then CRC32 and ISIZE.
export function gzip(raw) {
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x02, 0xff]);
  const body = zlib.deflateRawSync(raw, { level: 9, memLevel: 9, windowBits: 15, strategy: zlib.constants.Z_DEFAULT_STRATEGY });
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(zlib.crc32(raw) >>> 0, 0);
  trailer.writeUInt32LE(raw.length % 0x100000000, 4);
  return Buffer.concat([header, body, trailer]);
}

// Packages that publish no licence file of their own. The @codingame
// packages are VS Code's own code (MIT, Microsoft) repackaged by CodinGame
// (MIT).
const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export function licensesText(entries, { vscode }) {
  const byKey = new Map();
  for (const e of entries) byKey.set(`${e.name}@${e.version}`, e);
  const list = [...byKey.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
  const out = [
    'Elffuss Code: level 2 extension runtime (vendor bundle)',
    '',
    'These files bundle the packages listed below, unmodified apart from',
    'minification. The following are NOT included: jschardet, @vscode/iconv-lite-umd,',
    '@vscode/diff and the keyboard layout tables of VS Code\'s keybinding service;',
    'Elffuss Code replaces them with small stand-ins of its own.',
    '',
    `The @codingame/monaco-vscode-* packages contain the source code of Visual`,
    `Studio Code ${vscode} (Copyright (c) 2015 - present Microsoft Corporation, MIT`,
    'licence), repackaged by CodinGame under the MIT licence.',
  ];
  for (const e of list) {
    out.push('', '='.repeat(78), `${e.name} ${e.version}${e.identifier ? ` (${e.identifier})` : ''}`, '='.repeat(78), '');
    if (e.text) out.push(e.text.replace(/\r\n/g, '\n').trim());
    else if (/^MIT$/i.test(e.identifier || '')) out.push('This package ships no licence file; its package.json declares MIT.', '', 'MIT License', '', MIT);
    else out.push('This package ships no licence file; see its package.json: ' + (e.identifier || 'no licence declared'));
  }
  return out.join('\n') + '\n';
}

function vscodeVersion(buildRoot) {
  const src = fs.readFileSync(path.join(buildRoot, 'node_modules/@codingame/monaco-vscode-api/vscode/src/vs/platform/product/common/product.js'), 'utf8');
  const m = /version:\s*'(\d+\.\d+\.\d+)'/.exec(src);
  if (!m) throw new Error('cannot read the VS Code version of the library');
  return m[1];
}

// Builds every output in memory; writes nothing until all checks passed.
export async function postbuild(raw, { outRoot, buildRoot, write = true }) {
  const pkg = JSON.parse(fs.readFileSync(path.join(buildRoot, 'package.json'), 'utf8'));
  const vscode = vscodeVersion(buildRoot);
  const library = '@codingame/monaco-vscode-api@' + pkg.dependencies['@codingame/monaco-vscode-api'];
  const node = fs.readFileSync(path.join(buildRoot, '.node-version'), 'utf8').trim();
  const lockfileSha256 = hex(fs.readFileSync(path.join(buildRoot, 'package-lock.json')));

  const outputs = [];                          // { name, role?, raw: Buffer }
  const licenseEntries = [];
  for (const [entry, { file, licenses }] of Object.entries(raw)) {
    outputs.push({ name: entry + '.js', role: ROLES[entry], raw: fs.readFileSync(file) });
    licenseEntries.push(...licenses);
  }
  const licenses = Buffer.from(licensesText(licenseEntries, { vscode }), 'utf8');

  // 1. sweep before anything is written
  const allow = JSON.parse(fs.readFileSync(path.join(buildRoot, 'sweep-allowlist.json'), 'utf8'));
  const report = sweepBuffers([...outputs.map(o => ({ name: o.name, bytes: o.raw })), { name: 'LICENSES.txt', bytes: licenses }], allow, { buildRoot });
  if (!report.ok) throw new Error('path sweep failed:\n  ' + report.problems.join('\n  '));

  // 2–4.
  const files = outputs.map(o => {
    const gz = gzip(o.raw);
    return { name: o.name, role: o.role, raw: o.raw.length, gz: gz.length, sha256Raw: hex(o.raw), sriGz: 'sha256-' + sha256(gz).toString('base64'), _gz: gz };
  });
  const licensesSha256 = hex(licenses);
  const idList = [...files.map(f => [f.name, f.sha256Raw]), ['LICENSES.txt', licensesSha256]].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const buildId = hex(Buffer.from(JSON.stringify(idList))).slice(0, 16);
  const totalGz = files.reduce((n, f) => n + f.gz, 0);
  if (totalGz > BUDGET_GZ) throw new Error(`size budget exceeded: ${totalGz} bytes gzip > ${BUDGET_GZ}`);

  const manifest = {
    schema: 1, enabled: true, buildId, protocol: PROTOCOL,
    library, vscode, node, lockfileSha256,
    budgetGz: BUDGET_GZ, totalGz,
    files: files.map(({ _gz, ...f }) => f),
    licenses: { name: 'LICENSES.txt', bytes: licenses.length, sha256: licensesSha256 },
  };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';

  const dir = path.join(outRoot, 'vendor', 'x2', buildId);
  const manifestPath = path.join(outRoot, 'js', 'ext2', 'vendor-manifest.json');
  if (write) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(dir, f.name + '.gz'), f._gz);
    fs.writeFileSync(path.join(dir, 'LICENSES.txt'), licenses);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, manifestText);
  }
  return { manifest, manifestText, manifestPath, dir, totalGz, sweep: report };
}

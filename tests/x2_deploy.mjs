// The level 2 deploy scripts, without a server: deploy-vendor.sh and
// deploy-sandbox.sh run on a copy of the files they need, with fake `git`,
// `ssh` and `rsync` first in PATH. The fake ssh runs the remote commands
// against a folder that plays the server; nothing leaves this machine.
//
//   node tests/x2_deploy.mjs        (needs the local vendor build, or NOT RUN)
//
//   D1  deploy-vendor.sh refuses while main's deploy.sh lacks the vendor/x2/
//       filter (a deploy from main would delete the bundle), before any upload
//   D2  a stray file next to the bundle (notes, .DS_Store) stops it before any
//       upload; check-output.mjs names it, and a corrupt .gz is a problem, not
//       a crash
//   D3  a clean bundle: only the manifest's four files are uploaded, and the
//       server's whole folder is compared with the manifest
//   D4  a stray file already on the server makes it fail (full listing, not
//       a glob)
//   D5  deploy-sandbox.sh refuses a sandbox on Code's own site
//   D6  deploy-sandbox.sh uploads the two documents only, even with a stray
//       file next to them, and removes anything else on the server
//   D7  check-output.mjs --live: browsers ask for the bundle only when the
//       manifest is on and config.js gives Code a sandbox
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
let fails = 0;
// (lo que dicen los scripts va en una línea y sin sus «✗», que run-modes.sh contaría como fallos)
const ok = (name, c, extra = '') => { const x = String(extra).replace(/✗/g, '(x)').replace(/\s*\n\s*/g, ' ⏎ '); console.log((c ? '✅' : '❌') + ' ' + name + (x ? '  — ' + x : '')); if (!c) fails++; };

const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'web/js/ext2/vendor-manifest.json'), 'utf8'));
const build = path.join(REPO, 'web/vendor/x2', manifest.buildId);
if (!fs.existsSync(build)) { console.log(`⏭️  NOT RUN x2_deploy — web/vendor/x2/${manifest.buildId} is not built here (vendor/vscode-ext2/build.mjs)`); process.exit(0); }

const T = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'x2-deploy-'));
const bin = path.join(T, 'bin'), server = path.join(T, 'server'), repo = path.join(T, 'repo');
fs.mkdirSync(bin); fs.mkdirSync(server);
const copy = (rel, { dir = false } = {}) => fs.cpSync(path.join(REPO, rel), path.join(repo, rel), { recursive: dir });
for (const f of ['deploy-vendor.sh', 'deploy-sandbox.sh', 'vendor/vscode-ext2/check-output.mjs', 'vendor/vscode-ext2/sweep.mjs', 'vendor/vscode-ext2/sweep-allowlist.json',
  'web/js/ext2/vendor-manifest.json', 'web/js/ext2/config.js', 'sandbox/x2/headers.mjs', 'sandbox/x2/headers.json']) copy(f);
copy('sandbox/x2/v1', { dir: true });
copy(`web/vendor/x2/${manifest.buildId}`, { dir: true });

// ── las falsificaciones ──
const log = path.join(T, 'calls.log');
const exe = (name, body) => { fs.writeFileSync(path.join(bin, name), body); fs.chmodSync(path.join(bin, name), 0o755); };
// git show <ref>:deploy.sh → un deploy.sh con o sin el filtro, según FAKE_FILTER
exe('git', `#!/bin/sh
echo "git $*" >> "${log}"
ref=\${2%%:*}
case ",$FAKE_FILTER," in *",$ref,"*) echo "VENDOR=(--filter='P vendor/x2/***' --exclude='vendor/x2/')";; *) echo "rsync -az --delete web/ host:dest/";; esac
`);
// ssh -i KEY HOST "orden": /var/www/ es la carpeta del falso servidor; con
// find, la carpeta entera; con «sha256sum *.gz X», solo lo que nombra
function fakeSsh(LOG, SERVER) {
  const fs = require('fs'), path = require('path'), crypto = require('crypto');
  fs.appendFileSync(LOG, 'ssh ' + process.argv.slice(2).join(' ') + '\n');
  const cmd = process.argv.at(-1).replaceAll('/var/www/', SERVER);
  const dir = (/cd '([^']+)'/.exec(cmd) || /mkdir -p '([^']+)'/.exec(cmd) || [])[1];
  if (/^mkdir -p/.test(cmd)) { fs.mkdirSync(dir, { recursive: true }); process.exit(0); }
  if (/sha256sum/.test(cmd)) {
    if (!fs.existsSync(dir)) process.exit(1);
    const globs = /find \./.test(cmd) ? null : ((/sha256sum ([^"|;&]+)/.exec(cmd) || [])[1] || '').trim().split(/\s+/);
    const match = (g, f) => new RegExp('^' + g.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(f);
    for (const f of fs.readdirSync(dir).sort().filter(f => !globs || globs.some(g => match(g, f)))) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { console.error('sha256sum: ' + f + ': Is a directory'); continue; }
      console.log(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') + '  ' + f);
    }
  }
  process.exit(0);
}
// rsync [-a] [--ignore-existing] [--delete] [--files-from=F] [-e …] SRC/ HOST:DEST/
function fakeRsync(LOG, SERVER) {
  const fs = require('fs'), path = require('path');
  const a = process.argv.slice(2);
  const list = a.find(x => x.startsWith('--files-from='));
  const names = list ? fs.readFileSync(list.slice(13), 'utf8').split('\n').filter(Boolean) : null;
  fs.appendFileSync(LOG, 'rsync ' + a.filter(x => !x.startsWith('--files-from=')).join(' ') + (names ? ' files:' + names.join(',') : '') + '\n');
  const src = a.at(-2), dst = a.at(-1).replace(/^[^:]*:/, '').replaceAll('/var/www/', SERVER);
  fs.mkdirSync(dst, { recursive: true });
  const files = names || fs.readdirSync(src).filter(f => fs.statSync(path.join(src, f)).isFile());
  for (const f of files) { const to = path.join(dst, f); if (a.includes('--ignore-existing') && fs.existsSync(to)) continue; fs.copyFileSync(path.join(src, f), to); }
  if (a.includes('--delete') && !names) for (const f of fs.readdirSync(dst)) if (!files.includes(f)) fs.rmSync(path.join(dst, f), { recursive: true });
}
for (const [name, fn] of [['ssh', fakeSsh], ['rsync', fakeRsync]]) exe(name, `#!/usr/bin/env node\n(${fn.toString()})(${JSON.stringify(log)}, ${JSON.stringify(server + '/')});\n`);

const run = (script, env = {}) => {
  fs.writeFileSync(log, '');
  const r = spawnSync('bash', [path.join(repo, script)], {
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, ELFFUSS_HOST: 'nobody@deploy.invalid', ELFFUSS_KEY: '/nonexistent', ...env },
    encoding: 'utf8', timeout: 120000,
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), calls: fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) };
};
const vendorDir = path.join(server, 'elffuss-code.utopiaia.com/vendor/x2', manifest.buildId);
const localBuild = path.join(repo, 'web/vendor/x2', manifest.buildId);
const want = [...manifest.files.map(f => f.name + '.gz'), manifest.licenses.name].sort();

// D1
let r = run('deploy-vendor.sh', { FAKE_FILTER: 'HEAD' });
ok('D1 deploy-vendor.sh refuses while main’s deploy.sh lacks the vendor/x2/ filter, before uploading anything', r.code === 1 && /deploy\.sh de main no protege vendor\/x2\//.test(r.out)
  && !r.calls.some(c => /^(ssh|rsync) /.test(c)), r.out.slice(0, 200));

// D2
fs.writeFileSync(path.join(localBuild, 'notes.txt'), 'scratch notes\n');
r = run('deploy-vendor.sh', { FAKE_FILTER: 'main,HEAD' });
ok('D2 a stray file next to the bundle stops it before any upload, and is named', r.code === 1 && /notes\.txt is not in the manifest/.test(r.out) && !r.calls.some(c => /^(ssh|rsync) /.test(c)), r.out.slice(0, 300));
fs.rmSync(path.join(localBuild, 'notes.txt'));
const gz = path.join(localBuild, manifest.files[2].name + '.gz');
const goodGz = fs.readFileSync(gz);
fs.writeFileSync(gz, goodGz.subarray(0, goodGz.length >> 1));
const co = spawnSync('node', [path.join(repo, 'vendor/vscode-ext2/check-output.mjs'), path.join(repo, 'web')], { encoding: 'utf8' });
ok('D2 a corrupt .gz is reported as a problem (it does not inflate), not a crash', co.status === 1 && /does not inflate/.test(co.stderr) && !/at .*check-output\.mjs/.test(co.stderr), co.stderr.slice(0, 300));
fs.writeFileSync(gz, goodGz);

// D3
r = run('deploy-vendor.sh', { FAKE_FILTER: 'main,HEAD' });
const up = r.calls.find(c => c.startsWith('rsync ')) || '';
ok('D3 a clean bundle: only the manifest’s four files are uploaded, and the server’s folder then matches the manifest', r.code === 0 && /files:/.test(up)
  && up.split('files:')[1].split(',').sort().join() === want.join() && JSON.stringify(fs.readdirSync(vendorDir).sort()) === JSON.stringify(want), r.out.slice(-200));

// D4
fs.writeFileSync(path.join(vendorDir, 'stray.txt'), 'left from before\n');
r = run('deploy-vendor.sh', { FAKE_FILTER: 'main,HEAD' });
ok('D4 a stray file already on the server makes it fail: the whole folder is compared, not a glob', r.code === 1 && /stray\.txt/.test(r.out), r.out.slice(0, 300));

// D5
r = run('deploy-sandbox.sh', { X2_SANDBOX_DEST: '/var/www/x2-sandbox', X2_SANDBOX_ORIGIN: 'https://x2.elffuss.com' });
ok('D5 deploy-sandbox.sh refuses a sandbox on Code’s own site (x2.elffuss.com), before uploading', r.code === 1 && /same site as https:\/\/code\.elffuss\.com/.test(r.out) && !r.calls.some(c => /^(ssh|rsync) /.test(c)), r.out.slice(0, 300));

// D6
fs.writeFileSync(path.join(repo, 'sandbox/x2/v1/notes.txt'), 'not for the server\n');
const sbx = path.join(server, 'x2-sandbox/x2/v1');
fs.mkdirSync(sbx, { recursive: true });
fs.writeFileSync(path.join(sbx, 'old.html'), 'an old document\n');
r = run('deploy-sandbox.sh', { X2_SANDBOX_DEST: '/var/www/x2-sandbox', X2_SANDBOX_ORIGIN: 'https://x2.sandbox-elsewhere.example' });
ok('D6 deploy-sandbox.sh uploads only its two documents (not a stray file next to them) and leaves nothing else on the server', r.code === 0
  && JSON.stringify(fs.readdirSync(sbx).sort()) === JSON.stringify(['exthost-iframe.html', 'sandbox.html']), r.out.slice(-300));

// D7
const live = (env = {}) => spawnSync('node', [path.join(repo, 'vendor/vscode-ext2/check-output.mjs'), '--live', path.join(repo, 'web')], { encoding: 'utf8', env: { ...process.env, ...env } }).status;
const today = live();
const cfg = path.join(repo, 'web/js/ext2/config.js');
const cfg0 = fs.readFileSync(cfg, 'utf8');
fs.writeFileSync(cfg, cfg0.replace("'code.elffuss.com': null,", "'code.elffuss.com': 'https://x2.sandbox-elsewhere.example',"));
const withSandbox = live();
const man = path.join(repo, 'web/js/ext2/vendor-manifest.json');
fs.writeFileSync(man, JSON.stringify({ ...manifest, enabled: false }));
const switchedOff = live();
ok('D7 check-output --live: not today (config.js gives Code no sandbox), yes once it does, no with the kill switch', today === 3 && withSandbox === 0 && switchedOff === 3, JSON.stringify({ today, withSandbox, switchedOff }));

fs.rmSync(T, { recursive: true, force: true });
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ all passed');
process.exit(fails ? 1 : 0);

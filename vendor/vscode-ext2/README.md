# Level 2 vendor bundle

The runtime that lets Elffuss Code run the code of VS Code web extensions:
a headless VS Code (`@codingame/monaco-vscode-api` 37.3.11, VS Code 1.138.0)
that runs inside a sandbox iframe on a separate site with no network. Code's
own JavaScript stays buildless; only this bundle is built, and only here.

This folder is the only place in the repository where npm runs.

## What it produces

Three single-file ES modules, gzipped, plus the licences of what they bundle:

| File | Role |
|---|---|
| `sandbox-main.js.gz` | VS Code services, extension manager, hidden mirror editor |
| `exthost-worker.js.gz` | the extension host, which runs extension code in a worker |
| `editor-worker.js.gz` | VS Code's editor worker for the mirror editor |
| `LICENSES.txt` | every bundled package's licence |

They go to `web/vendor/x2/<buildId>/`, which git ignores. The `buildId` is the
first 16 hex characters of a sha256 over the files' hashes, so it changes
exactly when the bytes change. The build also writes
`web/js/ext2/vendor-manifest.json` (committed, a few KB): sizes, the sha256 of
each raw file and an SRI value for each `.gz`. Code's page checks both before
it hands a byte to the sandbox (`web/js/ext2/vendor.js`).

Not shipped: jschardet (LGPL-2.1), the code-page tables of
`@vscode/iconv-lite-umd`, `@vscode/diff` (a wasm binary and its own worker)
and VS Code's keyboard layout tables. `src/stubs/` replaces them with small
stand-ins; the sandbox only ever sees UTF-8 text and never receives key
events.

## Build

```sh
cd vendor/vscode-ext2
npm ci --ignore-scripts        # .npmrc also sets ignore-scripts
node build.mjs
```

`build.mjs` refuses to run on any Node version other than `.node-version`, or
when an installed package differs from the lockfile. It fails, writing
nothing, when:

- the path sweep finds anything (below);
- an entry produces more than one file;
- the three `.gz` files together exceed 2.8 MB (`BUDGET_GZ` in `postbuild.mjs`).

The `.gz` files are written by `postbuild.mjs` itself (level 9, no time stamp,
no OS byte). Their bytes depend on Node's zlib, so they are reproducible for
the pinned Node version on the same CPU architecture; the raw files, and so
the `buildId`, do not depend on zlib.

## Checks

```sh
node verify-repro.mjs          # two clean builds in different folders: byte-identical, equal to the committed manifest
node sweep.mjs                 # sweep the built folder named by the manifest
node sweep.mjs --list <dir>    # print every generic hit with its context, to review an allowlist change
```

`verify-repro.mjs` needs 15 GB of free disk and puts its temporary folders
under `$X2_REPRO_TMP` (default: the system temp folder).

The sweep fails on the user name, the home folder, the build folder or the
repository folder anywhere in the output, including inside base64 `data:`
URLs. Generic patterns (home prefixes of macOS, Linux and Windows, file URLs
and source-map comments) are allowed only when the exact hit is listed in
`sweep-allowlist.json` with its count. Today's allowed hits are VS Code's own
help-text example paths and its file-URL checks.

## Where it is served from

From Code's own origin, `https://code.elffuss.com/vendor/x2/<buildId>/…`, with:

```
location ^~ /vendor/x2/ { default_type application/octet-stream; gzip off;
  add_header Cache-Control "public, max-age=31536000, immutable" always;
  add_header X-Content-Type-Options nosniff always; }
```

`application/octet-stream` keeps browsers from decoding the `.gz` on their own:
the page decompresses it with `DecompressionStream`, then checks the sha256 of
the raw bytes. That works whatever transfer compression a proxy adds.

Nothing is published to npm or a CDN, and nothing large goes into git.

## Deploy

1. `./deploy-vendor.sh` (repository root; reads `ELFFUSS_HOST` and
   `ELFFUSS_KEY`, like `deploy.sh`). It checks the local files against the
   manifest, uploads `web/vendor/x2/<buildId>/` with
   `rsync --ignore-existing` (never `--delete`), then compares the server's
   sha256 sums with the manifest.
2. `./deploy.sh`, which ships the manifest naming the new `buildId`. A normal
   deploy neither uploads nor deletes anything under `vendor/x2/`.

If the server lacks the `buildId` the manifest names, level 2 fails closed
and the default path is unaffected. Old builds stay until a manual prune
keeps the last three; reverting the manifest and redeploying is the
rollback. Setting `"enabled": false` in the manifest is the global kill
switch.

## Upgrade checklist

1. Bump the exact versions in `package.json` (all `@codingame/*` packages
   and the `monaco-editor` alias together).
2. `npm install --ignore-scripts`, then `node build.mjs`,
   `node verify-repro.mjs` and `node sweep.mjs`. Review any allowlist change
   with `--list`.
3. Check that the library's `webWorkerExtensionHostIframe.html` still matches
   `sandbox/x2/v1/exthost-iframe.html` apart from the CSP meta, and that its
   inline-script hash is unchanged.
4. Diff the API-surface snapshot (`tests/x2-surface.json`) and review the RPC
   allowlist.
5. Run all suites in both modes, plus the canary.
6. Re-run the runtime census (`tests/x2_census.mjs`).

No library source is patched on disk; every hook is a runtime wrap in
`web/js/ext2/sandbox-relay.js`.

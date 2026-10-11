# 🧑‍💻 Elffuss Code — a VS Code-style IDE with an AI soul, 100% in your browser

**Open a local folder and a full web IDE unfolds around it — real Monaco (the VS Code
editor), a file tree, tabs — with an AI agent that reads, searches and edits your project
for real. Everything runs in your browser: your code never leaves your machine.**

**[▶️ Live demo](https://code.elffuss.com)** ·
**[✳️ Elffuss Claw (sibling project)](https://github.com/KikoCis/elffuss-claw)** ·
**[🧬 Shared core](https://github.com/KikoCis/elffuss)** ·
**License: Apache-2.0**

<p align="center">
  <a href="https://code.elffuss.com">
    <img src="https://utopiaia.com/demos/elffuss/elffuss-code-demo.gif" alt="Elffuss Code — the agent reads calc.py, finds a real bug and fixes it, all locally" width="820">
  </a>
</p>

> In the demo above, a **small model running entirely in the browser** reads `calc.py`,
> finds a real bug and fixes it with a minimal edit — using genuine tool-calling, not
> autocomplete.

---

## Why it's different

- **Your code stays on your machine.** No upload, no account, no server round-trip. The
  folder is opened locally via the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_Access_API).
- **The model runs on *your* GPU** via WebGPU — nothing is sent to a cloud API by default.
- **Real tool-calling, not autocomplete.** The agent reads files, greps the project and
  makes minimal, surgical edits — and you watch each tool call happen.
- **Real editor.** Monaco (the actual VS Code editor core), file tree, tabs, `Ctrl+S`.
- **Zero install, zero build.** Vanilla ES modules. Open the URL and you're in.

## How it works

1. **Landing** → "📁 Open code folder" (File System Access — Chrome/Edge).
2. **IDE** → file tree (left) · Monaco with tabs and `Ctrl+S` (center) · AI chat (right).
3. The agent works **only inside your project**, through a small set of tools:
   - `code.tree` — list the project
   - `code.read` — read a file (paginated, 100 lines at a time, can center on a line)
   - `code.search` — grep across the project, with line numbers
   - `code.edit` / `code.write` — make edits (the editor refreshes instantly)
4. **Local brain by default:** Gemma-4 (E4B on desktop, E2B on mobile) via **LiteRT-LM on
   WebGPU**, with an **ONNX / transformers.js** fallback (Qwen2.5-0.5B `q4`) when WebGPU
   isn't available. External providers (OpenAI, Anthropic, Ollama) are **opt-in** in ⚙️ —
   keys stay in your browser and calls go straight to the provider.
5. **Optional real terminal.** A tiny local **Bridge** (opt-in) lets the agent run real
   `node` / `npm` / `python` and read the output — still on your machine, nothing hosted.

## VS Code extensions: themes, grammars, snippets

The **Extensions** button in the activity bar (also *View → Extensions…*, or `/extensions`
in the chat on small screens) searches [Open VSX](https://open-vsx.org)
and installs the *declarative* part of VS Code extensions: **color themes** (with a
Color Theme picker), **TextMate grammars**, **snippets** and **language configurations**
(comments, brackets, indentation). You can also install a `.vsix` file.

- **No extension code runs** unless you turn it on for one extension (level 2, below,
  not available on code.elffuss.com yet). Otherwise `main`/`browser` are ignored; the
  panel says what each extension applies and what would need an extension host
  (commands, views, debuggers…).
- **Your project stays in the browser.** Open VSX only sees what you search for and install.
- Packages are checked against the SHA-256 that Open VSX publishes and kept in IndexedDB.
- Grammars run on the same engine as VS Code (vscode-textmate + Oniguruma), loaded only
  when a file needs one: the engine is vendored in `web/js/ext/vendor/` (unchanged, MIT)
  and the Oniguruma WebAssembly comes from jsDelivr with an integrity check. Without
  extensions, nothing extra loads.
- What a package brings is treated as untrusted data: grammars and themes are cleaned
  of names that would reach `Object.prototype`, snippet details are plain text (no remote
  images), regular expressions that repeat a repetition are dropped, and `firstLine`
  patterns run in a Worker with a time limit. The panel lists anything it had to skip.
- `?noext` starts with every extension paused (to rescue a tab from a bad grammar).

### Extensions that run code (level 2, in development)

Web extensions (a `browser` entry, never Node) can run their code in a **sealed sandbox**:
a headless VS Code (`@codingame/monaco-vscode-api` 37.3.11, VS Code 1.138.0) inside an
invisible iframe on **another site**, with no network host in any CSP. Code's own editor
stays Monaco 0.52; it only talks to the sandbox through one validated message channel and
renders what extensions return as plain text or escaped markdown.

- **Nothing loads by default.** Only `js/ext/host.js`, which already only loads for people
  who use extensions, imports `js/ext2/` once an extension has its code turned on. The
  runtime's size (about 2.6 MB gzip, from the manifest) is shown before anything is
  downloaded. `?noext2` turns code off; `"enabled": false` in the manifest is a global
  kill switch.
- **No network, no access to Code's storage.** The sandbox is a different site (separate
  storage, cookies and process); its CSPs name no host, not even its own; it refuses to
  start if a self-test request is not blocked. Extension files are fetched and verified
  by Code's page at install time and handed over as blobs.
- **Open documents only.** Extensions see the files you have open, as
  `file:///<project path>`; their edits go to the active document as one undo step and
  stay unsaved until you save. They cannot save, and the agent's tools are unchanged.
- **The runtime is verified at load:** SRI on each `.gz`, then the sha256 of the inflated
  bytes against the committed `web/js/ext2/vendor-manifest.json`. It is built by a
  pinned, reproducible script and deployed separately; see
  [`vendor/vscode-ext2/README.md`](vendor/vscode-ext2/README.md).
- **Not available on code.elffuss.com yet:** the sandbox needs its own domain first.
  Locally, open Code on `http://127.0.0.1:<port>` with `tests/lib/x2-server.mjs`, which
  serves the sandbox on `localhost:<port>` (a different site).

**What actually runs (runtime census, 2026-10-11).** Of the 500 most downloaded extensions
on Open VSX, 89 have a browser entry. `tests/x2_census.mjs` installed each one from its
verified package (the web build, when the publisher ships one) and started it alone in the
real sandbox with a beacon listening:

| Result | Extensions |
|---|---|
| Too large to install (over 32 MiB per file or 64 MiB per extension) | 8 |
| Start | 49 |
| …and register a command, a language feature or diagnostics | 33 |
| …and register language features (completion, hover, formatting…) | 12 |
| Fail while starting (Node modules or globals in their browser build, services Code doesn't have, blocked network requests) | 22 |
| Never start (nothing in Code triggers them: previews, custom editors, sign-in) | 9 |
| Refused: Vim replaces typing | 1 |
| Requests that reached the beacon | 0 |

Some extensions that start still need things Code doesn't have (webviews, the network, a
workspace), so the census is an upper bound; per-extension results are in
`web/js/ext2/tested.json`. Across the whole catalog (19,320 extensions) a static sample of
2,000 manifests puts the share with a browser entry at about 5%, roughly 470 to 1,430
extensions: an extrapolation, not a count.

Tests: `node tests/x2_unit.mjs`, `node tests/x2_smoke.mjs` (synthetic extensions, a basic
canary and positive controls), `node tests/x2_live.mjs` (Tyriar.sort-lines and Prettier
from Open VSX), and the manual runtime census `node tests/x2_census.mjs`.

## Run locally

```bash
python3 server/serve.py 8645     # → http://localhost:8645
```

Chrome/Edge recommended (WebGPU + File System Access). The **Basic** mode needs no
download; models are fetched from the CDN/HF the first time and cached afterwards.

Test hook: `?test-opfs` uses the browser's OPFS storage as the project (native folder
pickers require a human gesture, which headless tests can't provide).

## Architecture

```
web/
  index.html            IDE shell: tree · Monaco · agent chat
  js/main.js            boot, model selection, WebGPU detection
  js/agent.js           agentic loop: model → tool-call JSON → result → model
  js/ide.js             Monaco, tabs, file tree, HTML preview
  js/tools/code.js      code.tree / read / search / edit / write  (the only thing touching your files)
  js/bridge.js          optional local Bridge (real node/npm/python)
  js/ext/               VS Code extensions: Open VSX, .vsix reader, themes, grammars, snippets
  js/ext2/              level 2: loader, sandbox bridge, editor adapter (buildless)
  js/providers/         onnx (transformers.js) · api (OpenAI/Anthropic/Ollama)
sandbox/x2/             the extension sandbox's two documents and their headers (another site)
vendor/vscode-ext2/     pinned build of the level 2 runtime (the only place npm runs)
server/serve.py         static server + CORS proxy (dev)
```

No framework, no build step for Code's own code (only the optional level 2 runtime is a
prebuilt, verified vendor bundle). The agent talks to the tools with
` ```tool {"tool":…,"args":…} ``` ` blocks — the same protocol across every provider.

## Shares a core with Elffuss

`db.js`, `context.js` (ACE-lite context eviction), `settings.js`, the providers and the
WebGL splash come from the sibling repo **[elffuss](https://github.com/KikoCis/elffuss)**.
Fix something there → sync it here.

## License

[Apache-2.0](LICENSE).

## Gestión de contexto

El empaquetador de contexto (BM25 con IDF endógena contra la pregunta viva, sin heurísticas) está medido: recuerdo de hechos **15,1 % → 65,3 %** al mismo gasto de tokens, y **recuperar bien bate a no comprimir** (F1 28,09 contra 22,56 del contexto completo, con el 8 % de los tokens).

Tablas completas, ablaciones y referencias en el **[core compartido](https://github.com/KikoCis/elffuss#cómo-se-mide-el-gestor-de-contexto)** · la historia con lo que salió mal en la **[bitácora](https://bitacora.utopiaia.com/posts/16-beaten-by-doing-nothing.html)**.

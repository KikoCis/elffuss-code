# 🧑‍💻 Elffuss Code — a VS Code-style IDE with an AI soul, 100% in your browser

**Open a local folder and a full web IDE unfolds around it — real Monaco (the VS Code
editor), a file tree, tabs — with an AI agent that reads, searches and edits your project
for real. Everything runs in your browser: your code never leaves your machine.**

**[▶️ Live demo](https://elffuss-code.utopiaia.com)** ·
**[✳️ Elffuss Claw (sibling project)](https://github.com/KikoCis/elffuss-claw)** ·
**[🧬 Shared core](https://github.com/KikoCis/elffuss)** ·
**License: Apache-2.0**

<p align="center">
  <a href="https://elffuss-code.utopiaia.com">
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
  js/providers/         onnx (transformers.js) · api (OpenAI/Anthropic/Ollama)
server/serve.py         static server + CORS proxy (dev)
```

No framework, no build step. The agent talks to the tools with
` ```tool {"tool":…,"args":…} ``` ` blocks — the same protocol across every provider.

## Shares a core with Elffuss

`db.js`, `context.js` (ACE-lite context eviction), `settings.js`, the providers and the
WebGL splash come from the sibling repo **[elffuss](https://github.com/KikoCis/elffuss)**.
Fix something there → sync it here.

## License

[Apache-2.0](LICENSE).

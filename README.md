# 🧝‍💻 Elffuss Code — tu IDE con alma, en el navegador

Spin-off de [Elffuss](https://elffuss.utopiaia.com): **abres una carpeta de código
y se despliega un IDE web tipo VS Code** — Monaco (el editor real de VS Code),
árbol de archivos, pestañas — **con Elffuss integrada como agente de código**.
Todo corre en tu navegador: el proyecto no sale de tu máquina.

## Flujo

1. Landing: «📁 Abrir carpeta de código» (File System Access, Chrome/Edge).
2. IDE: árbol (izq) · Monaco con pestañas y Ctrl+S (centro) · chat con la elfa (der).
3. La elfa trabaja SOLO dentro del proyecto: `code.tree`, `code.read`,
   `code.write` (el editor se refresca al instante), `code.search` (grep).
4. Cerebro local por defecto (LFM2.5-1.2B · WebGPU, transformers.js v4);
   externos opt-in en ⚙️ (OpenAI, Anthropic, Ollama, servidor Ornith).

## Correr en local

```bash
python3 server/serve.py 8645     # → http://localhost:8645
```

Gancho de test: `?test-opfs` usa el almacenamiento OPFS del navegador como
proyecto (los pickers nativos exigen gesto humano).

## Deploy

`./deploy.sh` → https://elffuss-code.utopiaia.com (rsync + nginx + certbot,
mismo esquema que Elffuss).

## Comparte núcleo con Elffuss

`db.js`, `context.js` (ACE-lite), `settings.js`, `providers/{onnx,api}.js` y
`splash-gl.js` (galaxia WebGL) vienen del repo hermano `~/work2026/elffuss` —
si arreglas algo ahí, replica aquí. Los gotchas de modelos (≤1 GB wasm, q4,
transformers.js v4 para LFM2.5) están en
`~/work2026/elffuss/coordinacion/CANDIDATOS-MODELO.md`.

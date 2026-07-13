# Elffuss Claw — Guía del proyecto

IDE web (Monaco + árbol + pestañas) con la elfa de agente de código, 100% en
el navegador. Spin-off de `~/work2026/elffuss` — LEE SU CLAUDE.md: los gotchas
de modelos, GPU-lock del Mac y protocolo de tool-calls aplican igual.

## Correr y probar

```bash
python3 server/serve.py 8645          # dev (8642 suele ocuparlo elffuss)
node --check web/js/**/*.js           # sin build, ES modules vanilla
```

Test hook: `http://localhost:8645/?test-opfs` abre OPFS como proyecto (sin
picker). El smoke E2E vive en tests/.

## Decisiones

- Monaco desde CDN (jsdelivr, loader AMD) — ES el editor de VS Code; no
  empaquetar. Los cambios del agente (`code.write`) refrescan el modelo del
  editor vía `setOnFileWritten`.
- Cerebro local LFM2.5-1.2B (transformers.js v4) por defecto; externos ⚙️
  opt-in (`settings.js` con claves en localStorage; `ext:server` apunta
  ABSOLUTO a https://elffuss.utopiaia.com/v1 — necesita CORS en ese nginx).
- El agente solo ve la carpeta abierta (tools/code.js, IGNORE de node_modules
  etc.). `code.write` exige contenido COMPLETO del archivo.
- Núcleo compartido copiado de elffuss (db/context/settings/providers/splash-gl):
  arreglos allí → replicar aquí.

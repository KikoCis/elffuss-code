#!/usr/bin/env bash
# Suites DETERMINISTAS de la capa de herramientas (sin modelo, sin GPU).
# Son rápidas y no dependen de la red: no hay excusa para tocar tools/code.js
# sin pasarlas. En ago-2026 se publicó una regresión de code.edit justo por
# arreglar una suite y no correr las demás.
#
#   ./run-tools.sh                       # contra el dev local (8790)
#   BASE=https://elffuss-code.utopiaia.com ./run-tools.sh    # contra producción
set -uo pipefail
cd "$(dirname "$0")"
export BASE="${BASE:-http://localhost:8790}"

SUITES="bigfile_edit codeedit codeedit_agent prompt_prefers_edit readpaging multiwrite glob_rm autoedit_settings toolparse toolparse_missingbrace toolparse_malformed litertcache modelcache_honest"
echo "▶ BASE=$BASE"
fail=0

# Guardia de PRIVACIDAD: ya han colado DOS VECES un import de playwright por
# ruta absoluta con el nombre de usuario, y las dos acabaron empujadas al repo
# público. Que salte aquí y no en la auditoría de después.
if leak=$(grep -rnE '/(Users|home)/[a-z]' *.mjs 2>/dev/null); then
  echo "❌ RUTA CON USUARIO en los tests (no se puede publicar):"
  printf '%s\n' "$leak" | sed 's/^/    /'
  fail=1
fi
for t in $SUITES; do
  printf '%-24s ' "$t"
  out=$(node "$t.mjs" 2>&1)
  n=$(printf '%s' "$out" | grep -c '✅')
  if printf '%s' "$out" | grep -q 'FALLO\|Error:'; then
    echo "❌ FALLA"
    printf '%s\n' "$out" | tail -8 | sed 's/^/    /'
    fail=1
  else
    echo "✅ $n asserts"
  fi
done
[ $fail -eq 0 ] && echo "✅ capa de herramientas VERDE" || echo "❌ hay suites en rojo"
exit $fail

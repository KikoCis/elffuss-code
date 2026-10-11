#!/usr/bin/env bash
# Sube el bundle del nivel 2 de extensiones (web/vendor/x2/<buildId>/) a
# code.elffuss.com. Va ANTES de deploy.sh, que es quien publica el manifiesto
# que nombra ese buildId: si el servidor no tiene el bundle, el nivel 2 se
# niega a arrancar y el resto de Code sigue igual.
#
#   cd vendor/vscode-ext2 && npm ci --ignore-scripts && node build.mjs
#   ./deploy-vendor.sh
#   ./deploy.sh
#
# Nunca borra nada en el servidor (rsync --ignore-existing, sin --delete): las
# compilaciones viejas se quedan para poder volver atrás revirtiendo el
# manifiesto. La poda (quedarse con las tres últimas) es a mano.
set -euo pipefail
cd "$(dirname "$0")"

HOST=${ELFFUSS_HOST:?define ELFFUSS_HOST (usuario@servidor) antes de desplegar}
KEY=${ELFFUSS_KEY:?define ELFFUSS_KEY (ruta a la clave ssh)}
DEST=/var/www/elffuss-code.utopiaia.com

BUILD=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('web/js/ext2/vendor-manifest.json','utf8')).buildId)")
case "$BUILD" in (*[!0-9a-f]*|'') echo "buildId no válido: $BUILD" >&2; exit 1;; esac
LOCAL=web/vendor/x2/$BUILD

# 1. lo local, contra el manifiesto (SRI, sha256 y barrido de rutas)
node vendor/vscode-ext2/check-output.mjs web
EXPECTED=$(node vendor/vscode-ext2/check-output.mjs --sums web)

# 2. subida sin pisar ni borrar
ssh -i "$KEY" "$HOST" "mkdir -p '$DEST/vendor/x2/$BUILD'"
rsync -a --ignore-existing -e "ssh -i $KEY" "$LOCAL/" "$HOST:$DEST/vendor/x2/$BUILD/"

# 3. lo que quedó en el servidor, contra el manifiesto
REMOTE=$(ssh -i "$KEY" "$HOST" "cd '$DEST/vendor/x2/$BUILD' && sha256sum *.gz LICENSES.txt" | LC_ALL=C sort -k2)
if [ "$REMOTE" != "$(printf '%s\n' "$EXPECTED" | LC_ALL=C sort -k2)" ]; then
  echo "✗ el servidor no tiene exactamente el bundle $BUILD:" >&2
  diff <(printf '%s\n' "$EXPECTED" | LC_ALL=C sort -k2) <(printf '%s\n' "$REMOTE") >&2 || true
  exit 1
fi
echo "bundle $BUILD en el servidor y verificado; ahora ./deploy.sh publica el manifiesto"

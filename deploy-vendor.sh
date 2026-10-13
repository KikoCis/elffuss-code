#!/usr/bin/env bash
# Sube el bundle del nivel 2 de extensiones (web/vendor/x2/<buildId>/) a
# code.elffuss.com, la carpeta de Code (el recinto, x2.utopiaia.com, no recibe
# el bundle: se lo pasa Code). Va ANTES de deploy.sh, que es quien publica el
# manifiesto que nombra ese buildId (y se niega a publicarlo si el servidor no
# tiene ya ese bundle, byte a byte), y después de deploy-sandbox.sh.
#
#   cd vendor/vscode-ext2 && npm ci --ignore-scripts && node build.mjs
#   ./deploy-sandbox.sh
#   ./deploy-vendor.sh
#   ./deploy.sh
#
# Nunca borra nada en el servidor (rsync --ignore-existing, sin --delete): las
# compilaciones viejas se quedan para poder volver atrás revirtiendo el
# manifiesto. La poda (quedarse con las tres últimas) es a mano.
#
# Solo sube los ficheros que nombra el manifiesto (los tres .gz y
# LICENSES.txt): cualquier otro que haya en la carpeta local hace fallar la
# comprobación de antes, y la del servidor exige que allí no haya nada más.
set -euo pipefail
cd "$(dirname "$0")"

HOST=${ELFFUSS_HOST:?define ELFFUSS_HOST (usuario@servidor) antes de desplegar}
KEY=${ELFFUSS_KEY:?define ELFFUSS_KEY (ruta a la clave ssh)}
DEST=/var/www/elffuss-code.utopiaia.com

# 0. Un deploy.sh SIN el filtro de vendor/x2/ (el de main hasta que se fusione
#    esta rama) borra el bundle del servidor con su --delete. Mientras el de
#    main no lo tenga, esto no sube nada: el siguiente despliegue normal lo
#    borraría y el manifiesto nombraría un bundle que ya no está.
for REF in main HEAD; do
  DEPLOY=$(git show "$REF:deploy.sh" 2>/dev/null || true)
  case "$DEPLOY" in
    (*"P vendor/x2/"*) ;;
    (*) echo "✗ el deploy.sh de $REF no protege vendor/x2/ (falta --filter='P vendor/x2/***'): fusiona antes ese filtro en $REF" >&2; exit 1;;
  esac
done

BUILD=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('web/js/ext2/vendor-manifest.json','utf8')).buildId)")
case "$BUILD" in (*[!0-9a-f]*|'') echo "buildId no válido: $BUILD" >&2; exit 1;; esac
LOCAL=web/vendor/x2/$BUILD

# 1. lo local, contra el manifiesto: exactamente sus ficheros (SRI, sha256 y
#    barrido de rutas) y nada más
node vendor/vscode-ext2/check-output.mjs web
EXPECTED=$(node vendor/vscode-ext2/check-output.mjs --sums web | LC_ALL=C sort -k2)

# 2. subida de esos ficheros y solo de ellos, sin pisar ni borrar
ssh -i "$KEY" "$HOST" "mkdir -p '$DEST/vendor/x2/$BUILD'"
rsync -a --ignore-existing --files-from=<(node vendor/vscode-ext2/check-output.mjs --files web) -e "ssh -i $KEY" "$LOCAL/" "$HOST:$DEST/vendor/x2/$BUILD/"

# 3. lo que hay en el servidor, contra el manifiesto: los mismos ficheros,
#    byte a byte, y ninguno más
REMOTE=$(ssh -i "$KEY" "$HOST" "cd '$DEST/vendor/x2/$BUILD' && find . -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort | while read -r f; do sha256sum -- \"\$f\"; done" | LC_ALL=C sort -k2)
if [ "$REMOTE" != "$EXPECTED" ]; then
  echo "✗ el servidor no tiene exactamente el bundle $BUILD (y nada más):" >&2
  diff <(printf '%s\n' "$EXPECTED") <(printf '%s\n' "$REMOTE") >&2 || true
  exit 1
fi
echo "bundle $BUILD en el servidor y verificado; ahora ./deploy.sh publica el manifiesto"

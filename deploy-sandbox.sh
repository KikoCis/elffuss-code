#!/usr/bin/env bash
# Sube los dos documentos del recinto de extensiones (sandbox/x2/v1/) a la
# carpeta que sirve el dominio del recinto, x2.<dominio-del-recinto>. NUNCA a
# la de Code: que el sitio de Code no sirva el recinto es parte del
# aislamiento. Las cabeceras (CSP sin ningún host, Permissions-Policy…) las
# pone nginx con los fragmentos que genera:
#   node sandbox/x2/headers.mjs --nginx --sandbox https://x2.<dominio>
# (plantilla del vhost: sandbox/x2/nginx.conf.example)
#
#   export ELFFUSS_HOST=usuario@servidor  ELFFUSS_KEY=~/.ssh/tu_clave
#   export X2_SANDBOX_DEST=/var/www/<carpeta-del-recinto>
#   ./deploy-sandbox.sh
#
# Orden: este script, luego deploy-vendor.sh, luego deploy.sh (que publica
# web/js/ext2/config.js con el dominio del recinto).
set -euo pipefail
cd "$(dirname "$0")"

HOST=${ELFFUSS_HOST:?define ELFFUSS_HOST (usuario@servidor) antes de desplegar}
KEY=${ELFFUSS_KEY:?define ELFFUSS_KEY (ruta a la clave ssh)}
DEST=${X2_SANDBOX_DEST:?define X2_SANDBOX_DEST (la carpeta que sirve x2.<dominio-del-recinto>)}
case "$DEST" in
  (*elffuss-code*|*/web|*/web/|/) echo "X2_SANDBOX_DEST no puede ser la carpeta de Code: $DEST" >&2; exit 1;;
esac

# 1. los documentos cuadran con headers.json (hash del script en línea y CSP
#    del meta) y con la copia de la librería
node sandbox/x2/headers.mjs --check

# 2. subida: solo x2/v1/ (los dos documentos)
ssh -i "$KEY" "$HOST" "mkdir -p '$DEST/x2/v1'"
rsync -a --delete -e "ssh -i $KEY" sandbox/x2/v1/ "$HOST:$DEST/x2/v1/"

# 3. lo que quedó en el servidor, byte a byte
EXPECTED=$(cd sandbox/x2/v1 && shasum -a 256 sandbox.html exthost-iframe.html | LC_ALL=C sort -k2)
REMOTE=$(ssh -i "$KEY" "$HOST" "cd '$DEST/x2/v1' && sha256sum sandbox.html exthost-iframe.html" | LC_ALL=C sort -k2)
if [ "$REMOTE" != "$EXPECTED" ]; then
  echo "✗ el servidor no tiene exactamente los documentos del recinto:" >&2
  diff <(printf '%s\n' "$EXPECTED") <(printf '%s\n' "$REMOTE") >&2 || true
  exit 1
fi
echo "recinto en el servidor y verificado; mira sus cabeceras con: curl -sI https://x2.<dominio>/x2/v1/sandbox.html"

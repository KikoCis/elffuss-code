#!/usr/bin/env bash
# Deploy de Elffuss Code a elffuss-code.utopiaia.com
set -euo pipefail
cd "$(dirname "$0")"

# La IP y el usuario del servidor NO se publican: se leen del entorno.
# Estuvieron cinco semanas en este fichero dentro de un repo público, que es
# regalar la superficie de ataque entera a quien escanee GitHub.
#   export ELFFUSS_HOST=usuario@servidor  ELFFUSS_KEY=~/.ssh/tu_clave
HOST=${ELFFUSS_HOST:?define ELFFUSS_HOST (usuario@servidor) antes de desplegar}
KEY=${ELFFUSS_KEY:?define ELFFUSS_KEY (ruta a la clave ssh)}
DEST=/var/www/elffuss-code.utopiaia.com

# El blog diario publica en <docroot>/blog/, que no existe en web/. Sin este
# filtro, el --delete se lo lleva por delante en cada despliegue.
# Los PESOS no viajan en un despliegue normal: __e4b.litertlm son ~3 GB que
# ya están en el servidor. El filtro P lo protege del --delete y el exclude
# evita volver a subirlo. Se sube aparte cuando cambie de verdad.
# El motor propio (js/engine/) vive en un repo PRIVADO aparte y llega por este
# rsync, no por git. No viaja en un despliegue normal: el .gitignore protege de
# un «git add -A» pero NO del rsync, y con varias sesiones tocando el árbol eso
# hizo que acabara publicado sin que nadie lo decidiera. El filtro P impide
# además que el --delete borre el que ya esté en el servidor: sin él, cada
# despliegue de la app dejaba js/engine/ vacío y la opción del motor
# desaparecía del selector sin que nada avisara.
#   Para desplegarlo a propósito:  ./deploy.sh --con-motor
MOTOR=(--filter='P js/engine/**' --exclude='js/engine/**')
for a in "$@"; do
  if [ "$a" = "--con-motor" ]; then
    echo "▲ el motor propio (js/engine/) SE INCLUYE en este despliegue"
    # Se quita el --exclude pero se DEJA el filtro P: aunque lo estemos
    # subiendo, el --delete no debe poder llevárselo. Y un array vacío con
    # `set -u` revienta en bash 3.2.
    MOTOR=(--filter='P js/engine/**')
  fi
done

rsync -az --delete --filter='P blog/***' --filter='P __e4b.litertlm' --exclude='__e4b.litertlm' "${MOTOR[@]}" -e "ssh -i $KEY" web/ "$HOST:$DEST/"

# anti-caché: versionar assets del index con el commit y sellar el build
V=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
ssh -i "$KEY" "$HOST" "sed -i 's|href=\"css/\([^\"]*\)\.css\"|href=\"css/\1.css?v=$V\"|g; s|src=\"js/\([^\"]*\)\.js\"|src=\"js/\1.js?v=$V\"|g; s|__BUILD__|$V|g' $DEST/index.html"

echo "🧝‍💻 desplegado → https://elffuss-code.utopiaia.com (build $V)"

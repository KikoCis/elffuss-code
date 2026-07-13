#!/usr/bin/env bash
# Deploy de Elffuss Code a elffuss-code.utopiaia.com
set -euo pipefail
cd "$(dirname "$0")"

HOST=ubuntu@145.239.65.26
KEY=~/.ssh/id_rsa_2_ovh
DEST=/var/www/elffuss-code.utopiaia.com

rsync -az --delete -e "ssh -i $KEY" web/ "$HOST:$DEST/"

# anti-caché: versionar assets del index con el commit y sellar el build
V=$(git rev-parse --short HEAD 2>/dev/null || date +%s)
ssh -i "$KEY" "$HOST" "sed -i 's|href=\"css/\([^\"]*\)\.css\"|href=\"css/\1.css?v=$V\"|g; s|src=\"js/\([^\"]*\)\.js\"|src=\"js/\1.js?v=$V\"|g; s|__BUILD__|$V|g' $DEST/index.html"

echo "🧝‍💻 desplegado → https://elffuss-code.utopiaia.com (build $V)"

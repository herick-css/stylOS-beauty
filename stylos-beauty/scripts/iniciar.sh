#!/usr/bin/env bash
# ==================================================================
#  StylOS Beauty — ligar o servidor (Linux / macOS)
#  Uso: ./scripts/iniciar.sh     (reinicia sozinho se cair)
#  Para ligar com o computador (Linux): veja scripts/stylos.service
# ==================================================================
cd "$(dirname "$0")/.." || exit 1
if ! command -v node >/dev/null; then
  echo "Instale o Node.js 22.13+ (LTS): https://nodejs.org"; exit 1
fi
TUNEL=$(grep -E '^TUNEL=' .env 2>/dev/null | cut -d= -f2)
if [ "$TUNEL" = "tailscale" ]; then
  tailscale funnel --bg 3000 >/dev/null 2>&1 && tailscale funnel status
elif [ "$TUNEL" = "cloudflare" ]; then
  TOKEN=$(grep -E '^CLOUDFLARE_TOKEN=' .env | cut -d= -f2-)
  cloudflared tunnel run --token "$TOKEN" > dados/tunel.log 2>&1 &
fi
while true; do
  node --disable-warning=ExperimentalWarning servidor/principal.js
  echo "O servidor parou. Reiniciando em 5 segundos... (Ctrl+C duas vezes para sair)"
  sleep 5
done

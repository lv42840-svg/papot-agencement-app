#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

for program in docker curl openssl; do
  command -v "$program" >/dev/null || { echo "Commande manquante : $program" >&2; exit 1; }
done

# Both identity routes must have been deployed before starting the explorer.
for port in 3001 3002; do
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 10 "http://127.0.0.1:$port/api/auth/identity")
  if [[ "$status" != "401" ]]; then
    echo "Application sur le port $port non prête (HTTP $status). Déployez sa route /api/auth/identity avant de continuer." >&2
    exit 1
  fi
done

if [[ ! -e deploy/srv-explorer/.env ]]; then
  (umask 077; printf 'SRV_SESSION_KEY=%s\nSRV_PUBLIC_ORIGIN=https://srv.papot.app\n' "$(openssl rand -hex 32)" > deploy/srv-explorer/.env)
fi

docker compose -f deploy/srv-explorer/docker-compose.yml config --quiet
docker compose -f deploy/srv-explorer/docker-compose.yml up -d --build --wait
echo "Explorateur démarré sur 127.0.0.1:3003. Configurez le DNS et Caddy selon deploy/srv-explorer/README.md."

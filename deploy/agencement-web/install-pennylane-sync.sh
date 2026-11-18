#!/bin/sh
# Installation idempotente du timer Pennylane sur le VPS AGENCEMENT.
# À exécuter avec sudo avant le redémarrage du conteneur.
set -eu
umask 077

if [ "$(id -u)" -ne 0 ]; then
  echo "Cette installation exige sudo/root." >&2
  exit 1
fi

base_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file="$base_dir/.env"
unit_dir="$base_dir/systemd"
config_dir=/etc/papot-agencement
curl_config="$config_dir/pennylane-sync.curl"

if [ ! -f "$env_file" ]; then
  echo "Fichier .env de déploiement introuvable. Installer l'application d'abord." >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "openssl et curl sont nécessaires." >&2
  exit 1
fi
existing=$(grep -c '^PAPOT_PENNYLANE_SYNC_SECRET=' "$env_file" || true)
case "$existing" in
  0)
    secret=$(openssl rand -hex 32)
    printf '\nPAPOT_PENNYLANE_SYNC_SECRET=%s\n' "$secret" >> "$env_file"
    ;;
  1)
    secret=$(sed -n 's/^PAPOT_PENNYLANE_SYNC_SECRET=//p' "$env_file")
    ;;
  *)
    echo "Plusieurs clés de synchronisation détectées dans .env ; corriger manuellement." >&2
    exit 1
    ;;
esac

case "$secret" in
  *[!0123456789abcdef]*|'')
    echo "Clé de synchronisation invalide : 64 caractères hexadécimaux requis." >&2
    exit 1
    ;;
esac
if [ "${#secret}" -ne 64 ]; then
  echo "Clé de synchronisation invalide : 64 caractères hexadécimaux requis." >&2
  exit 1
fi

chmod 600 "$env_file"
install -d -m 700 "$config_dir"
cat > "$curl_config" <<EOF
url = "http://127.0.0.1:3002/api/internal/pennylane/sync"
request = "POST"
header = "Authorization: Bearer $secret"
EOF
chmod 600 "$curl_config"

install -m 644 "$unit_dir/papot-pennylane-sync.service" /etc/systemd/system/papot-pennylane-sync.service
install -m 644 "$unit_dir/papot-pennylane-sync.timer" /etc/systemd/system/papot-pennylane-sync.timer
systemctl daemon-reload
systemctl enable --now papot-pennylane-sync.timer
echo "Minuterie installée (06:00 et 12:00 Europe/Paris)."
echo "Redémarrer maintenant le conteneur AGENCEMENT pour charger la clé interne."
systemctl list-timers papot-pennylane-sync.timer --no-pager

#!/usr/bin/env bash
# Daily, append-only cleartext backup of SRV configuration and access policy.
# Credentials inside srv.env must only be readable by authorized Nextcloud users.
set -euo pipefail
umask 077

CONFIG=/home/ubuntu/.config/rclone/rclone.conf
ENVFILE=/home/ubuntu/papot-agencement-app/deploy/srv-explorer/.env
STATE=/opt/papot/srv-explorer/state
REMOTE=papot-nextcloud:61_PAPOT_Production/BACKUP_VPS_PAPOT/CONFIGURATION_SRV

if [[ "${EUID}" -ne 0 ]]; then
  echo "Execute this backup as root." >&2
  exit 1
fi
for command in rclone tar sha256sum; do
  command -v "$command" >/dev/null || { echo "Missing: $command" >&2; exit 1; }
done
if [[ ! -f "$ENVFILE" || -L "$ENVFILE" || ! -d "$STATE" || -L "$STATE" || ! -r "$CONFIG" ]]; then
  echo "SRV backup prerequisites are missing or unsafe." >&2
  exit 1
fi
# This destination must never be inside /srv or the explorer's shared storage.
STAMP=$(date -u +%Y%m%d_%H%M%S)
DEST="$REMOTE/auto/$STAMP"

rclone --config "$CONFIG" copyto --immutable "$ENVFILE" "$DEST/srv.env.txt"
tar -C /opt/papot/srv-explorer -czf - state |
  rclone --config "$CONFIG" rcat "$DEST/state.tar.gz"

LOCAL_HASH=$(sha256sum "$ENVFILE" | cut -d ' ' -f1)
REMOTE_HASH=$(rclone --config "$CONFIG" cat "$DEST/srv.env.txt" | sha256sum | cut -d ' ' -f1)
if [[ "$LOCAL_HASH" != "$REMOTE_HASH" ]]; then
  echo "SRV env verification failed." >&2
  exit 1
fi
rclone --config "$CONFIG" cat "$DEST/state.tar.gz" | tar -tzf - >/dev/null

# This marker exists only after both files were uploaded and checked.
printf 'status=complete\nstamp=%s\nenv_sha256=%s\n' "$STAMP" "$LOCAL_HASH" |
  rclone --config "$CONFIG" rcat "$DEST/complete.txt"
echo "SUCCESS: SRV configuration and access rules copied and verified ($STAMP)."
# Deliberately no automatic deletion. Configure a validated retention separately.

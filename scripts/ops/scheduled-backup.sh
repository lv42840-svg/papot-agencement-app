#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
: "${PAPOT_REPOSITORY_ROOT:?Required}"
: "${PAPOT_DATABASE_URL:?Required, reachable from the host}"
: "${RESTIC_REPOSITORY:?Off-site destination required}"
: "${RESTIC_PASSWORD_FILE:?Encryption password file required}"
: "${PAPOT_BACKUP_LOCAL_ROOT:=/srv/papot-backups}"
: "${PAPOT_BACKUP_FILES_ROOT:=/srv/agencement}"
for executable in python3 pg_dump pg_restore psql docker restic flock git; do
  command -v "$executable" >/dev/null || { echo "Missing dependency: $executable" >&2; exit 1; }
done
# A second timer/manual run must never overlap a backup that stopped the application.
exec 9>/run/lock/papot-agencement-backup.lock
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }
# Verify the encrypted remote repository before interrupting the application.
restic snapshots --json >/dev/null
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_path="$PAPOT_BACKUP_LOCAL_ROOT/agencement-$stamp"
revision=$(git -C "$PAPOT_REPOSITORY_ROOT" rev-parse HEAD)
python3 "$PAPOT_REPOSITORY_ROOT/scripts/ops/backup.py" backup \
  --compose-file "$PAPOT_REPOSITORY_ROOT/deploy/agencement-web/docker-compose.yml" \
  --files "$PAPOT_BACKUP_FILES_ROOT" --destination "$backup_path" --revision "$revision"
restic backup --tag papot-agencement "$backup_path"
restic check
# No automatic deletion: keep local data if transmission/check fails.
echo "Backup and encrypted off-site repository check succeeded: $stamp"

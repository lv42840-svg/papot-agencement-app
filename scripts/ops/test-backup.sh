#!/usr/bin/env bash
set -euo pipefail
: "${PAPOT_DATABASE_URL:?Isolated test database required}"
export PAPOT_ISOLATED_TEST=1
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/source"
printf 'Document métier de contrôle\n' > "$work/source/document.txt"
# This script runs only against the CI's disposable database.
psql "$PAPOT_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE TABLE restore_probe (id integer PRIMARY KEY, label text); INSERT INTO restore_probe VALUES (1, 'restored');"
python3 scripts/ops/backup.py backup --files "$work/source" --destination "$work/backup" --revision test --isolated-test
if python3 scripts/ops/backup.py restore --source "$work/backup" --files "$work/restored"; then
  echo 'Unexpected overwrite of populated database'; exit 1
fi
psql "$PAPOT_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'DROP TABLE restore_probe;'
python3 scripts/ops/backup.py restore --source "$work/backup" --files "$work/restored"
test "$(psql "$PAPOT_DATABASE_URL" -XAt -c 'SELECT label FROM restore_probe WHERE id=1')" = restored
cmp "$work/source/document.txt" "$work/restored/document.txt"
printf 'altered' >> "$work/backup/files/document.txt"
if python3 scripts/ops/backup.py restore --source "$work/backup" --files "$work/rejected"; then
  echo 'Unexpected acceptance of corrupt backup'; exit 1
fi

BEGIN;

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE app_session
  ADD COLUMN IF NOT EXISTS session_id uuid NULL,
  ADD COLUMN IF NOT EXISTS device_id text NULL,
  ADD COLUMN IF NOT EXISTS device_label text NULL;

UPDATE app_session
SET session_id = (
  substr(token_hash, 1, 8) || '-' ||
  substr(token_hash, 9, 4) || '-' ||
  substr(token_hash, 13, 4) || '-' ||
  substr(token_hash, 17, 4) || '-' ||
  substr(token_hash, 21, 12)
)::uuid
WHERE session_id IS NULL;

ALTER TABLE app_session
  ALTER COLUMN session_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS app_session_session_id_idx
  ON app_session(session_id);

COMMIT;

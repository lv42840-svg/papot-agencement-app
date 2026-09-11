BEGIN;

CREATE TABLE IF NOT EXISTS sync_device (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  nextcloud_user_id text NOT NULL,
  device_label text NOT NULL,
  key_id text NOT NULL UNIQUE,
  public_key_pem text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz NULL,
  CHECK (is_active OR disabled_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS sync_device_user_idx ON sync_device(user_id, is_active);

CREATE TABLE IF NOT EXISTS sync_received_package (
  package_id uuid PRIMARY KEY,
  client_request_id uuid NULL,
  schema_version integer NOT NULL,
  app_version text NOT NULL,
  operation_type text NOT NULL,
  papot_user_id uuid NOT NULL REFERENCES app_user(id),
  device_id uuid NOT NULL REFERENCES sync_device(id),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  package_created_at timestamptz NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS sync_received_client_request_uidx
  ON sync_received_package(operation_type, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sync_received_device_applied_idx
  ON sync_received_package(device_id, applied_at DESC);

CREATE TABLE IF NOT EXISTS capture_attachment (
  id uuid PRIMARY KEY,
  capture_entry_id uuid NOT NULL REFERENCES capture_entry(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  nextcloud_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capture_attachment_capture_idx
  ON capture_attachment(capture_entry_id, created_at);

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS app_user (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  can_manage_permissions boolean NOT NULL DEFAULT false,
  accent_key text NOT NULL DEFAULT 'lavender',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_module_permission (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  module_key text NOT NULL,
  access_level text NOT NULL CHECK (access_level IN ('READ', 'WRITE')),
  PRIMARY KEY (user_id, module_key)
);

CREATE TABLE IF NOT EXISTS user_special_permission (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  permission_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, permission_key)
);

CREATE TABLE IF NOT EXISTS app_session (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_session_user_idx ON app_session(user_id);
CREATE INDEX IF NOT EXISTS app_session_expiry_idx ON app_session(expires_at);

CREATE TABLE IF NOT EXISTS capture_tag (
  id uuid PRIMARY KEY,
  label text NOT NULL,
  slug text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS capture_entry (
  id uuid PRIMARY KEY,
  client_request_id uuid NOT NULL UNIQUE,
  capture_type text NOT NULL,
  title text NOT NULL,
  responsible_user_id uuid NOT NULL REFERENCES app_user(id),
  created_by_user_id uuid NOT NULL REFERENCES app_user(id),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL', 'URGENT')),
  due_at timestamptz NULL,
  status text NOT NULL DEFAULT 'TO_QUALIFY' CHECK (status IN ('TO_QUALIFY', 'QUALIFIED', 'DONE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capture_entry_status_created_idx ON capture_entry(status, created_at DESC);
CREATE INDEX IF NOT EXISTS capture_entry_responsible_idx ON capture_entry(responsible_user_id, due_at);

CREATE TABLE IF NOT EXISTS capture_entry_tag (
  capture_entry_id uuid NOT NULL REFERENCES capture_entry(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES capture_tag(id),
  PRIMARY KEY (capture_entry_id, tag_id)
);

CREATE TABLE IF NOT EXISTS schema_migration (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;

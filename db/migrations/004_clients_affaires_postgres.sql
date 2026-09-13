BEGIN;

CREATE TABLE IF NOT EXISTS business_client (
  id uuid PRIMARY KEY,
  client_type text NOT NULL DEFAULT 'COMPANY' CHECK (client_type IN ('COMPANY', 'INDIVIDUAL')),
  display_name text NOT NULL,
  legal_name text NULL,
  email text NULL,
  phone text NULL,
  billing_address_line1 text NULL,
  billing_address_line2 text NULL,
  billing_postal_code text NULL,
  billing_city text NULL,
  billing_country text NULL,
  created_by_user_id uuid NULL REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid NULL REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_client_display_name_idx
  ON business_client(lower(display_name));

CREATE TABLE IF NOT EXISTS client_contact (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES business_client(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  role_label text NULL,
  email text NULL,
  phone text NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_contact_client_idx
  ON client_contact(client_id, is_primary DESC, display_name);

CREATE TABLE IF NOT EXISTS affair (
  id uuid PRIMARY KEY,
  client_id uuid NULL REFERENCES business_client(id) ON DELETE SET NULL,
  primary_contact_id uuid NULL REFERENCES client_contact(id) ON DELETE SET NULL,
  source_entry_id uuid NULL UNIQUE REFERENCES capture_entry(id) ON DELETE SET NULL,
  name text NOT NULL,
  site_label text NULL,
  site_address_line1 text NULL,
  site_address_line2 text NULL,
  site_postal_code text NULL,
  site_city text NULL,
  description text NULL,
  next_action text NULL,
  status text NOT NULL DEFAULT 'PISTE'
    CHECK (status IN ('PISTE', 'CHIFFRAGE', 'WAITING', 'FOLLOW_UP', 'LIKELY', 'CONFIRMED', 'LOST', 'ABANDONED')),
  review_date date NULL,
  expected_confirmation_date date NULL,
  planned_install_date date NULL,
  confirmed_at timestamptz NULL,
  closed_at timestamptz NULL,
  closing_reason text NULL,
  created_by_user_id uuid NULL REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by_user_id uuid NULL REFERENCES app_user(id) ON DELETE SET NULL,
  created_by_name text NOT NULL,
  updated_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affair_status_updated_idx
  ON affair(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS affair_client_idx
  ON affair(client_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS affair_review_idx
  ON affair(review_date, status);
CREATE INDEX IF NOT EXISTS affair_confirmation_idx
  ON affair(expected_confirmation_date, status);

CREATE TABLE IF NOT EXISTS affair_history (
  id uuid PRIMARY KEY,
  affair_id uuid NOT NULL REFERENCES affair(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid NULL REFERENCES app_user(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  summary text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affair_history_affair_idx
  ON affair_history(affair_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS affair_document (
  id uuid PRIMARY KEY,
  affair_id uuid NOT NULL REFERENCES affair(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL,
  storage_path text NOT NULL,
  category text NOT NULL CHECK (category IN ('RECEIVED', 'INTERNAL_QUOTING', 'QUOTE', 'COSTING', 'MISC')),
  version_label text NULL,
  variant_label text NULL,
  is_current boolean NOT NULL DEFAULT true,
  legacy_signed_quote boolean NOT NULL DEFAULT false,
  uploaded_by_user_id uuid NULL REFERENCES app_user(id) ON DELETE SET NULL,
  uploaded_by_name text NOT NULL,
  uploaded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affair_id, id),
  UNIQUE (storage_path)
);
CREATE INDEX IF NOT EXISTS affair_document_affair_idx
  ON affair_document(affair_id, uploaded_at DESC);

COMMIT;

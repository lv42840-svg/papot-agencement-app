BEGIN;

ALTER TABLE capture_entry
  ADD COLUMN IF NOT EXISTS structured_description text NULL,
  ADD COLUMN IF NOT EXISTS next_action text NULL,
  ADD COLUMN IF NOT EXISTS assignee_user_id uuid NULL REFERENCES app_user(id),
  ADD COLUMN IF NOT EXISTS snoozed_until_date date NULL,
  ADD COLUMN IF NOT EXISTS result text NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS parent_entry_id uuid NULL REFERENCES capture_entry(id) ON DELETE SET NULL;

ALTER TABLE capture_entry DROP CONSTRAINT IF EXISTS capture_entry_status_check;

UPDATE capture_entry
SET status = 'ASSIGNED',
    assignee_user_id = COALESCE(assignee_user_id, responsible_user_id),
    updated_at = now()
WHERE status = 'QUALIFIED';

ALTER TABLE capture_entry
  ADD CONSTRAINT capture_entry_status_check
  CHECK (status IN ('TO_QUALIFY', 'ASSIGNED', 'DONE'));

CREATE INDEX IF NOT EXISTS capture_entry_assignee_idx
  ON capture_entry(assignee_user_id, status, due_at);
CREATE INDEX IF NOT EXISTS capture_entry_parent_idx
  ON capture_entry(parent_entry_id);

CREATE TABLE IF NOT EXISTS capture_entry_history (
  id uuid PRIMARY KEY,
  capture_entry_id uuid NOT NULL REFERENCES capture_entry(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid NULL REFERENCES app_user(id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  summary text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capture_entry_history_entry_idx
  ON capture_entry_history(capture_entry_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS capture_notification (
  id uuid PRIMARY KEY,
  capture_entry_id uuid NOT NULL REFERENCES capture_entry(id) ON DELETE CASCADE,
  recipient_user_id uuid NULL REFERENCES app_user(id) ON DELETE SET NULL,
  recipient_name text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL,
  read_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS capture_notification_recipient_idx
  ON capture_notification(recipient_user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS capture_notification_entry_idx
  ON capture_notification(capture_entry_id, created_at DESC);

ALTER TABLE capture_attachment
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid NULL REFERENCES app_user(id) ON DELETE SET NULL;

INSERT INTO capture_tag(id, label, slug, is_active, sort_order)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'Contact', 'contact', true, 0),
  ('00000000-0000-4000-8000-000000000002', 'Devis', 'devis', true, 1),
  ('00000000-0000-4000-8000-000000000003', 'Chiffrage seul', 'chiffrage-seul', true, 2),
  ('00000000-0000-4000-8000-000000000004', 'SAV', 'sav', true, 3),
  ('00000000-0000-4000-8000-000000000005', 'Intervention chantier', 'intervention-chantier', true, 4),
  ('00000000-0000-4000-8000-000000000006', 'Compte rendu de chantier', 'compte-rendu-chantier', true, 5)
ON CONFLICT (slug) DO UPDATE SET
  label = EXCLUDED.label,
  is_active = true,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

COMMIT;

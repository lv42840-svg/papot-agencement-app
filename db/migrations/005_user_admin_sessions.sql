BEGIN;

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_lower_uidx
  ON app_user(lower(email));

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

-- Before this migration, permission administrators implicitly bypassed module and special
-- permission checks. Preserve their effective access explicitly, then the application can
-- keep administration privilege independent from business permissions.
INSERT INTO user_module_permission(user_id, module_key, access_level)
SELECT u.id, module_key, 'WRITE'
FROM app_user u
CROSS JOIN unnest(ARRAY[
  'capture', 'commercial', 'quotes', 'chantiers', 'planning', 'hours',
  'purchases', 'billing', 'treasury', 'team', 'payroll', 'pilotage', 'settings'
]) AS module_key
WHERE u.can_manage_permissions = true
ON CONFLICT (user_id, module_key) DO UPDATE SET access_level = EXCLUDED.access_level;

INSERT INTO user_special_permission(user_id, permission_key, enabled)
SELECT u.id, permission_key, true
FROM app_user u
CROSS JOIN unnest(ARRAY[
  'commercial.create',
  'commercial.provision',
  'commercial.confirm_launch',
  'planning.edit_macro',
  'planning.edit_daily',
  'planning.enter_actual_hours',
  'planning.manage_schedules',
  'chantiers.archive_reactivate',
  'purchases.view_supplier_credentials',
  'purchases.send_orders',
  'purchases.mark_paid',
  'dashboard.view_global'
]) AS permission_key
WHERE u.can_manage_permissions = true
ON CONFLICT (user_id, permission_key) DO UPDATE SET enabled = true;

COMMIT;

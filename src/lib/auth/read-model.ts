import "server-only";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";

const identitySchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  email: z.string(),
  accentKey: z.string(),
  planningPotentialCollapsed: z.boolean(),
  canManagePermissions: z.boolean(),
  mustChangePassword: z.boolean(),
});
const permissionsSchema = z.object({
  modulePermissions: z.record(z.enum(["READ", "WRITE"])),
  specialPermissions: z.array(z.string()),
});
export type AuthIdentity = z.infer<typeof identitySchema>;
export type UserPermissions = z.infer<typeof permissionsSchema>;
type Queryable = Pool | PoolClient;

/** No credential hashes or unrelated sessions are read on the ordinary request path. */
export async function readSessionIdentityFromDb(
  db: Queryable,
  hash: string,
): Promise<AuthIdentity | null> {
  const result = await db.query(
    `SELECT u.id, u.username, u.display_name AS "displayName", u.email,
    u.accent_key AS "accentKey", COALESCE(u.planning_potential_collapsed, FALSE) AS "planningPotentialCollapsed",
    u.can_manage_permissions AS "canManagePermissions", u.must_change_password AS "mustChangePassword"
    FROM papot_auth_sessions s JOIN papot_auth_users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > clock_timestamp() AND u.is_active = TRUE`,
    [hash],
  );
  return result.rows[0] ? identitySchema.parse(result.rows[0]) : null;
}
export async function readUserPermissionsFromDb(
  db: Queryable,
  userId: string,
): Promise<UserPermissions | null> {
  // Invalid identifiers fail closed, including callers outside the HTTP validation layer.
  if (!z.string().uuid().safeParse(userId).success) return null;
  const result = await db.query(
    `SELECT module_permissions AS "modulePermissions", special_permissions AS "specialPermissions"
    FROM papot_auth_users WHERE id = $1 AND is_active = TRUE`,
    [userId],
  );
  return result.rows[0] ? permissionsSchema.parse(result.rows[0]) : null;
}

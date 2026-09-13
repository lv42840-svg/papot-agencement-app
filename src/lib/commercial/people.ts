import "server-only";

import { db } from "@/lib/db/pool";

export type CommercialAssignableUser = {
  id: string;
  displayName: string;
};

export async function listCommercialAssignableUsers(): Promise<CommercialAssignableUser[]> {
  const result = await db.query<{ id: string; display_name: string }>(
    `SELECT DISTINCT u.id, u.display_name
     FROM app_user u
     LEFT JOIN user_module_permission p
       ON p.user_id = u.id
      AND p.module_key = 'commercial'
     WHERE u.is_active = true
       AND (
         u.can_manage_permissions = true
         OR p.access_level IN ('READ', 'WRITE')
       )
     ORDER BY u.display_name`,
  );

  return result.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
  }));
}

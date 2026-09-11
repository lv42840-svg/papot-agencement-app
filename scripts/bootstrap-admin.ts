import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPassword } from "../src/lib/auth/password";

const connectionString = process.env.DATABASE_URL;
const name = process.env.BOOTSTRAP_ADMIN_NAME;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!connectionString || !name || !email || !password) {
  throw new Error("DATABASE_URL and BOOTSTRAP_ADMIN_* variables are required");
}
if (password.length < 12 || password.includes("change-me")) {
  throw new Error("Use a real bootstrap password of at least 12 characters");
}

const pool = new Pool({ connectionString });

async function main() {
  const id = randomUUID();
  const passwordHash = await hashPassword(password!);
  const result = await pool.query<{ id: string }>(
    `INSERT INTO app_user(id, display_name, email, password_hash, can_manage_permissions)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (email) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       password_hash = EXCLUDED.password_hash,
       can_manage_permissions = true,
       is_active = true
     RETURNING id`,
    [id, name, email, passwordHash],
  );
  const userId = result.rows[0]!.id;

  await pool.query(
    `INSERT INTO user_module_permission(user_id, module_key, access_level)
     VALUES ($1, 'capture', 'WRITE')
     ON CONFLICT (user_id, module_key) DO UPDATE SET access_level = 'WRITE'`,
    [userId],
  );

  console.log(`Bootstrap administrator ready: ${email}`);
}

main().finally(() => pool.end());

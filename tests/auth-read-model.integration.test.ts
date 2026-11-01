import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readSessionIdentityFromDb, readUserPermissionsFromDb } from "../src/lib/auth/read-model";
import { getServerDbPool, closeServerDbPool } from "../src/lib/server-db/pool";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
const suite = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;
suite("targeted auth reads", () => {
  beforeAll(async () => {
    await runServerDbMigrations();
  });
  afterAll(closeServerDbPool);
  it("reflects permission changes, expiration, revocation and account deactivation without stale caching", async () => {
    const client = await getServerDbPool().connect();
    const id = randomUUID(),
      token = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO papot_auth_users (id,username,display_name,email,password_hash,is_active,can_manage_permissions,must_change_password,accent_key,module_permissions,special_permissions)
        VALUES ($1,$2,'Test',$3,'secret-hash',TRUE,FALSE,FALSE,'lavender','{"quotes":"READ"}','[]')`,
        [id, "test-" + id, id + "@example.test"],
      );
      await client.query(
        `INSERT INTO papot_auth_sessions(id,user_id,token_hash,created_at,expires_at) VALUES($1,$2,$3,NOW(),NOW()+INTERVAL '1 hour')`,
        [randomUUID(), id, token],
      );
      const identity = await readSessionIdentityFromDb(client, token);
      expect(identity?.id).toBe(id);
      expect(identity).not.toHaveProperty("passwordHash");
      expect((await readUserPermissionsFromDb(client, id))?.modulePermissions.quotes).toBe("READ");
      await client.query(
        `UPDATE papot_auth_users SET module_permissions='{}', is_active=FALSE WHERE id=$1`,
        [id],
      );
      expect(await readSessionIdentityFromDb(client, token)).toBeNull();
      expect(await readUserPermissionsFromDb(client, id)).toBeNull();
      await client.query(`UPDATE papot_auth_users SET is_active=TRUE WHERE id=$1`, [id]);
      expect((await readUserPermissionsFromDb(client, id))?.modulePermissions).toEqual({});
      await client.query(
        `UPDATE papot_auth_sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=$1`,
        [token],
      );
      expect(await readSessionIdentityFromDb(client, token)).toBeNull();
      await client.query(`DELETE FROM papot_auth_sessions WHERE token_hash=$1`, [token]);
      expect(await readSessionIdentityFromDb(client, token)).toBeNull();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AuthPayload } from "../src/lib/auth/domain";
import { createPostgresAuthRepository } from "../src/lib/auth/postgres-repository";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

const initialPayload: AuthPayload = {
  schemaVersion: 1,
  users: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Nadia",
      email: "nadia@example.test",
      passwordHash: "scrypt$nadia$hash",
      isActive: true,
      canManagePermissions: true,
      mustChangePassword: false,
      accentKey: "lavender",
      modulePermissions: { clients: "WRITE", planning: "WRITE" },
      specialPermissions: ["planning.edit.grand", "planning.edit.petit"],
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      displayName: "Atelier",
      email: "atelier@example.test",
      passwordHash: "scrypt$atelier$hash",
      isActive: true,
      canManagePermissions: false,
      mustChangePassword: true,
      accentKey: "lavender",
      modulePermissions: { clients: "READ", planning: "READ" },
      specialPermissions: [],
    },
  ],
  sessions: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      userId: "11111111-1111-4111-8111-111111111111",
      tokenHash: "token-hash-nadia",
      deviceId: "44444444-4444-4444-8444-444444444444",
      deviceLabel: "Bureau Nadia",
      createdAt: "2026-09-14T08:00:00.000Z",
      expiresAt: "2026-09-14T20:00:00.000Z",
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      userId: "22222222-2222-4222-8222-222222222222",
      tokenHash: "token-hash-atelier",
      deviceId: null,
      deviceLabel: null,
      createdAt: "2026-09-14T08:05:00.000Z",
      expiresAt: "2026-09-14T20:05:00.000Z",
    },
  ],
};

describeWithPostgres("Auth PostgreSQL foundation", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM papot_auth_sessions");
    await pool.query("DELETE FROM papot_auth_users");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM papot_auth_sessions");
    await pool.query("DELETE FROM papot_auth_users");
    await closeServerDbPool();
  });

  it("installs the Auth storage migration", async () => {
    const migration = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_schema_migrations WHERE version = 3 AND name = 'auth_postgres_storage'",
    );
    const tables = await pool.query<{ users: string | null; sessions: string | null }>(
      "SELECT to_regclass('papot_auth_users')::text AS users, to_regclass('papot_auth_sessions')::text AS sessions",
    );

    expect(migration.rows[0]?.count).toBe("1");
    expect(tables.rows[0]).toEqual({
      users: "papot_auth_users",
      sessions: "papot_auth_sessions",
    });
  });

  it("round-trips users, password hashes, permissions and sessions without changing them", async () => {
    const repository = createPostgresAuthRepository(pool);

    await repository.replaceSnapshot(initialPayload);

    await expect(repository.load()).resolves.toEqual(initialPayload);

    const versions = await pool.query<{ id: string; version: number }>(
      "SELECT id, version FROM papot_auth_users ORDER BY id",
    );
    expect(versions.rows).toEqual([
      { id: initialPayload.users[0].id, version: 1 },
      { id: initialPayload.users[1].id, version: 1 },
    ]);
  });

  it("keeps the previous snapshot when a replacement violates unique email protection", async () => {
    const repository = createPostgresAuthRepository(pool);
    await repository.replaceSnapshot(initialPayload);

    const invalidReplacement: AuthPayload = {
      ...initialPayload,
      users: [
        initialPayload.users[0],
        {
          ...initialPayload.users[1],
          email: "NADIA@example.test",
        },
      ],
      sessions: [],
    };

    await expect(repository.replaceSnapshot(invalidReplacement)).rejects.toMatchObject({
      code: "23505",
    });
    await expect(repository.load()).resolves.toEqual(initialPayload);
  });
});

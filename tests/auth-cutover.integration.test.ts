import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { authPayloadHash, ensureAuthPostgresCutover } from "../src/lib/auth/cutover";
import type { AuthPayload } from "../src/lib/auth/domain";
import { createPostgresAuthRepository } from "../src/lib/auth/postgres-repository";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

const sourcePayload: AuthPayload = {
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
      expiresAt: "2027-09-14T20:00:00.000Z",
    },
  ],
};

describeWithPostgres("Auth PostgreSQL cutover", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'auth'");
    await pool.query("DELETE FROM papot_auth_sessions");
    await pool.query("DELETE FROM papot_auth_users");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'auth'");
    await pool.query("DELETE FROM papot_auth_sessions");
    await pool.query("DELETE FROM papot_auth_users");
    await closeServerDbPool();
  });

  it("imports the locked Nextcloud snapshot exactly once and preserves its hash", async () => {
    let acquisitions = 0;
    let releases = 0;

    await ensureAuthPostgresCutover({
      pool,
      acquireSource: async () => {
        acquisitions += 1;
        return {
          payload: sourcePayload,
          release: async () => {
            releases += 1;
          },
        };
      },
    });

    const repository = createPostgresAuthRepository(pool);
    await expect(repository.load()).resolves.toEqual(sourcePayload);

    const marker = await pool.query<{
      source: string;
      source_hash: string;
      record_count: number;
    }>(
      "SELECT source, source_hash, record_count FROM papot_domain_cutovers WHERE domain = 'auth'",
    );
    expect(marker.rows[0]).toEqual({
      source: "nextcloud:AUTH/global",
      source_hash: authPayloadHash(sourcePayload),
      record_count: sourcePayload.users.length + sourcePayload.sessions.length,
    });

    await ensureAuthPostgresCutover({
      pool,
      acquireSource: async () => {
        throw new Error("SOURCE_MUST_NOT_BE_READ_AFTER_CUTOVER");
      },
    });

    expect(acquisitions).toBe(1);
    expect(releases).toBe(1);
  });

  it("refuses to overwrite PostgreSQL Auth data when no cutover marker exists", async () => {
    const repository = createPostgresAuthRepository(pool);
    const existingPayload: AuthPayload = {
      schemaVersion: 1,
      users: [{ ...sourcePayload.users[0], displayName: "PostgreSQL existing" }],
      sessions: [],
    };
    await repository.replaceSnapshot(existingPayload);

    let releases = 0;
    await expect(
      ensureAuthPostgresCutover({
        pool,
        acquireSource: async () => ({
          payload: sourcePayload,
          release: async () => {
            releases += 1;
          },
        }),
      }),
    ).rejects.toThrow("AUTH_CUTOVER_STATE_INVALID");

    expect(releases).toBe(1);
    await expect(repository.load()).resolves.toEqual(existingPayload);
  });

  it("serializes concurrent Auth mutations so both changes survive", async () => {
    await ensureAuthPostgresCutover({
      pool,
      acquireSource: async () => ({ payload: sourcePayload, release: async () => undefined }),
    });

    const repository = createPostgresAuthRepository(pool);
    let firstEnteredResolve!: () => void;
    let releaseFirstResolve!: () => void;
    const firstEntered = new Promise<void>((resolve) => {
      firstEnteredResolve = resolve;
    });
    const releaseFirst = new Promise<void>((resolve) => {
      releaseFirstResolve = resolve;
    });

    const firstMutation = repository.mutate(async (payload) => {
      const user = payload.users.find((candidate) => candidate.id === sourcePayload.users[0].id);
      if (!user) throw new Error("TEST_USER_NOT_FOUND");
      user.displayName = "Nadia modifiée";
      firstEnteredResolve();
      await releaseFirst;
    });

    await firstEntered;
    const secondMutation = repository.mutate((payload) => {
      const user = payload.users.find((candidate) => candidate.id === sourcePayload.users[1].id);
      if (!user) throw new Error("TEST_USER_NOT_FOUND");
      user.displayName = "Atelier modifié";
    });

    releaseFirstResolve();
    await Promise.all([firstMutation, secondMutation]);

    const finalPayload = await repository.load();
    expect(finalPayload.users.find((user) => user.id === sourcePayload.users[0].id)?.displayName).toBe(
      "Nadia modifiée",
    );
    expect(finalPayload.users.find((user) => user.id === sourcePayload.users[1].id)?.displayName).toBe(
      "Atelier modifié",
    );
  });
});

import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ensureLibraryPostgresCutover, librarySnapshotHash } from "../src/lib/library/cutover";
import { createPostgresLibraryRepository } from "../src/lib/library/postgres-repository";
import { createInitialLibraryPayload, parseLibraryPayload } from "../src/lib/library/storage";
import { runServerDbMigrations } from "../src/lib/server-db/migrations";
import { closeServerDbPool, getServerDbPool } from "../src/lib/server-db/pool";

const describeWithPostgres = process.env.PAPOT_DATABASE_URL ? describe : describe.skip;

const ownerA = {
  userId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  displayName: "Poste A",
};

const ownerB = {
  userId: "33333333-3333-4333-8333-333333333333",
  deviceId: "44444444-4444-4444-8444-444444444444",
  displayName: "Poste B",
};

function examplePayload() {
  return parseLibraryPayload({
    schemaVersion: 1,
    components: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        name: "Panneau mélaminé blanc",
        description: "",
        unit: "m²",
        costPriceCents: 10_000,
        marginPercent: 30,
        salePriceCents: 13_000,
      },
    ],
    ouvrages: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        name: "Meuble bas",
        description: "",
        components: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            componentId: "55555555-5555-4555-8555-555555555555",
            quantity: 2,
          },
        ],
      },
    ],
  });
}

function sourceSnapshot(params?: {
  version?: number;
  payload?: ReturnType<typeof createInitialLibraryPayload> | ReturnType<typeof examplePayload>;
  release?: () => Promise<void>;
}) {
  return {
    version: params?.version ?? 0,
    payload: params?.payload ?? createInitialLibraryPayload(),
    updatedAt: "2026-09-14T10:00:00.000Z",
    updatedByUserId: ownerA.userId,
    updatedByDeviceId: ownerA.deviceId,
    release: params?.release ?? (async () => undefined),
  };
}

describeWithPostgres("Library PostgreSQL cutover", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = getServerDbPool();
    await runServerDbMigrations(pool);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'library'");
    await pool.query("TRUNCATE TABLE papot_library_edit_lock");
    await pool.query("TRUNCATE TABLE papot_library_state");
  });

  afterAll(async () => {
    await pool.query("DELETE FROM papot_domain_cutovers WHERE domain = 'library'");
    await pool.query("TRUNCATE TABLE papot_library_edit_lock");
    await pool.query("TRUNCATE TABLE papot_library_state");
    await closeServerDbPool();
  });

  it("installs the Library state and edit-lock migration", async () => {
    const migration = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM papot_schema_migrations WHERE version = 7",
    );
    const tables = await pool.query<{
      library_state: string | null;
      library_lock: string | null;
    }>(
      `
        SELECT
          to_regclass('papot_library_state')::text AS library_state,
          to_regclass('papot_library_edit_lock')::text AS library_lock
      `,
    );

    expect(migration.rows[0]?.count).toBe("1");
    expect(tables.rows[0]).toEqual({
      library_state: "papot_library_state",
      library_lock: "papot_library_edit_lock",
    });
  });

  it("imports the locked Nextcloud catalog once and preserves version plus hash", async () => {
    const payload = examplePayload();
    const release = vi.fn(async () => undefined);
    const acquireSource = vi.fn(async () => sourceSnapshot({ version: 4, payload, release }));

    await ensureLibraryPostgresCutover({ pool, acquireSource });

    const marker = await pool.query<{
      source: string;
      source_hash: string;
      record_count: number;
    }>(
      "SELECT source, source_hash, record_count FROM papot_domain_cutovers WHERE domain = 'library'",
    );
    const repository = createPostgresLibraryRepository(ownerA, pool);

    await expect(repository.load()).resolves.toEqual({ version: 4, payload });
    expect(marker.rows[0]).toEqual({
      source: "nextcloud:LIBRARY/catalog",
      source_hash: librarySnapshotHash({ version: 4, payload }),
      record_count: 2,
    });
    expect(acquireSource).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);

    const shouldNotAcquire = vi.fn(async () => {
      throw new Error("source should not be read after cutover");
    });
    await ensureLibraryPostgresCutover({ pool, acquireSource: shouldNotAcquire });
    expect(shouldNotAcquire).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a PostgreSQL catalog without a cutover marker", async () => {
    const existing = examplePayload();
    await pool.query(
      `
        INSERT INTO papot_library_state (
          scope, version, payload, updated_at, updated_by_user_id, updated_by_device_id
        )
        VALUES ('catalog', 2, $1, $2, $3, $4)
      `,
      [existing, "2026-09-14T10:00:00.000Z", ownerA.userId, ownerA.deviceId],
    );
    const release = vi.fn(async () => undefined);

    await expect(
      ensureLibraryPostgresCutover({
        pool,
        acquireSource: async () => sourceSnapshot({ release }),
      }),
    ).rejects.toThrow("LIBRARY_CUTOVER_STATE_INVALID");

    const repository = createPostgresLibraryRepository(ownerA, pool);
    await expect(repository.load()).resolves.toEqual({ version: 2, payload: existing });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("allows only one editable Library session when two posts open concurrently", async () => {
    await ensureLibraryPostgresCutover({
      pool,
      acquireSource: async () => sourceSnapshot(),
    });

    const repositoryA = createPostgresLibraryRepository(ownerA, pool);
    const repositoryB = createPostgresLibraryRepository(ownerB, pool);
    const leaseA = "88888888-8888-4888-8888-888888888888";
    const leaseB = "99999999-9999-4999-8999-999999999999";

    const [openedA, openedB] = await Promise.all([
      repositoryA.open(leaseA),
      repositoryB.open(leaseB),
    ]);
    const results = [openedA, openedB];
    const editable = results.find((result) => result.status === "editable");
    const readOnly = results.find((result) => result.status === "read-only");

    expect(editable).toBeDefined();
    expect(readOnly).toBeDefined();
    expect(readOnly?.lock.owner_display_name).toBe(editable?.lock.owner_display_name);

    if (openedA.status === "editable") {
      await expect(repositoryA.release(leaseA)).resolves.toBe(true);
      await expect(repositoryB.open(leaseB)).resolves.toMatchObject({ status: "editable" });
    } else {
      await expect(repositoryB.release(leaseB)).resolves.toBe(true);
      await expect(repositoryA.open(leaseA)).resolves.toMatchObject({ status: "editable" });
    }
  });

  it("saves through the PostgreSQL lock and increments the catalog version", async () => {
    await ensureLibraryPostgresCutover({
      pool,
      acquireSource: async () => sourceSnapshot(),
    });

    const repository = createPostgresLibraryRepository(ownerA, pool);
    const leaseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const opened = await repository.open(leaseId);
    expect(opened.status).toBe("editable");

    const payload = examplePayload();
    const saved = await repository.save({
      leaseId,
      expectedVersion: 0,
      payload,
    });

    expect(saved.status).toBe("saved");
    if (saved.status === "saved") {
      expect(saved.resource.version).toBe(1);
      expect(saved.resource.payload).toEqual(payload);
    }
    await expect(repository.load()).resolves.toEqual({ version: 1, payload });
    await expect(repository.release(leaseId)).resolves.toBe(true);
  });

  it("returns a conflict if the catalog version changed after the edit session opened", async () => {
    await ensureLibraryPostgresCutover({
      pool,
      acquireSource: async () => sourceSnapshot(),
    });

    const repository = createPostgresLibraryRepository(ownerA, pool);
    const leaseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await repository.open(leaseId);

    await pool.query("UPDATE papot_library_state SET version = 1 WHERE scope = 'catalog'");

    const result = await repository.save({
      leaseId,
      expectedVersion: 0,
      payload: examplePayload(),
    });

    expect(result.status).toBe("conflict");
    if (result.status === "conflict") {
      expect(result.current?.version).toBe(1);
    }
    await expect(repository.release(leaseId)).resolves.toBe(true);
  });
});

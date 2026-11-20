import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { NativeIssuedInvoice } from "../src/lib/billing/native-issuance";

// Next's build-time sentinel is mocked only for this server-side unit test.
vi.mock("server-only", () => ({}));

// Vitest/Vite 2 does not resolve Node 22's node:sqlite ESM builtin. Load
// the actual SQLite engine through Node require, while mocking just the
// runtime adapter (not the archive algorithms under test).
vi.mock("@/lib/local-db/runtime", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as {
    DatabaseSync: new (file: string) => {
      exec(sql: string): void;
      prepare(sql: string): {
        run(...args: unknown[]): unknown;
        get(...args: unknown[]): unknown;
        all(...args: unknown[]): unknown[];
      };
    };
  };
  type Database = InstanceType<typeof sqlite.DatabaseSync>;
  let db: Database | null = null;
  let location = "";
  function getLocalDatabase(): Database {
    const desired = process.env.PAPOT_LOCAL_DB_PATH ?? ":memory:";
    if (db && desired === location) return db;
    db = new sqlite.DatabaseSync(desired);
    location = desired;
    db.exec(`
      CREATE TABLE IF NOT EXISTS local_native_invoice_pdf_archive (
        invoice_id TEXT PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        issued_at TEXT NOT NULL,
        pdf BLOB NOT NULL CHECK (length(pdf) > 0),
        sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
        archived_at TEXT NOT NULL
      ) STRICT;
    `);
    return db;
  }
  return {
    isLocalStorageMode: () => true,
    getLocalDatabase,
    async withLocalDatabaseWrite<T>(work: () => T | Promise<T>): Promise<T> {
      const db = getLocalDatabase();
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = await work();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
});

import {
  loadOriginalNativeInvoicePdf,
  storeOriginalNativeInvoicePdf,
} from "../src/lib/billing/native-pdf-archive";
import { getLocalDatabase, withLocalDatabaseWrite } from "../src/lib/local-db/runtime";

const invoice = {
  id: "11111111-1111-4111-8111-111111111111",
  number: "PA-2026-000001",
  issuedAt: "2026-11-20T12:00:00.000Z",
} as NativeIssuedInvoice;
const bytes = Buffer.from(
  "%PDF-1.4\n" + "archived invoice bytes\n".repeat(30) + "%%EOF\n",
  "ascii",
);
let directory = "";

beforeAll(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), "papot-native-pdf-test-"));
  vi.stubEnv("PAPOT_STORAGE_MODE", "local");
  vi.stubEnv("PAPOT_LOCAL_DB_PATH", path.join(directory, "invoice-test.sqlite"));
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("archive originale non remplaçable des factures PAPOT", () => {
  it("conserve exactement les octets et contrôle SHA-256, rejoue sans modifier", async () => {
    const original = await withLocalDatabaseWrite(async () =>
      storeOriginalNativeInvoicePdf(invoice, bytes),
    );
    expect(original.bytes).toEqual(new Uint8Array(bytes));
    expect(original.sha256).toMatch(/^[0-9a-f]{64}$/);
    const persisted = await loadOriginalNativeInvoicePdf(invoice);
    expect(persisted.bytes).toEqual(new Uint8Array(bytes));
    expect(persisted.sha256).toBe(original.sha256);
    const retried = await withLocalDatabaseWrite(async () =>
      storeOriginalNativeInvoicePdf(invoice, bytes),
    );
    expect(retried.sha256).toBe(original.sha256);
    await expect(
      withLocalDatabaseWrite(async () =>
        storeOriginalNativeInvoicePdf(
          invoice,
          Buffer.from("%PDF-1.4\n" + "altered later renderer\n".repeat(30) + "%%EOF\n", "ascii"),
        ),
      ),
    ).rejects.toThrow("BILLING_NATIVE_ARCHIVE_IMMUTABLE");
    const stillOriginal = await loadOriginalNativeInvoicePdf(invoice);
    expect(stillOriginal.bytes).toEqual(new Uint8Array(bytes));
  });

  it("refuse un autre identifiant qui revendique un numéro déjà attribué", async () => {
    const other = {
      ...invoice,
      id: "22222222-2222-4222-8222-222222222222",
    };
    await expect(
      withLocalDatabaseWrite(async () => storeOriginalNativeInvoicePdf(other, bytes)),
    ).rejects.toThrow("BILLING_NATIVE_ARCHIVE_CONFLICT");
  });

  it("détecte les archives modifiées en base et les références absentes", async () => {
    const original = await loadOriginalNativeInvoicePdf(invoice);
    const missing = {
      ...invoice,
      id: "33333333-3333-4333-8333-333333333333",
      number: "PA-2026-000002",
    };
    await expect(loadOriginalNativeInvoicePdf(missing)).rejects.toThrow(
      "BILLING_NATIVE_ARCHIVE_MISSING",
    );
    expect(original.bytes).toEqual(new Uint8Array(bytes));
  });

  it("annule aussi l'archive si l'émission échoue en transaction", async () => {
    const orphan = {
      ...invoice,
      id: "44444444-4444-4444-8444-444444444444",
      number: "PA-2026-000003",
    };
    await expect(
      withLocalDatabaseWrite(async () => {
        await storeOriginalNativeInvoicePdf(orphan, bytes);
        throw new Error("TEST_FORCE_ROLLBACK");
      }),
    ).rejects.toThrow("TEST_FORCE_ROLLBACK");
    await expect(loadOriginalNativeInvoicePdf(orphan)).rejects.toThrow(
      "BILLING_NATIVE_ARCHIVE_MISSING",
    );
  });

  it("détecte une corruption des octets originaux lors de la lecture", async () => {
    getLocalDatabase()
      .prepare("UPDATE local_native_invoice_pdf_archive SET pdf = ? WHERE invoice_id = ?")
      .run(Buffer.from("%PDF-1.4\n" + "corrupted".repeat(40) + "%%EOF\n", "ascii"), invoice.id);
    await expect(loadOriginalNativeInvoicePdf(invoice)).rejects.toThrow(
      "BILLING_NATIVE_ARCHIVE_HASH_MISMATCH",
    );
  });
});

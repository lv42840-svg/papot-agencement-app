import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const originalDatabasePath = process.env.PAPOT_LOCAL_DB_PATH;
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "papot-local-nested-write-"));
process.env.PAPOT_LOCAL_DB_PATH = path.join(temporaryDirectory, "papot-local.sqlite");

function parseStringList(value: unknown): string[] {
  if (value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("TEST_INVALID_STRING_LIST");
  }
  return value;
}

afterAll(() => {
  if (originalDatabasePath === undefined) delete process.env.PAPOT_LOCAL_DB_PATH;
  else process.env.PAPOT_LOCAL_DB_PATH = originalDatabasePath;
});

describe("local SQLite nested writes", () => {
  it("reuses the active transaction instead of deadlocking a nested repository write", async () => {
    const { mutateLocalSnapshot, readLocalSnapshot } = await import("../src/lib/local-db/runtime");

    await mutateLocalSnapshot("commercial-test", parseStringList, async ({ payload }) => {
      await mutateLocalSnapshot("clients-test", parseStringList, ({ payload: clients }) => ({
        payload: [...clients, "Nouveau client"],
        result: undefined,
      }));

      return {
        payload: [...payload, "Nouvelle affaire"],
        result: undefined,
      };
    });

    expect(readLocalSnapshot("clients-test", parseStringList).payload).toEqual(["Nouveau client"]);
    expect(readLocalSnapshot("commercial-test", parseStringList).payload).toEqual([
      "Nouvelle affaire",
    ]);
  });

  it("rolls back the nested client write when the outer affair write fails", async () => {
    const { mutateLocalSnapshot, readLocalSnapshot } = await import("../src/lib/local-db/runtime");
    const clientsBefore = readLocalSnapshot("clients-test", parseStringList);

    await expect(
      mutateLocalSnapshot("commercial-rollback-test", parseStringList, async ({ payload }) => {
        await mutateLocalSnapshot("clients-test", parseStringList, ({ payload: clients }) => ({
          payload: [...clients, "Client à annuler"],
          result: undefined,
        }));

        throw new Error(`AFFAIR_CREATION_FAILED:${payload.length}`);
      }),
    ).rejects.toThrow("AFFAIR_CREATION_FAILED");

    expect(readLocalSnapshot("clients-test", parseStringList)).toEqual(clientsBefore);
    expect(readLocalSnapshot("commercial-rollback-test", parseStringList)).toEqual({
      version: 0,
      payload: [],
    });
  });
});

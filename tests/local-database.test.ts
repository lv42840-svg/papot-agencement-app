import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const localDatabase = require("../desktop/local-database.cjs") as {
  DATABASE_FILE_NAME: string;
  LOCAL_DATABASE_SCHEMA_VERSION: number;
  getLocalSetting: (database: unknown, key: string) => unknown;
  openLocalDatabase: (userDataPath: string) => {
    close: () => void;
    prepare: (sql: string) => { get: (...values: unknown[]) => Record<string, unknown> };
  };
  setLocalSetting: (database: unknown, key: string, value: unknown) => void;
};

const temporaryDirectories: string[] = [];

function makeTempDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "papot-local-database-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("embedded local database", () => {
  it("creates a versioned SQLite database in the application data directory", () => {
    const userDataPath = makeTempDirectory();
    const database = localDatabase.openLocalDatabase(userDataPath);

    const schema = database.prepare("SELECT version FROM local_schema WHERE singleton = 1").get();
    expect(schema.version).toBe(localDatabase.LOCAL_DATABASE_SCHEMA_VERSION);
    expect(fs.existsSync(path.join(userDataPath, localDatabase.DATABASE_FILE_NAME))).toBe(true);
    database.close();
  });

  it("persists local settings after the database is reopened", () => {
    const userDataPath = makeTempDirectory();
    let database = localDatabase.openLocalDatabase(userDataPath);
    localDatabase.setLocalSetting(database, "interface.accent", { color: "#A78BFA" });
    database.close();

    database = localDatabase.openLocalDatabase(userDataPath);
    expect(localDatabase.getLocalSetting(database, "interface.accent")).toEqual({
      color: "#A78BFA",
    });
    database.close();
  });

  it("creates local cache, queue and business storage tables", () => {
    const database = localDatabase.openLocalDatabase(makeTempDirectory());
    for (const table of [
      "cache_entries",
      "pending_operations",
      "local_business_snapshots",
      "local_shared_resource_states",
      "local_shared_resource_locks",
    ]) {
      const row = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table);
      expect(row.name).toBe(table);
    }
    database.close();
  });

  it("refuses settings whose key indicates a secret", () => {
    const database = localDatabase.openLocalDatabase(makeTempDirectory());
    expect(() =>
      localDatabase.setLocalSetting(database, "nextcloud_app_password", "forbidden"),
    ).toThrow("LOCAL_SETTING_SECRET_FORBIDDEN");
    database.close();
  });
});

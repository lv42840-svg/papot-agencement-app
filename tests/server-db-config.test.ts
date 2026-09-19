import { describe, expect, it } from "vitest";

import { getServerDbConfig } from "../src/lib/server-db/config";

describe("central PostgreSQL configuration", () => {
  it("requires an explicit database URL before the central database is used", () => {
    expect(() => getServerDbConfig({})).toThrow("PAPOT_DATABASE_URL is required");
  });

  it("accepts a PostgreSQL URL and applies conservative pool defaults", () => {
    const config = getServerDbConfig({
      PAPOT_DATABASE_URL: "postgresql://papot:secret@papot-server:5432/papot",
    });

    expect(config).toEqual({
      connectionString: "postgresql://papot:secret@papot-server:5432/papot",
      applicationName: "papot-agencement",
      maxConnections: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  });

  it("rejects non-PostgreSQL protocols", () => {
    expect(() => getServerDbConfig({ PAPOT_DATABASE_URL: "https://papot-server/papot" })).toThrow(
      "must use the postgresql:// or postgres:// protocol",
    );
  });
});

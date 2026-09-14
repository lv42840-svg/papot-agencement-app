import { describe, expect, it } from "vitest";
import { hasDesktopDatabaseConfig } from "../src/lib/desktop/database-config";

describe("desktop database configuration guard", () => {
  it("returns false when PAPOT_DATABASE_URL is missing or blank", () => {
    expect(hasDesktopDatabaseConfig({})).toBe(false);
    expect(hasDesktopDatabaseConfig({ PAPOT_DATABASE_URL: "   " })).toBe(false);
  });

  it("returns true when PAPOT_DATABASE_URL is configured", () => {
    expect(
      hasDesktopDatabaseConfig({
        PAPOT_DATABASE_URL: "postgresql://papot:papot@server:5432/papot",
      }),
    ).toBe(true);
  });
});

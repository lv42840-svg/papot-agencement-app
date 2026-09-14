import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const startRoute = require("../desktop/start-route.cjs") as {
  hasDatabaseConfig: (env?: Record<string, string | undefined>) => boolean;
  selectDesktopStartPath: (input: {
    setupComplete: boolean;
    env?: Record<string, string | undefined>;
  }) => string;
};

describe("desktop startup route", () => {
  it("opens the server-required screen before any business route when PostgreSQL is not configured", () => {
    expect(startRoute.selectDesktopStartPath({ setupComplete: true, env: {} })).toBe(
      "/desktop-server-required",
    );
    expect(
      startRoute.selectDesktopStartPath({
        setupComplete: false,
        env: { PAPOT_DATABASE_URL: "   " },
      }),
    ).toBe("/desktop-server-required");
  });

  it("keeps the normal setup and ready routes when PostgreSQL is configured", () => {
    const env = { PAPOT_DATABASE_URL: "postgresql://papot:papot@server:5432/papot" };
    expect(startRoute.selectDesktopStartPath({ setupComplete: false, env })).toBe("/desktop-setup");
    expect(startRoute.selectDesktopStartPath({ setupComplete: true, env })).toBe("/desktop-ready");
  });
});

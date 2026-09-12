import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  isAllowedDesktopNavigation,
  normalizeLocalAppUrl,
}: {
  isAllowedDesktopNavigation: (targetUrl: string, appUrl: string) => boolean;
  normalizeLocalAppUrl: (value?: string) => string;
} = require("../desktop/security.cjs");

describe("desktop shell security policy", () => {
  it("accepts the local PAPOT origin", () => {
    expect(normalizeLocalAppUrl("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  });

  it("accepts localhost for development", () => {
    expect(normalizeLocalAppUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("rejects a remote web origin", () => {
    expect(() => normalizeLocalAppUrl("https://example.com")).toThrow(
      "DESKTOP_APP_URL_HTTP_REQUIRED",
    );
  });

  it("rejects a non-local HTTP origin", () => {
    expect(() => normalizeLocalAppUrl("http://192.168.1.20:3000")).toThrow(
      "DESKTOP_APP_URL_LOCALHOST_REQUIRED",
    );
  });

  it("allows navigation inside the same local PAPOT origin", () => {
    expect(
      isAllowedDesktopNavigation(
        "http://127.0.0.1:3000/tasks",
        "http://127.0.0.1:3000",
      ),
    ).toBe(true);
  });

  it("blocks navigation outside the PAPOT origin", () => {
    expect(
      isAllowedDesktopNavigation("https://example.com", "http://127.0.0.1:3000"),
    ).toBe(false);
  });
});

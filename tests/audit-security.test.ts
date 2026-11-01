import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { safePreviewType } from "../src/lib/server-files/preview";
import { assertEditRevision } from "../src/lib/edit-history";
vi.mock("server-only", () => ({}));
import { withServerDbTransaction } from "../src/lib/server-db/transaction";
import type { Pool } from "pg";

describe("audit security regressions", () => {
  it("forces SVG and disguised HTML to download while allowing verified passive images", () => {
    expect(
      safePreviewType(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      ),
    ).toBeNull();
    expect(safePreviewType(Buffer.from("<html>not a JPEG</html>"))).toBeNull();
    expect(safePreviewType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("image/png");
    expect(safePreviewType(Buffer.from([255, 216, 255, 224]))).toBe("image/jpeg");
  });
  it("does not intercept authenticated pages, API responses or RSC payloads", () => {
    const handlers = new Map<string, (event: unknown) => void>();
    vm.runInNewContext(readFileSync("public/sw.js", "utf8"), {
      self: {
        location: { origin: "https://papot.test" },
        addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn),
      },
      URL,
    });
    for (const path of [
      "/capture",
      "/devis/123",
      "/api/desktop/billing",
      "/heures?_rsc=123",
      "/login",
    ]) {
      const respondWith = vi.fn();
      handlers.get("fetch")!({
        request: { method: "GET", url: `https://papot.test${path}` },
        respondWith,
      });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });
  it("rejects stale, missing and malformed edit revisions", () => {
    expect(() => assertEditRevision(0, 0)).not.toThrow();
    for (const revision of [undefined, null, "1", -1, 0])
      expect(() => assertEditRevision(revision, 1)).toThrow("EDIT_VERSION_CONFLICT");
  });
  it("rolls back the entire nested operation even when an inner error is caught", async () => {
    const query = vi.fn(async (_sql: string) => ({}));
    const release = vi.fn();
    const pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
    await expect(
      withServerDbTransaction(async () => {
        await withServerDbTransaction(async () => {
          throw new Error("planning unavailable");
        }, pool).catch(() => undefined);
      }, pool),
    ).rejects.toThrow("TRANSACTION_ABORTED");
    expect(query.mock.calls.map((args) => args[0])).toEqual(["BEGIN", "ROLLBACK"]);
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
});

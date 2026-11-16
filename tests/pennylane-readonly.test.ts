import { describe, expect, it, vi } from "vitest";
import { getPennylaneConfig, PENNYLANE_RESOURCES } from "../src/lib/pennylane/config";
import { listPennylaneResource, verifyPennylaneCompany } from "../src/lib/pennylane/client";
import { preparePennylaneSnapshot } from "../src/lib/pennylane/sync";

const config = { token: "fake-test-token-never-deployed", expectedCompany: "PAPOT LIBERAL" };
const enabled = {
  PAPOT_PENNYLANE_ENABLED: "true",
  PAPOT_PENNYLANE_API_TOKEN: config.token,
  PAPOT_PENNYLANE_EXPECTED_COMPANY: config.expectedCompany,
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Pennylane V2 read-only staged connector", () => {
  it("is disabled by default and requires a token and expected company", () => {
    expect(() => getPennylaneConfig({})).toThrow("PENNYLANE_DISABLED");
    expect(() => getPennylaneConfig({ PAPOT_PENNYLANE_ENABLED: "true" })).toThrow(
      "PENNYLANE_NOT_CONFIGURED",
    );
    expect(getPennylaneConfig(enabled)).toEqual(config);
  });

  it("verifies the company before importing anything", async () => {
    const ok = vi.fn().mockResolvedValue(reply({ company: { name: "PAPOT LIBERAL" } }));
    await expect(verifyPennylaneCompany(config, ok)).resolves.toBe("PAPOT LIBERAL");
    expect(ok).toHaveBeenCalledTimes(1);
    expect(ok.mock.calls[0][0]).toBe("https://app.pennylane.com/api/external/v2/me");

    const wrong = vi.fn().mockResolvedValue(reply({ company: { name: "OTHER" } }));
    await expect(verifyPennylaneCompany(config, wrong)).rejects.toThrow(
      "PENNYLANE_COMPANY_MISMATCH",
    );
  });

  it("uses only GET, follows cursor pages and removes duplicate external IDs", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        reply({
          items: [
            { id: 1, name: "A" },
            { id: 2, name: "B" },
          ],
          has_more: true,
          next_cursor: "opaque==",
        }),
      )
      .mockResolvedValueOnce(
        reply({
          items: [
            { id: 2, name: "B updated" },
            { id: 3, name: "C" },
          ],
          has_more: false,
          next_cursor: null,
        }),
      );
    const items = await listPennylaneResource("suppliers", config, fetcher);
    expect(items).toHaveLength(3);
    expect(items.find((item) => item.id === 2)?.name).toBe("B updated");
    const second = new URL(fetcher.mock.calls[1][0]);
    expect(second.searchParams.get("cursor")).toBe("opaque==");
    expect(second.searchParams.get("limit")).toBe("100");
    for (const [, options] of fetcher.mock.calls) {
      expect(options.method).toBe("GET");
      expect(options.headers.Authorization).toBe("Bearer " + config.token);
    }
  });

  it("rejects 403 without leaking the upstream response or token", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      reply(
        {
          error: "Access to this resource requires scope",
          token: config.token,
        },
        403,
      ),
    );
    await expect(listPennylaneResource("suppliers", config, fetcher)).rejects.toThrow(
      "PENNYLANE_SCOPE_FORBIDDEN",
    );
  });

  it("rejects invalid cursors and malformed responses instead of treating them as empty", async () => {
    const invalidCursor = vi.fn().mockResolvedValue(
      reply({
        items: [{ id: 1 }],
        has_more: true,
        next_cursor: null,
      }),
    );
    await expect(listPennylaneResource("customers", config, invalidCursor)).rejects.toThrow(
      "PENNYLANE_CURSOR_INVALID",
    );

    const invalidPage = vi
      .fn()
      .mockResolvedValue(reply({ items: [], has_more: null, next_cursor: null }));
    await expect(listPennylaneResource("customers", config, invalidPage)).rejects.toThrow(
      "PENNYLANE_PAGE_INVALID",
    );
  });

  it("fetches all four resource types after company check without making mutations", async () => {
    const fetcher = vi.fn().mockImplementation(async (value: string, options: RequestInit) => {
      expect(options.method).toBe("GET");
      const url = new URL(value);
      if (url.pathname.endsWith("/me")) return reply({ company: { name: "PAPOT LIBERAL" } });
      return reply({
        items: [{ id: url.pathname.split("/").pop(), value: 1 }],
        has_more: false,
        next_cursor: null,
      });
    });
    const snapshot = await preparePennylaneSnapshot(enabled, fetcher);
    expect(snapshot.companyName).toBe("PAPOT LIBERAL");
    for (const resource of PENNYLANE_RESOURCES) {
      expect(snapshot.records[resource]).toHaveLength(1);
    }
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("never returns a partial dataset when one resource is forbidden", async () => {
    const fetcher = vi.fn().mockImplementation(async (value: string) => {
      if (value.endsWith("/me")) return reply({ company: { name: "PAPOT LIBERAL" } });
      if (value.includes("supplier_invoices")) return reply({ error: "forbidden" }, 403);
      return reply({ items: [], has_more: false, next_cursor: null });
    });
    await expect(preparePennylaneSnapshot(enabled, fetcher)).rejects.toThrow(
      "PENNYLANE_SCOPE_FORBIDDEN",
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

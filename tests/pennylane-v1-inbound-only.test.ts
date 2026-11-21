import { describe, expect, it } from "vitest";
import { listPennylaneResource, verifyPennylaneCompany } from "../src/lib/pennylane/client";

const config = { token: "token-fictif", expectedCompany: "PAPOT LIBERAL" };

describe("Pennylane V1 : consultations entrantes seulement", () => {
  it("n'utilise que des requêtes GET pour vérifier la société et lire des factures", async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), method: init?.method });
      const response = String(input).endsWith("/me")
        ? { company: { name: "PAPOT LIBERAL" } }
        : { items: [{ id: 42 }], has_more: false, next_cursor: null };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
    expect(await verifyPennylaneCompany(config, fakeFetch)).toBe("PAPOT LIBERAL");
    expect(await listPennylaneResource("customer_invoices", config, fakeFetch)).toEqual([
      { id: 42 },
    ]);
    expect(await listPennylaneResource("supplier_invoices", config, fakeFetch)).toEqual([
      { id: 42 },
    ]);
    expect(calls.map((call) => call.method)).toEqual(["GET", "GET", "GET"]);
    expect(calls[1].url).toContain("/customer_invoices?");
    expect(calls[2].url).toContain("/supplier_invoices?");
  });
});

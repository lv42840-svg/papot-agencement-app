import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pennylane/config", () => ({
  pennylaneEnabled: vi.fn(() => true),
}));
vi.mock("@/lib/pennylane/sync", () => ({
  synchronizePennylane: vi.fn(),
}));

import { POST } from "../src/app/api/internal/pennylane/sync/route";
import { synchronizePennylane } from "@/lib/pennylane/sync";

const token = "1".repeat(64);
const invoke = (value?: string) =>
  POST(
    new Request("http://127.0.0.1:3002/api/internal/pennylane/sync", {
      method: "POST",
      headers: value ? { Authorization: value } : {},
    }),
  );

describe("tâche interne Pennylane", () => {
  beforeEach(() => {
    vi.stubEnv("PAPOT_PENNYLANE_SYNC_SECRET", token);
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejette les requêtes sans le secret prévu sans lancer de synchronisation", async () => {
    for (const header of [undefined, "Bearer invalid", "Bearer " + "2".repeat(64)]) {
      const response = await invoke(header);
      expect(response.status).toBe(401);
      expect((await response.json()).error).toBe("SYNC_UNAUTHORIZED");
    }
    expect(synchronizePennylane).not.toHaveBeenCalled();
  });

  it("déclenche les mêmes imports et FG qu'un clic manuel, sans renvoyer de données comptables", async () => {
    vi.mocked(synchronizePennylane).mockResolvedValueOnce({
      companyName: "Entreprise test",
      counts: { suppliers: 3, supplier_invoices: 10, customers: 4, customer_invoices: 8 },
      generalExpenses: {
        supplierCount: 2,
        matchingSupplierInvoices: 5,
        assigned: 3,
        skippedExisting: 2,
        skippedChantierOrder: 0,
        skippedDuplicate: 0,
        skippedInvalid: 0,
      },
    });
    const response = await invoke("Bearer " + token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      counts: { suppliers: 3, supplier_invoices: 10, customers: 4, customer_invoices: 8 },
      generalExpensesAssigned: 3,
    });
    expect(synchronizePennylane).toHaveBeenCalledWith("PAPOT · synchronisation programmée");
  });

  it("refuse le chevauchement et dissimule les erreurs internes", async () => {
    vi.mocked(synchronizePennylane).mockRejectedValueOnce(new Error("PENNYLANE_SYNC_IN_PROGRESS"));
    const busy = await invoke("Bearer " + token);
    expect(busy.status).toBe(409);
    expect((await busy.json()).error).toBe("PENNYLANE_SYNC_IN_PROGRESS");

    vi.mocked(synchronizePennylane).mockRejectedValueOnce(
      new Error("sensitive-pennylane-response"),
    );
    const failed = await invoke("Bearer " + token);
    expect(failed.status).toBe(503);
    const body = await failed.text();
    expect(body).toContain("PENNYLANE_SCHEDULED_SYNC_FAILED");
    expect(body).not.toContain("sensitive-pennylane-response");
  });
});

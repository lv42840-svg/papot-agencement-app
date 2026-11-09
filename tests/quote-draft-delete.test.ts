import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyQuotesMutation, quotesMutationSchema } from "../src/lib/quotes/mutations";
import {
  createInitialNativeQuotesPayload,
  type NativeQuotesPayload,
} from "../src/lib/quotes/store";
import { quoteStatusSchema } from "../src/lib/quotes/domain";
import type { QuotesMutationTransform } from "../src/lib/quotes/repository";
import { quoteRevisionHeaders } from "../src/lib/quotes/concurrency";

vi.mock("server-only", () => ({}));
vi.mock("../src/lib/local-db/runtime", () => ({ isLocalStorageMode: () => true }));
const state = vi.hoisted(() => ({ payload: null as NativeQuotesPayload | null, canWrite: true }));
vi.mock("../src/lib/quotes/local-repository", () => ({
  createLocalQuotesRepository: () => ({
    load: async () => state.payload,
    mutate: async (transform: QuotesMutationTransform) => {
      const result = await transform(structuredClone(state.payload!));
      state.payload = result.payload;
      return result;
    },
  }),
}));
vi.mock("../src/lib/desktop/request-context", () => ({
  requireModuleRequestContext: async () => {
    if (!state.canWrite) throw new Error("MODULE_FORBIDDEN");
    return { user: { id: "test", displayName: "Nadia" }, moduleAccess: { canWrite: true } };
  },
  desktopRequestErrorStatus: (code: string) => (code === "MODULE_FORBIDDEN" ? 403 : null),
}));
import { POST } from "../src/app/api/desktop/quotes/route";

const actor = { userId: "11111111-1111-4111-8111-111111111111", displayName: "Nadia" };
function draft(source = createInitialNativeQuotesPayload()) {
  return applyQuotesMutation(
    source,
    quotesMutationSchema.parse({
      action: "createDraft",
      commercialCaseId: "22222222-2222-4222-8222-222222222222",
      subject: "Devis de test Nadia",
      issueDate: "2026-11-09",
      paymentTerms: "30 jours",
    }),
    actor,
    "33333333-3333-4333-8333-333333333333",
  );
}
function remove(source: NativeQuotesPayload, quoteId: string) {
  return applyQuotesMutation(source, { action: "deleteDraft", quoteId }, actor);
}
function request(quoteId: string, revision?: string) {
  return new Request("http://localhost/api/desktop/quotes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(revision ? quoteRevisionHeaders(revision) : {}),
    },
    body: JSON.stringify({ action: "deleteDraft", quoteId }),
  });
}
beforeEach(() => {
  state.payload = draft().payload;
  state.canWrite = true;
});

describe("suppression des devis en brouillon", () => {
  it("supprime seulement le brouillon demandé sans modifier la source", () => {
    const first = state.payload!.quotes[0];
    const source = draft(state.payload!).payload;
    const result = remove(source, first.id);
    expect(result.payload.quotes).toEqual([source.quotes[1]]);
    expect(source.quotes).toHaveLength(2);
    expect(result.focusQuoteId).toBe("");
  });
  it.each(quoteStatusSchema.options.filter((status) => status !== "DRAFT"))(
    "refuse le statut %s",
    (status) => {
      const source = state.payload!;
      source.quotes[0].status = status;
      expect(() => remove(source, source.quotes[0].id)).toThrow("QUOTE_NOT_EDITABLE");
      expect(source.quotes).toHaveLength(1);
    },
  );
  it("refuse un devis inexistant", () => {
    expect(() => remove(state.payload!, "absent")).toThrow("QUOTE_NOT_FOUND");
  });
  it("persiste la suppression du dernier brouillon à travers la normalisation et l’API", async () => {
    const quote = state.payload!.quotes[0];
    const response = await POST(request(quote.id, quote.updatedAt));
    expect(response.status).toBe(200);
    expect((await response.json()).payload.quotes).toEqual([]);
    expect(state.payload!.quotes).toEqual([]);
  });
  it("refuse la suppression par un utilisateur sans droit d’écriture", async () => {
    state.canWrite = false;
    const quote = state.payload!.quotes[0];
    expect((await POST(request(quote.id, quote.updatedAt))).status).toBe(403);
    expect(state.payload!.quotes).toHaveLength(1);
  });
  it("refuse la suppression d’un devis modifié depuis son affichage", async () => {
    const quote = state.payload!.quotes[0];
    expect((await POST(request(quote.id, "ancienne-revision"))).status).toBe(409);
    expect(state.payload!.quotes).toHaveLength(1);
  });
  it("exige une révision et contrôle le statut sur le serveur", async () => {
    const quote = state.payload!.quotes[0];
    expect((await POST(request(quote.id))).status).toBe(428);
    quote.status = "FROZEN";
    expect((await POST(request(quote.id, quote.updatedAt))).status).toBe(409);
    expect(state.payload!.quotes).toHaveLength(1);
  });
});

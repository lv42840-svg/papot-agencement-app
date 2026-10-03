import { describe, expect, it } from "vitest";
import { calculateCommercialContractSummary } from "../src/lib/quotes/commercial-summary";
import { quoteDocumentStatusLabel } from "../src/lib/quotes/domain";
import {
  quoteCanBeRetained,
  quoteContractSelectionState,
  validateRetainedQuoteSelection,
} from "../src/lib/quotes/retention";
import {
  createInitialNativeQuotesPayload,
  nativeQuoteRecordSchema,
  type NativeQuoteRecord,
} from "../src/lib/quotes/store";

const affairId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";

function quote(input: {
  id: string;
  status: NativeQuoteRecord["status"];
  variantName: string;
  version: number;
  saleCents: number;
  materialCostCents: number;
  laborHours: number;
  laborCostRateCents: number;
  quoteNumber?: string;
}): NativeQuoteRecord {
  return nativeQuoteRecordSchema.parse({
    id: input.id,
    commercialCaseId: affairId,
    variantName: input.variantName,
    version: input.version,
    status: input.status,
    sentAt: input.status === "DRAFT" ? null : "2026-09-18T06:00:00.000Z",
    followUpDate: input.status === "DRAFT" ? null : "2026-09-30",
    finalPdf:
      input.status === "DRAFT"
        ? null
        : {
            quoteNumber: input.quoteNumber ?? "D-2026-0001",
            variantName: input.variantName,
            version: input.version,
            commercialDocumentId: crypto.randomUUID(),
            fileName: "devis.pdf",
            storagePath: `Commercial/devis-${input.id}.pdf`,
            sizeBytes: 100,
            sha256: "a".repeat(64),
            archivedAt: "2026-09-18T06:00:00.000Z",
            archivedByName: "Lucien",
          },
    model: {
      id: input.id,
      clientId,
      subject: input.variantName,
      issueDate: "2026-09-18",
      validityDays: 30,
      paymentTerms: "45 jours fin de mois",
      items: [
        {
          id: crypto.randomUUID(),
          kind: "LINE",
          parentId: null,
          description: "Ouvrage",
          unit: "u",
          quantity: 1,
          quantityFormula: null,
          unitPriceCents: input.saleCents,
          components: [
            {
              id: crypto.randomUUID(),
              description: "Matière",
              unit: "u",
              quantity: 1,
              quantityFormula: null,
              costPriceCents: input.materialCostCents,
              unitPriceCents: input.materialCostCents,
            },
            {
              id: crypto.randomUUID(),
              description: "Heure atelier",
              unit: "h",
              quantity: input.laborHours,
              quantityFormula: null,
              activity: "ATELIER",
              costPriceCents: input.laborCostRateCents,
              unitPriceCents: input.laborCostRateCents,
            },
          ],
        },
      ],
    },
    createdAt: "2026-09-18T05:00:00.000Z",
    createdByName: "Lucien",
    updatedAt: "2026-09-18T06:00:00.000Z",
    updatedByName: "Lucien",
  });
}

describe("commercial retained quotes", () => {
  it("allows multiple frozen quotes, including a previous frozen version", () => {
    const a = quote({
      id: "33333333-3333-4333-8333-333333333333",
      status: "SENT",
      variantName: "Mobilier",
      version: 2,
      saleCents: 2_500_000,
      materialCostCents: 1_400_000,
      laborHours: 280,
      laborCostRateCents: 2_000,
      quoteNumber: "D-2026-0001",
    });
    const b = quote({
      id: "44444444-4444-4444-8444-444444444444",
      status: "SUPERSEDED",
      variantName: "Banque accueil",
      version: 1,
      saleCents: 800_000,
      materialCostCents: 420_000,
      laborHours: 70,
      laborCostRateCents: 2_000,
      quoteNumber: "D-2026-0002",
    });
    const payload = { schemaVersion: 1 as const, quotes: [a, b] };

    expect(quoteCanBeRetained(b)).toBe(true);
    expect(
      validateRetainedQuoteSelection(payload, affairId, [a.id, b.id], false).map((item) => item.id),
    ).toEqual([a.id, b.id]);

    const contract = calculateCommercialContractSummary(payload.quotes, [a.id, b.id]);
    expect(contract.quoteCount).toBe(2);
    expect(contract.totalHtCents).toBe(3_300_000);
    expect(contract.soldHours).toBe(350);
    expect(contract.plannedDisbursementCents).toBe(1_820_000);
  });

  it("derives contract state from retained ids without overwriting the document lifecycle", () => {
    const previous = quote({
      id: "88888888-8888-4888-8888-888888888888",
      status: "SUPERSEDED",
      variantName: "Base",
      version: 1,
      saleCents: 100_000,
      materialCostCents: 50_000,
      laborHours: 5,
      laborCostRateCents: 2_000,
    });
    const notRetained = quote({
      id: "99999999-9999-4999-8999-999999999999",
      status: "SENT",
      variantName: "Variante A",
      version: 1,
      saleCents: 120_000,
      materialCostCents: 60_000,
      laborHours: 6,
      laborCostRateCents: 2_000,
    });
    const confirmed = {
      id: affairId,
      status: "CONFIRMED" as const,
      retainedQuoteIds: [previous.id],
    };

    expect(quoteDocumentStatusLabel(previous.status)).toBe("Version précédente");
    expect(quoteContractSelectionState(previous, confirmed)).toBe("RETAINED");
    expect(quoteContractSelectionState(notRetained, confirmed)).toBe("NOT_RETAINED");
  });

  it("does not invent a contract state before confirmation or for a draft", () => {
    const draft = quote({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "DRAFT",
      variantName: "Base",
      version: 1,
      saleCents: 100_000,
      materialCostCents: 50_000,
      laborHours: 5,
      laborCostRateCents: 2_000,
    });

    expect(
      quoteContractSelectionState(draft, {
        id: affairId,
        status: "CONFIRMED",
        retainedQuoteIds: [],
      }),
    ).toBeNull();
    expect(
      quoteContractSelectionState(
        quote({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          status: "SENT",
          variantName: "Base",
          version: 1,
          saleCents: 100_000,
          materialCostCents: 50_000,
          laborHours: 5,
          laborCostRateCents: 2_000,
        }),
        { id: affairId, status: "WAITING", retainedQuoteIds: [] },
      ),
    ).toBeNull();
  });

  it("labels legacy accepted/rejected statuses as historical document states", () => {
    expect(quoteDocumentStatusLabel("ACCEPTED")).toBe("Envoyé (ancien statut)");
    expect(quoteDocumentStatusLabel("REJECTED")).toBe("Envoyé (ancien statut)");
  });

  it("refuses a draft or foreign quote as retained", () => {
    const draft = quote({
      id: "55555555-5555-4555-8555-555555555555",
      status: "DRAFT",
      variantName: "Brouillon",
      version: 1,
      saleCents: 100_000,
      materialCostCents: 50_000,
      laborHours: 5,
      laborCostRateCents: 2_000,
    });
    const payload = { schemaVersion: 1 as const, quotes: [draft] };

    expect(quoteCanBeRetained(draft)).toBe(false);
    expect(() => validateRetainedQuoteSelection(payload, affairId, [draft.id], false)).toThrow(
      "COMMERCIAL_RETAINED_QUOTE_INVALID",
    );
  });

  it("blocks an ambiguous confirmation when a selectable quote exists but none is selected", () => {
    const sent = quote({
      id: "66666666-6666-4666-8666-666666666666",
      status: "SENT",
      variantName: "Base",
      version: 1,
      saleCents: 100_000,
      materialCostCents: 50_000,
      laborHours: 5,
      laborCostRateCents: 2_000,
    });

    expect(() =>
      validateRetainedQuoteSelection({ schemaVersion: 1, quotes: [sent] }, affairId, [], false),
    ).toThrow("COMMERCIAL_QUOTE_SELECTION_REQUIRED");
  });

  it("allows confirmation without quote only when explicitly declared and no frozen quote exists", () => {
    const empty = createInitialNativeQuotesPayload();

    expect(() => validateRetainedQuoteSelection(empty, affairId, [], false)).toThrow(
      "COMMERCIAL_CONFIRM_WITHOUT_QUOTE_REQUIRED",
    );
    expect(validateRetainedQuoteSelection(empty, affairId, [], true)).toEqual([]);
  });

  it("rejects duplicate retained ids", () => {
    const sent = quote({
      id: "77777777-7777-4777-8777-777777777777",
      status: "SENT",
      variantName: "Base",
      version: 1,
      saleCents: 100_000,
      materialCostCents: 50_000,
      laborHours: 5,
      laborCostRateCents: 2_000,
    });

    expect(() =>
      validateRetainedQuoteSelection(
        { schemaVersion: 1, quotes: [sent] },
        affairId,
        [sent.id, sent.id],
        false,
      ),
    ).toThrow("COMMERCIAL_RETAINED_QUOTE_DUPLICATE");
  });
});

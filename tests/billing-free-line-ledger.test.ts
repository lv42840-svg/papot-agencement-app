import { describe, expect, it } from "vitest";
import {
  approveBillingDraft,
  createBillingDraft,
  updateBillingDocument,
  type BillingDocumentLine,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";
import { lineHtCents } from "../src/lib/billing/document-lines";
import { addBillingExtra, confirmBillingExtra } from "../src/lib/billing/extras";
import { buildChantierMarketSources } from "../src/lib/billing/market-sources";
import {
  applyBillingVisaPartial,
  presentBillingVisa,
  recordBillingVisaDecision,
  setBillingVisaRequirement,
} from "../src/lib/billing/visa";

const chantierId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const caseId = "44444444-4444-4444-8444-444444444444";
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const empty = (): BillingPayload => ({ schemaVersion: 1, drafts: [] });
const source: BillingSource = {
  quoteId,
  sourceMode: "CHANTIER",
  sourceQuoteIds: [quoteId],
  commercialCaseId: caseId,
  chantierId,
  clientId,
  clientName: "Pralus",
  affairName: "Boutique Pralus",
  quoteLabel: "Marché du chantier",
  contractHtCents: 100_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 100_000 }],
  lines: [
    { lineId: a, description: "Mobilier", amountHtCents: 60_000, vatRatePercent: 20 },
    { lineId: b, description: "Pose", amountHtCents: 40_000, vatRatePercent: 20 },
  ],
};
function progress(payload: BillingPayload, percent: number, on = source) {
  return createBillingDraft(payload, on, {
    requestId: crypto.randomUUID(),
    type: "PROGRESS",
    linePercentages: (on.lines ?? []).map((line) => ({ lineId: line.lineId, percent })),
  }, "Nadia");
}
function rows(draft: ReturnType<typeof progress>) {
  return (draft.documentLines ?? []).map((line) => ({ ...line }));
}
function revised(
  payload: BillingPayload,
  draft: ReturnType<typeof progress>,
  changed: BillingDocumentLine[],
) {
  return updateBillingDocument(payload, draft.id, {
    expectedUpdatedAt: draft.updatedAt,
    label: draft.label,
    notes: draft.notes,
    documentLines: changed,
  }, "Lucien");
}
function free(centimes: number, allocationLineId: string | null, rate = 20): BillingDocumentLine {
  return {
    id: crypto.randomUUID(),
    origin: "FREE",
    sourceLineId: null,
    allocationLineId,
    description: "Transport et finitions rattachés à un ouvrage",
    quantity: 1,
    unit: "forfait",
    unitPriceCents: centimes,
    vatRatePercent: rate,
  };
}
function amountBySource(draft: ReturnType<typeof progress>) {
  return new Map(
    draft.documentLines
      ?.filter((line) => line.origin === "QUOTE")
      .map((line) => [line.sourceLineId, lineHtCents(line)]),
  );
}

describe("traçabilité des prestations libres dans les situations cumulées", () => {
  it("déduit une prestation libre affectée sans la facturer deux fois à la situation suivante", () => {
    const original = progress(empty(), 50);
    const modified = rows(original).map((line) =>
      line.sourceLineId === a ? { ...line, unitPriceCents: 20_000 } : line,
    );
    modified.push(free(10_000, a));
    const first = revised({ ...empty(), drafts: [original] }, original, modified);
    expect(first.amountHtCents).toBe(50_000);
    expect(first.lineProgress?.map((entry) => entry.cumulativeHtCents)).toEqual([30_000, 20_000]);
    const next = progress({ ...empty(), drafts: [first] }, 75);
    expect(next.amountHtCents).toBe(25_000);
    expect(amountBySource(next)).toEqual(new Map([[a, 15_000], [b, 10_000]]));
    expect(next.vatCents).toBe(5_000);
  });

  it("refuse une prestation libre non affectée même si le total global est inchangé", () => {
    const original = progress(empty(), 50);
    const modified = rows(original).map((line) =>
      line.sourceLineId === a ? { ...line, unitPriceCents: 20_000 } : line,
    );
    modified.push(free(10_000, null));
    expect(() => revised(
      { ...empty(), drafts: [original] }, original, modified,
    )).toThrow("BILLING_PROGRESS_FREE_UNALLOCATED");
  });

  it("rejette une affectation à un ouvrage inconnu ou dont la TVA ne correspond pas", () => {
    const original = progress(empty(), 50);
    const modified = rows(original).map((line) =>
      line.sourceLineId === a ? { ...line, unitPriceCents: 20_000 } : line,
    );
    expect(() => revised(
      { ...empty(), drafts: [original] }, original,
      [...modified, free(10_000, crypto.randomUUID())],
    )).toThrow("BILLING_DOCUMENT_ALLOCATION_UNKNOWN");
    expect(() => revised(
      { ...empty(), drafts: [original] }, original,
      [...modified, free(10_000, a, 10)],
    )).toThrow("BILLING_DOCUMENT_VAT_OUTSIDE_CONTRACT");
  });

  it("ne laisse pas dépasser le plafond d'un ouvrage à montant global identique", () => {
    const original = progress(empty(), 50);
    const modified = rows(original).map((line) => {
      if (line.sourceLineId === a) return { ...line, unitPriceCents: 60_000 };
      return { ...line, unitPriceCents: 10_000 };
    });
    modified.push(free(10_000, a));
    // The grand total is 80_000 but 70_000 was assigned to a 60_000 ouvrage.
    expect(() => revised(
      { ...empty(), drafts: [original] }, original, modified,
    )).toThrow("BILLING_PROGRESS_LINE_EXCEEDS_CONTRACT");
  });

  it("reprend les acomptes avec prestations affectées à la bonne ligne du marché", () => {
    const deposit = createBillingDraft(empty(), source, {
      requestId: crypto.randomUUID(),
      type: "DEPOSIT",
      amountHtCents: 20_000,
    }, "Nadia");
    const modified = rows(deposit).map((line) =>
      line.sourceLineId === a ? { ...line, unitPriceCents: 2_000 } : line,
    );
    modified.push(free(10_000, a));
    const first = revised({ ...empty(), drafts: [deposit] }, deposit, modified);
    expect(first.amountHtCents).toBe(20_000);
    const next = progress({ ...empty(), drafts: [first] }, 50);
    expect(next.amountHtCents).toBe(30_000);
    expect(amountBySource(next)).toEqual(new Map([[a, 18_000], [b, 12_000]]));
  });

  it("bloque une future situation si un acompte contient une ligne libre sans affectation", () => {
    const deposit = createBillingDraft(empty(), source, {
      requestId: crypto.randomUUID(),
      type: "DEPOSIT",
      amountHtCents: 20_000,
    }, "Nadia");
    const modified = rows(deposit).map((line) =>
      line.sourceLineId === a ? { ...line, unitPriceCents: 2_000 } : line,
    );
    modified.push(free(10_000, null));
    const first = revised({ ...empty(), drafts: [deposit] }, deposit, modified);
    expect(() => progress({ ...empty(), drafts: [first] }, 50)).toThrow(
      "BILLING_PROGRESS_FREE_UNALLOCATED",
    );
  });

  it("traite un supplément confirmé comme une ligne du marché et pas comme une ligne libre", () => {
    const chantier = {
      id: chantierId,
      sourceCommercialCaseId: caseId,
      name: "Boutique Pralus",
      clientName: "Pralus",
    };
    const quote = { ...source, sourceMode: "QUOTE" as const, sourceQuoteIds: undefined };
    const pending = addBillingExtra(empty(), {
      requestId: crypto.randomUUID(),
      chantierId,
      description: "Cornières de finition",
      amountHtCents: 20_000,
      vatRatePercent: 20,
    }, "Nadia");
    const unconfirmed = buildChantierMarketSources([chantier], [quote], [], pending.extras)[0];
    expect(unconfirmed.contractHtCents).toBe(100_000);
    const approved = confirmBillingExtra(pending, {
      extraId: pending.extras![0].id,
      evidence: "Accord signé du client",
    }, "Lucien");
    const market = buildChantierMarketSources([chantier], [quote], [], approved.extras)[0];
    expect(market.contractHtCents).toBe(120_000);
    const first = progress(empty(), 50, market);
    const second = progress({ ...empty(), drafts: [first] }, 75, market);
    const extraId = approved.extras![0].lineId;
    expect(first.documentLines?.some((row) => row.sourceLineId === extraId)).toBe(true);
    expect(amountBySource(second).get(extraId)).toBe(5_000);
    expect(second.amountHtCents).toBe(30_000);
  });

  it("permet d'appliquer un visa partiel à une situation avec prestation libre affectée", () => {
    const original = progress(empty(), 50);
    const modified = rows(original).map((line) =>
      line.sourceLineId === a ? { ...line, unitPriceCents: 20_000 } : line,
    );
    modified.push(free(10_000, a));
    const draft = revised({ ...empty(), drafts: [original] }, original, modified);
    const payload = presentBillingVisa(
      setBillingVisaRequirement({ ...empty(), drafts: [draft] }, chantierId, true, "Lucien"),
      {
        draftId: draft.id,
        expectedUpdatedAt: draft.updatedAt,
        submittedTo: "Architecte",
        submittedNotes: "Situation et prestation libre",
      },
      "Nadia",
    );
    const visa = payload.visaVersions![0];
    const lineDecisions = visa.documentLines.filter((line) => line.origin !== "TITLE").map((line) => ({
      documentLineId: line.id,
      acceptedHtCents: line.origin === "FREE" ? 5_000 : lineHtCents(line),
      reason: line.origin === "FREE" ? "Finition limitée au montant accepté" : "",
    }));
    const reviewed = recordBillingVisaDecision(payload, {
      draftId: draft.id,
      version: 1,
      decision: "PARTIAL",
      acceptedHtCents: 45_000,
      lineDecisions,
      reviewMethod: "EMAIL",
      externalContact: "Architecte",
      evidence: "Réponse du client",
      reason: "Réduction d'une prestation",
    }, "Lucien");
    const applied = applyBillingVisaPartial(reviewed, {
      draftId: draft.id,
      version: 1,
      expectedUpdatedAt: draft.updatedAt,
    }, "Nadia");
    expect(applied.drafts[0].amountHtCents).toBe(45_000);
    expect(applied.drafts[0].lineProgress?.map((line) => line.cumulativeHtCents))
      .toEqual([25_000, 20_000]);
    expect(applied.visaVersions?.[0].documentLines).toEqual(visa.documentLines);
    const v2 = presentBillingVisa(applied, {
      draftId: draft.id,
      expectedUpdatedAt: applied.drafts[0].updatedAt,
      submittedTo: "Architecte",
      submittedNotes: "Révision avec finitions acceptées",
    }, "Nadia");
    const finalVisa = recordBillingVisaDecision(v2, {
      draftId: draft.id,
      version: 2,
      decision: "ACCEPTED",
      reviewMethod: "EMAIL",
      externalContact: "Architecte",
      evidence: "Accord nouvelle version",
      reason: "Accepté",
    }, "Lucien");
    const firstApproved = approveBillingDraft(
      finalVisa, draft.id, finalVisa.drafts[0].updatedAt, "Lucien",
    );
    const next = progress({ ...empty(), drafts: [firstApproved] }, 100);
    expect(amountBySource(next)).toEqual(new Map([[a, 35_000], [b, 20_000]]));
    expect(next.amountHtCents).toBe(55_000);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  approveBillingDraft,
  createBillingDraft,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";
import {
  applyBillingVisaPartial,
  presentBillingVisa,
  recordBillingVisaDecision,
  setBillingVisaRequirement,
} from "../src/lib/billing/visa";
import { lineHtCents } from "../src/lib/billing/document-lines";

const site = "11111111-1111-4111-8111-111111111111";
const lineA = "22222222-2222-4222-8222-222222222222";
const lineB = "33333333-3333-4333-8333-333333333333";
const source: BillingSource = {
  quoteId: "44444444-4444-4444-8444-444444444444",
  commercialCaseId: "55555555-5555-4555-8555-555555555555",
  chantierId: site,
  clientId: "66666666-6666-4666-8666-666666666666",
  clientName: "Pralus",
  affairName: "Boutique Bourg",
  quoteLabel: "D-2026-001",
  contractHtCents: 100_000,
  contractTaxGroups: [
    { ratePercent: 10, baseHtCents: 40_000 },
    { ratePercent: 20, baseHtCents: 60_000 },
  ],
  lines: [
    { lineId: lineA, description: "Comptoir", amountHtCents: 60_000, vatRatePercent: 20 },
    { lineId: lineB, description: "Habillages", amountHtCents: 40_000, vatRatePercent: 10 },
  ],
};
const empty = (): BillingPayload => ({ schemaVersion: 1, drafts: [] });
const percentages = [
  { lineId: lineA, percent: 50 },
  { lineId: lineB, percent: 50 },
];
function prepareProgress() {
  const draft = createBillingDraft(
    empty(),
    source,
    { requestId: crypto.randomUUID(), type: "PROGRESS", linePercentages: percentages },
    "Nadia",
  );
  const pending = presentBillingVisa(
    setBillingVisaRequirement({ ...empty(), drafts: [draft] }, site, true, "Lucien"),
    {
      draftId: draft.id,
      expectedUpdatedAt: draft.updatedAt,
      submittedTo: "Architecte",
      submittedNotes: "Situation V1",
    },
    "Nadia",
  );
  return { draft, pending };
}
function reviewPartial() {
  const { draft, pending } = prepareProgress();
  const lines = pending.visaVersions![0].documentLines.filter(
    (item) => item.origin !== "TITLE",
  );
  const accepted = lines.map((item) => ({
    documentLineId: item.id,
    acceptedHtCents: item.sourceLineId === lineA ? 20_000 : 0,
    reason: item.sourceLineId === lineA ? "Visa limité à 200 € HT" : "Ouvrage refusé",
  }));
  const after = recordBillingVisaDecision(
    pending,
    {
      draftId: draft.id,
      version: 1,
      decision: "PARTIAL",
      acceptedHtCents: 20_000,
      lineDecisions: accepted,
      reviewMethod: "EMAIL",
      externalContact: "Architecte",
      evidence: "Courriel d'accord avec postes validés",
      reason: "Visa partiel sur ouvrage 1 seulement",
    },
    "Lucien",
  );
  return { draft, after };
}

describe("visa partiel par prestation et situation cumulative", () => {
  it("sauvegarde les postes acceptés et les refus dans la V1 intacte", () => {
    const { after } = reviewPartial();
    const version = after.visaVersions![0];
    expect(version.documentLines.filter((line) => line.origin !== "TITLE")).toHaveLength(2);
    expect(version.amountHtCents).toBe(50_000);
    expect(version.acceptedHtCents).toBe(20_000);
    expect(version.lineDecisions?.map((item) => item.acceptedHtCents)).toEqual([20_000, 0]);
    expect(version.lineDecisions?.[1].reason).toBe("Ouvrage refusé");
  });

  it("écarte l'ouvrage refusé, calcule la TVA du montant accepté et maintient les cumuls", () => {
    const { draft, after } = reviewPartial();
    const applied = applyBillingVisaPartial(
      after,
      { draftId: draft.id, version: 1, expectedUpdatedAt: draft.updatedAt },
      "Nadia",
      new Date(Date.now() + 5000),
    );
    const revised = applied.drafts[0];
    const financialRows = revised.documentLines!.filter((row) => row.origin !== "TITLE");
    expect(financialRows).toHaveLength(1);
    expect(financialRows[0].sourceLineId).toBe(lineA);
    expect(financialRows.reduce((total, row) => total + lineHtCents(row), 0)).toBe(20_000);
    expect(revised.amountHtCents).toBe(20_000);
    expect(revised.vatCents).toBe(4_000);
    expect(revised.lineProgress?.find((row) => row.lineId === lineA)?.cumulativeHtCents).toBe(20_000);
    expect(revised.lineProgress?.find((row) => row.lineId === lineB)?.cumulativeHtCents).toBe(0);
    expect(applied.visaVersions?.[0].documentLines).toEqual(after.visaVersions?.[0].documentLines);
    expect(() => approveBillingDraft(applied, draft.id, revised.updatedAt, "Lucien")).toThrow(
      "BILLING_VISA_PARTIAL_REWORK_REQUIRED",
    );

    const v2 = presentBillingVisa(
      applied,
      {
        draftId: draft.id,
        expectedUpdatedAt: revised.updatedAt,
        submittedTo: "Architecte",
        submittedNotes: "Situation corrigée",
      },
      "Nadia",
    );
    const accepted = recordBillingVisaDecision(
      v2,
      {
        draftId: draft.id,
        version: 2,
        decision: "ACCEPTED",
        reviewMethod: "EMAIL",
        externalContact: "Architecte",
        evidence: "Accord sur la V2",
        reason: "Conforme aux postes acceptés",
      },
      "Lucien",
    );
    const approved = approveBillingDraft(
      accepted, draft.id, revised.updatedAt, "Lucien",
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.amountHtCents).toBe(20_000);

    const next = createBillingDraft(
      { ...accepted, drafts: [approved] },
      source,
      {
        requestId: crypto.randomUUID(),
        type: "PROGRESS",
        linePercentages: percentages,
      },
      "Nadia",
    );
    expect(next.amountHtCents).toBe(30_000);
    expect(next.documentLines?.filter((row) => row.origin === "QUOTE")
      .map((row) => [row.sourceLineId, lineHtCents(row)])).toEqual([
        [lineA, 10_000],
        [lineB, 20_000],
      ]);
    expect(next.vatCents).toBe(4_000);
  });

  it("refuse d'appliquer un visa partiel deux fois ou avec une version inconnue", () => {
    const { draft, after } = reviewPartial();
    expect(() => applyBillingVisaPartial(
      after, { draftId: draft.id, version: 5, expectedUpdatedAt: draft.updatedAt }, "Nadia",
    )).toThrow("BILLING_VISA_VERSION_CONFLICT");
    const applied = applyBillingVisaPartial(
      after, { draftId: draft.id, version: 1, expectedUpdatedAt: draft.updatedAt }, "Nadia",
    );
    expect(() => applyBillingVisaPartial(
      applied, { draftId: draft.id, version: 1, expectedUpdatedAt: applied.drafts[0].updatedAt }, "Nadia",
    )).toThrow("BILLING_VISA_ALREADY_APPLIED");
  });

  it("vérifie la présence des contrôles métier et de l'interface", () => {
    const api = readFileSync("src/app/api/desktop/billing/route.ts", "utf8");
    const ui = readFileSync("src/components/billing-visa-panel.tsx", "utf8");
    expect(api).toContain('z.literal("APPLY_VISA_PARTIAL")');
    expect(api).toContain("lineDecisions:");
    expect(ui).toContain("Reprendre les lignes acceptées dans le brouillon");
    expect(ui).toContain("Partiellement acceptée");
    expect(ui).toContain("Refusée");
    expect(ui).toContain("Détail du visa par prestation");
  });
});

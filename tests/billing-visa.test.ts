import { describe, expect, it } from "vitest";
import {
  approveBillingDraft,
  createBillingDraft,
  updateBillingDraft,
  updateBillingDocument,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";
import {
  assertBillingVisaEditable,
  latestBillingVisa,
  presentBillingVisa,
  recordBillingVisaDecision,
  setBillingVisaRequirement,
  withdrawBillingVisa,
} from "../src/lib/billing/visa";

const site = "11111111-1111-4111-8111-111111111111";
const source: BillingSource = {
  quoteId: "22222222-2222-4222-8222-222222222222",
  commercialCaseId: "33333333-3333-4333-8333-333333333333",
  chantierId: site,
  clientId: "44444444-4444-4444-8444-444444444444",
  clientName: "Pralus",
  affairName: "Boutique",
  quoteLabel: "D-2026-12",
  contractHtCents: 100_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 100_000 }],
  lines: [{
    lineId: "55555555-5555-4555-8555-555555555555",
    description: "Comptoir",
    amountHtCents: 100_000,
    vatRatePercent: 20,
  }],
};
const empty = (): BillingPayload => ({ schemaVersion: 1, drafts: [] });
const make = () => {
  const draft = createBillingDraft(
    empty(), source, { requestId: crypto.randomUUID(), type: "STANDARD" }, "Nadia",
  );
  return { ...empty(), drafts: [draft] };
};
const present = (p: BillingPayload) =>
  presentBillingVisa(
    p,
    {
      draftId: p.drafts[0].id,
      expectedUpdatedAt: p.drafts[0].updatedAt,
      submittedTo: "Maître d'œuvre",
      submittedNotes: "Situation pour visa",
    },
    "Nadia",
  );

describe("visa externe des situations et factures provisoires", () => {
  it("numérote, fige les lignes et bloque l'approbation interne pendant l'attente", () => {
    const payload = present(setBillingVisaRequirement(make(), site, true, "Lucien"));
    const visa = latestBillingVisa(payload, payload.drafts[0].id)!;
    expect(visa.version).toBe(1);
    expect(visa.documentLines).toHaveLength(1);
    expect(visa.amountHtCents).toBe(100_000);
    expect(visa.status).toBe("SUBMITTED");
    expect(() => assertBillingVisaEditable(payload, payload.drafts[0].id)).toThrow(
      "BILLING_VISA_PENDING",
    );
    expect(() =>
      approveBillingDraft(payload, payload.drafts[0].id, payload.drafts[0].updatedAt, "Lucien"),
    ).toThrow("BILLING_VISA_PENDING");
  });

  it("accepte un visa complet documenté, débloque la validation interne et garde l'historique", () => {
    const before = present(setBillingVisaRequirement(make(), site, true, "Lucien"));
    const draft = before.drafts[0];
    const after = recordBillingVisaDecision(
      before,
      {
        draftId: draft.id,
        version: 1,
        decision: "ACCEPTED",
        reviewMethod: "EMAIL",
        externalContact: "Architecte",
        evidence: "Accord par mail du 19 novembre",
        reason: "Accord sur la totalité",
      },
      "Nadia",
    );
    expect(after.visaVersions?.[0].acceptedHtCents).toBe(100_000);
    expect(after.visaVersions?.[0].documentLines).toEqual(draft.documentLines);
    expect(approveBillingDraft(after, draft.id, draft.updatedAt, "Lucien").status).toBe(
      "APPROVED",
    );
    expect(after.drafts[0].status).toBe("DRAFT");
  });

  it("enregistre accord partiel sans le considérer comme une acceptation complète", () => {
    const before = present(setBillingVisaRequirement(make(), site, true, "Nadia"));
    const draft = before.drafts[0];
    const after = recordBillingVisaDecision(
      before,
      {
        draftId: draft.id,
        version: 1,
        decision: "PARTIAL",
        acceptedHtCents: 60_000,
        reviewMethod: "MEETING",
        externalContact: "MOE",
        evidence: "CR de chantier n°5",
        reason: "Lignes meubles muraux non acceptées",
      },
      "Lucien",
    );
    expect(after.visaVersions?.[0]).toMatchObject({
      status: "PARTIAL",
      amountHtCents: 100_000,
      acceptedHtCents: 60_000,
    });
    expect(() =>
      approveBillingDraft(after, draft.id, draft.updatedAt, "Lucien"),
    ).toThrow("BILLING_VISA_PARTIAL_REWORK_REQUIRED");
  });

  it("conserve une version refusée puis permet une nouvelle présentation numérotée", () => {
    const initial = present(make());
    const draft = initial.drafts[0];
    const refused = recordBillingVisaDecision(
      initial,
      {
        draftId: draft.id,
        version: 1,
        decision: "REFUSED",
        reviewMethod: "PHONE",
        externalContact: "Client",
        evidence: "Appel du 19 novembre",
        reason: "Erreur de référence",
      },
      "Nadia",
    );
    const resent = present(refused);
    expect(resent.visaVersions?.map((version) => version.version)).toEqual([1, 2]);
    expect(resent.visaVersions?.[0].status).toBe("REFUSED");
    expect(resent.visaVersions?.[1].status).toBe("SUBMITTED");
  });

  it("permet un retrait motivé sans supprimer la version historique", () => {
    const original = present(make());
    const draft = original.drafts[0];
    const withdrawn = withdrawBillingVisa(
      original,
      { draftId: draft.id, version: 1, reason: "Erreur avant transmission" },
      "Lucien",
    );
    expect(withdrawn.visaVersions?.[0].status).toBe("WITHDRAWN");
    expect(withdrawn.visaVersions?.[0].reason).toBe("Erreur avant transmission");
    expect(() => withdrawBillingVisa(withdrawn, { draftId: draft.id, version: 1, reason: "x" }, "Lucien")).toThrow("BILLING_VISA_ALREADY_REVIEWED");
  });

  it("refuse une preuve absente ou des montants partiels incohérents", () => {
    const p = present(make());
    const d = p.drafts[0];
    const input = {
      draftId: d.id, version: 1, decision: "PARTIAL" as const,
      reviewMethod: "EMAIL" as const, externalContact: "Client",
      evidence: "Mail client", reason: "Acceptation partielle",
    };
    for (const amount of [0, 100_000, 150_000]) {
      expect(() => recordBillingVisaDecision(
        p, { ...input, acceptedHtCents: amount }, "Nadia",
      )).toThrow();
    }
    expect(() => recordBillingVisaDecision(
      p, { ...input, acceptedHtCents: 50_000, evidence: "" }, "Nadia",
    )).toThrow();
    expect(() => presentBillingVisa(
      p,
      { draftId: d.id, expectedUpdatedAt: d.updatedAt, submittedTo: "Client", submittedNotes: "" },
      "Nadia",
    )).toThrow("BILLING_VISA_PENDING");
  });
  it("bloque une modification pendant le visa et impose un nouveau visa après correction", () => {
    const before = present(setBillingVisaRequirement(make(), site, true, "Nadia"));
    const draft = before.drafts[0];
    expect(() => updateBillingDraft(
      before,
      draft.id,
      { expectedUpdatedAt: draft.updatedAt, label: "Nouveau libellé", notes: "" },
      "Lucien",
    )).toThrow("BILLING_VISA_PENDING");
    expect(() => updateBillingDocument(
      before,
      draft.id,
      {
        expectedUpdatedAt: draft.updatedAt,
        label: draft.label,
        notes: draft.notes,
        documentLines: draft.documentLines ?? [],
      },
      "Lucien",
    )).toThrow("BILLING_VISA_PENDING");

    const accepted = recordBillingVisaDecision(before, {
      draftId: draft.id,
      version: 1,
      decision: "ACCEPTED",
      reviewMethod: "EMAIL",
      externalContact: "Architecte",
      evidence: "Accord confirmé",
      reason: "Visa intégral",
    }, "Nadia");
    const modified = updateBillingDraft(
      accepted,
      draft.id,
      { expectedUpdatedAt: draft.updatedAt, label: "Modifié après accord", notes: "" },
      "Lucien",
      new Date(Date.now() + 5000),
    );
    const payload = { ...accepted, drafts: [modified] };
    expect(() => approveBillingDraft(
      payload, modified.id, modified.updatedAt, "Lucien",
    )).toThrow("BILLING_VISA_STALE");
    const updated = present(payload);
    expect(updated.visaVersions?.map((v) => v.version)).toEqual([1, 2]);
    expect(updated.visaVersions?.[0].documentLabel).toBe(draft.label);
    expect(updated.visaVersions?.[1].documentLabel).toBe("Modifié après accord");
  });

  it("refuse la réutilisation d'une version déjà décidée", () => {
    const p = present(make());
    const draft = p.drafts[0];
    const reviewed = recordBillingVisaDecision(p, {
      draftId: draft.id, version: 1, decision: "ACCEPTED",
      reviewMethod: "SIGNATURE", externalContact: "Client",
      evidence: "Signature du 19/11", reason: "Conforme",
    }, "Nadia");
    expect(() => recordBillingVisaDecision(reviewed, {
      draftId: draft.id, version: 1, decision: "REFUSED",
      reviewMethod: "PHONE", externalContact: "Client",
      evidence: "Appel", reason: "Contredit",
    }, "Nadia")).toThrow("BILLING_VISA_ALREADY_REVIEWED");
    expect(() => withdrawBillingVisa(reviewed, {
      draftId: draft.id, version: 1, reason: "Tentative",
    }, "Lucien")).toThrow("BILLING_VISA_ALREADY_REVIEWED");
  });

});

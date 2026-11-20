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
  applyBillingVisaPartial,
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
  lines: [
    {
      lineId: "55555555-5555-4555-8555-555555555555",
      description: "Comptoir",
      amountHtCents: 100_000,
      vatRatePercent: 20,
    },
  ],
};
const empty = (): BillingPayload => ({ schemaVersion: 1, drafts: [] });
const make = () => {
  const draft = createBillingDraft(
    empty(),
    source,
    { requestId: crypto.randomUUID(), type: "STANDARD" },
    "Nadia",
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
  it("numérote, fige les lignes et bloque la validation interne pendant l'attente", () => {
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
    expect(approveBillingDraft(after, draft.id, draft.updatedAt, "Lucien").status).toBe("APPROVED");
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
        lineDecisions: [{
          documentLineId: before.visaVersions![0].documentLines[0].id,
          acceptedHtCents: 60_000,
          reason: "Avancement accepté partiellement",
        }],
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
    expect(() => approveBillingDraft(after, draft.id, draft.updatedAt, "Lucien")).toThrow(
      "BILLING_VISA_PARTIAL_REWORK_REQUIRED",
    );
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
    expect(() =>
      withdrawBillingVisa(withdrawn, { draftId: draft.id, version: 1, reason: "x" }, "Lucien"),
    ).toThrow("BILLING_VISA_ALREADY_REVIEWED");
  });

  it("refuse une preuve absente ou des montants partiels incohérents", () => {
    const p = present(make());
    const d = p.drafts[0];
    const input = {
      draftId: d.id,
      version: 1,
      decision: "PARTIAL" as const,
      reviewMethod: "EMAIL" as const,
      externalContact: "Client",
      evidence: "Mail client",
      reason: "Acceptation partielle",
    };
    const documentLineId = p.visaVersions![0].documentLines[0].id;
    for (const amount of [0, 100_000, 150_000]) {
      expect(() =>
        recordBillingVisaDecision(p, {
          ...input,
          acceptedHtCents: amount,
          lineDecisions: [{
            documentLineId,
            acceptedHtCents: amount,
            reason: "Refus partiel motivé",
          }],
        }, "Nadia"),
      ).toThrow();
    }
    expect(() =>
      recordBillingVisaDecision(p, {
        ...input,
        acceptedHtCents: 50_000,
        lineDecisions: [{
          documentLineId,
          acceptedHtCents: 50_000,
          reason: "Refus partiel motivé",
        }],
        evidence: "",
      }, "Nadia"),
    ).toThrow();
    expect(() =>
      presentBillingVisa(
        p,
        {
          draftId: d.id,
          expectedUpdatedAt: d.updatedAt,
          submittedTo: "Client",
          submittedNotes: "",
        },
        "Nadia",
      ),
    ).toThrow("BILLING_VISA_PENDING");
  });
  it("bloque une modification pendant le visa et impose un nouveau visa après correction", () => {
    const before = present(setBillingVisaRequirement(make(), site, true, "Nadia"));
    const draft = before.drafts[0];
    expect(() =>
      updateBillingDraft(
        before,
        draft.id,
        { expectedUpdatedAt: draft.updatedAt, label: "Nouveau libellé", notes: "" },
        "Lucien",
      ),
    ).toThrow("BILLING_VISA_PENDING");
    expect(() =>
      updateBillingDocument(
        before,
        draft.id,
        {
          expectedUpdatedAt: draft.updatedAt,
          label: draft.label,
          notes: draft.notes,
          documentLines: draft.documentLines ?? [],
        },
        "Lucien",
      ),
    ).toThrow("BILLING_VISA_PENDING");

    const accepted = recordBillingVisaDecision(
      before,
      {
        draftId: draft.id,
        version: 1,
        decision: "ACCEPTED",
        reviewMethod: "EMAIL",
        externalContact: "Architecte",
        evidence: "Accord confirmé",
        reason: "Visa intégral",
      },
      "Nadia",
    );
    const modified = updateBillingDraft(
      accepted,
      draft.id,
      { expectedUpdatedAt: draft.updatedAt, label: "Modifié après accord", notes: "" },
      "Lucien",
      new Date(Date.now() + 5000),
    );
    const payload = { ...accepted, drafts: [modified] };
    expect(() => approveBillingDraft(payload, modified.id, modified.updatedAt, "Lucien")).toThrow(
      "BILLING_VISA_STALE",
    );
    const updated = present(payload);
    expect(updated.visaVersions?.map((v) => v.version)).toEqual([1, 2]);
    expect(updated.visaVersions?.[0].documentLabel).toBe(draft.label);
    expect(updated.visaVersions?.[1].documentLabel).toBe("Modifié après accord");
  });

  it("refuse la réutilisation d'une version déjà décidée", () => {
    const p = present(make());
    const draft = p.drafts[0];
    const reviewed = recordBillingVisaDecision(
      p,
      {
        draftId: draft.id,
        version: 1,
        decision: "ACCEPTED",
        reviewMethod: "SIGNATURE",
        externalContact: "Client",
        evidence: "Signature du 19/11",
        reason: "Conforme",
      },
      "Nadia",
    );
    expect(() =>
      recordBillingVisaDecision(
        reviewed,
        {
          draftId: draft.id,
          version: 1,
          decision: "REFUSED",
          reviewMethod: "PHONE",
          externalContact: "Client",
          evidence: "Appel",
          reason: "Contredit",
        },
        "Nadia",
      ),
    ).toThrow("BILLING_VISA_ALREADY_REVIEWED");
    expect(() =>
      withdrawBillingVisa(
        reviewed,
        {
          draftId: draft.id,
          version: 1,
          reason: "Tentative",
        },
        "Lucien",
      ),
    ).toThrow("BILLING_VISA_ALREADY_REVIEWED");
  });
  it("reprend 60 % acceptés dans un nouveau brouillon, puis impose un visa V2", () => {
    const pending = present(setBillingVisaRequirement(make(), site, true, "Nadia"));
    const draft = pending.drafts[0];
    const documentLineId = pending.visaVersions![0].documentLines[0].id;
    const reviewed = recordBillingVisaDecision(pending, {
      draftId: draft.id,
      version: 1,
      decision: "PARTIAL",
      acceptedHtCents: 60_000,
      lineDecisions: [{
        documentLineId,
        acceptedHtCents: 60_000,
        reason: "40 % non acceptés",
      }],
      reviewMethod: "EMAIL",
      externalContact: "Architecte",
      evidence: "Visa de situation V1",
      reason: "Réduction du montant",
    }, "Lucien");
    const changed = applyBillingVisaPartial(
      reviewed, { draftId: draft.id, version: 1, expectedUpdatedAt: draft.updatedAt }, "Nadia",
    );
    expect(changed.drafts[0].amountHtCents).toBe(60_000);
    expect(changed.drafts[0].documentLines?.filter(line => line.origin !== "TITLE")).toHaveLength(1);
    expect(changed.visaVersions?.[0].documentLines).toEqual(pending.visaVersions?.[0].documentLines);
    expect(changed.visaVersions?.[0].appliedByName).toBe("Nadia");
    expect(() => approveBillingDraft(
      changed, draft.id, changed.drafts[0].updatedAt, "Lucien",
    )).toThrow("BILLING_VISA_PARTIAL_REWORK_REQUIRED");
    expect(() => applyBillingVisaPartial(
      changed, { draftId: draft.id, version: 1, expectedUpdatedAt: changed.drafts[0].updatedAt }, "Nadia",
    )).toThrow("BILLING_VISA_ALREADY_APPLIED");

    const v2 = present(changed);
    expect(v2.visaVersions?.map(v => v.version)).toEqual([1, 2]);
    expect(v2.visaVersions?.[1].amountHtCents).toBe(60_000);
    const approvedVisa = recordBillingVisaDecision(v2, {
      draftId: draft.id,
      version: 2,
      decision: "ACCEPTED",
      reviewMethod: "EMAIL",
      externalContact: "Architecte",
      evidence: "Visa de situation V2",
      reason: "Conforme",
    }, "Nadia");
    expect(approveBillingDraft(
      approvedVisa, draft.id, approvedVisa.drafts[0].updatedAt, "Lucien",
    ).amountHtCents).toBe(60_000);
  });

  it("refuse les décisions ligne inexistante, en doublon et sans motif de réduction", () => {
    const pending = present(make());
    const lineId = pending.visaVersions![0].documentLines[0].id;
    const input = {
      draftId: pending.drafts[0].id,
      version: 1,
      decision: "PARTIAL" as const,
      acceptedHtCents: 50_000,
      reviewMethod: "EMAIL" as const,
      externalContact: "Architecte",
      evidence: "Compte rendu",
      reason: "Visa partiel",
    };
    const row = {
      documentLineId: lineId,
      acceptedHtCents: 50_000,
      reason: "Réduction motivée",
    };
    expect(() => recordBillingVisaDecision(
      pending, { ...input, lineDecisions: [{ ...row, reason: "" }] }, "Lucien",
    )).toThrow("BILLING_VISA_LINE_REASON_REQUIRED");
    expect(() => recordBillingVisaDecision(
      pending, { ...input, lineDecisions: [{ ...row, documentLineId: crypto.randomUUID() }] }, "Lucien",
    )).toThrow("BILLING_VISA_LINE_DECISION_INVALID");
    expect(() => recordBillingVisaDecision(
      pending, { ...input, lineDecisions: [row, row] }, "Lucien",
    )).toThrow("BILLING_VISA_LINE_DECISIONS_REQUIRED");
    expect(() => recordBillingVisaDecision(
      pending, { ...input, lineDecisions: [{ ...row, acceptedHtCents: 60_000 }] }, "Lucien",
    )).toThrow("BILLING_VISA_LINE_TOTAL_MISMATCH");
  });


});

import { describe, expect, it } from "vitest";
import {
  calculateBillingDraftRetention,
  draftRetentionPreview,
  rebaseBillingDraftRetention,
  setBillingDraftRetention,
} from "../src/lib/billing/draft-retention";
import {
  approveBillingDraft,
  createBillingDraft,
  updateBillingDraft,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";
import {
  presentBillingVisa,
  recordBillingVisaDecision,
  setBillingVisaRequirement,
} from "../src/lib/billing/visa";

const source: BillingSource = {
  quoteId: "11111111-1111-4111-8111-111111111111",
  commercialCaseId: "22222222-2222-4222-8222-222222222222",
  chantierId: "33333333-3333-4333-8333-333333333333",
  clientId: "44444444-4444-4444-8444-444444444444",
  clientName: "Client test",
  affairName: "Chantier test",
  quoteLabel: "D-2026",
  contractHtCents: 100_000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 100_000 }],
};

function make(): BillingPayload {
  const empty: BillingPayload = { schemaVersion: 1, drafts: [] };
  return {
    ...empty,
    drafts: [
      createBillingDraft(
        empty,
        source,
        { requestId: crypto.randomUUID(), type: "DEPOSIT", amountHtCents: 30_000 },
        "Nadia",
        new Date("2026-11-20T10:00:00Z"),
      ),
    ],
  };
}

describe("retenue de garantie sur projet non émis", () => {
  it("calcule les retenues en pourcentage ou en centimes et exclut tout paiement réel", () => {
    const fivePercent = calculateBillingDraftRetention("PERCENT", 5, 36_000);
    expect(fivePercent).toEqual({
      mode: "PERCENT",
      ratePercent: 5,
      amountTtcCents: 1_800,
    });
    const fixed = calculateBillingDraftRetention("AMOUNT", 1_250, 36_000);
    expect(fixed.mode).toBe("AMOUNT");
    expect(fixed.amountTtcCents).toBe(1_250);
    expect(fixed.ratePercent).toBe(3.47);
    expect(() => calculateBillingDraftRetention("PERCENT", 101, 36_000)).toThrow(
      "BILLING_RETENTION_PERCENT_INVALID",
    );
    expect(() => calculateBillingDraftRetention("AMOUNT", 36_001, 36_000)).toThrow(
      "BILLING_RETENTION_EXCEEDS_TTC",
    );
    expect(() => rebaseBillingDraftRetention(fixed, 1_000)).toThrow(
      "BILLING_RETENTION_EXCEEDS_TTC",
    );
  });

  it("conserve la retenue sur le projet et recalcule le pourcentage lorsque le TTC change", () => {
    const original = make();
    const draft = original.drafts[0];
    const withRetention = setBillingDraftRetention(
      original,
      {
        draftId: draft.id,
        expectedUpdatedAt: draft.updatedAt,
        mode: "PERCENT",
        value: 5,
      },
      "Nadia",
      new Date("2026-11-20T11:00:00Z"),
    );
    expect(draftRetentionPreview(withRetention.drafts[0])).toEqual({
      totalTtcCents: 36_000,
      retainedTtcCents: 1_800,
      immediatelyClaimableTtcCents: 34_200,
      ratePercent: 5,
    });
    const modified = updateBillingDraft(
      withRetention,
      draft.id,
      {
        expectedUpdatedAt: withRetention.drafts[0].updatedAt,
        label: draft.label,
        notes: "",
        amountHtCents: 20_000,
      },
      "Lucien",
      new Date("2026-11-20T12:00:00Z"),
    );
    expect(modified.totalTtcCents).toBe(24_000);
    expect(modified.retention?.amountTtcCents).toBe(1_200);
    expect(original.drafts[0].retention).toBeUndefined();
  });

  it("verrouille les conditions après validation interne et refuse les conflits de version", () => {
    const original = make();
    const draft = original.drafts[0];
    const changed = setBillingDraftRetention(
      original,
      {
        draftId: draft.id,
        expectedUpdatedAt: draft.updatedAt,
        mode: "AMOUNT",
        value: 1_000,
      },
      "Lucien",
      new Date("2026-11-20T11:00:00Z"),
    );
    expect(() =>
      setBillingDraftRetention(
        changed,
        {
          draftId: draft.id,
          expectedUpdatedAt: draft.updatedAt,
          mode: "PERCENT",
          value: 5,
        },
        "Lucien",
      ),
    ).toThrow("BILLING_VERSION_CONFLICT");
    const approved = approveBillingDraft(changed, draft.id, changed.drafts[0].updatedAt, "Lucien");
    expect(() =>
      setBillingDraftRetention(
        { ...changed, drafts: [approved] },
        {
          draftId: draft.id,
          expectedUpdatedAt: approved.updatedAt,
          mode: "PERCENT",
          value: 5,
        },
        "Lucien",
      ),
    ).toThrow("BILLING_DRAFT_LOCKED");
  });

  it("fige les conditions dans le visa et requiert une nouvelle version après changement", () => {
    const original = make();
    const draft = original.drafts[0];
    const initial = setBillingDraftRetention(
      setBillingVisaRequirement(original, source.chantierId!, true, "Lucien"),
      {
        draftId: draft.id,
        expectedUpdatedAt: draft.updatedAt,
        mode: "PERCENT",
        value: 5,
      },
      "Nadia",
      new Date("2026-11-20T11:00:00Z"),
    );
    const submit = (payload: BillingPayload) =>
      presentBillingVisa(
        payload,
        {
          draftId: draft.id,
          expectedUpdatedAt: payload.drafts[0].updatedAt,
          submittedTo: "Maîtrise d'œuvre",
          submittedNotes: "Pour accord",
        },
        "Nadia",
      );
    const accept = (payload: BillingPayload, version: number) =>
      recordBillingVisaDecision(
        payload,
        {
          draftId: draft.id,
          version,
          decision: "ACCEPTED",
          reviewMethod: "EMAIL",
          externalContact: "Architecte",
          evidence: "Accord signé",
          reason: "Accord total",
        },
        "Nadia",
      );
    const v1 = submit(initial);
    expect(v1.visaVersions?.[0].retention?.amountTtcCents).toBe(1_800);
    expect(() =>
      setBillingDraftRetention(
        v1,
        {
          draftId: draft.id,
          expectedUpdatedAt: initial.drafts[0].updatedAt,
          mode: "PERCENT",
          value: 3,
        },
        "Nadia",
      ),
    ).toThrow("BILLING_VISA_PENDING");
    const accepted = accept(v1, 1);
    const revised = setBillingDraftRetention(
      accepted,
      {
        draftId: draft.id,
        expectedUpdatedAt: accepted.drafts[0].updatedAt,
        mode: "PERCENT",
        value: 3,
      },
      "Lucien",
      new Date("2026-11-20T12:00:00Z"),
    );
    expect(() =>
      approveBillingDraft(revised, draft.id, revised.drafts[0].updatedAt, "Lucien"),
    ).toThrow("BILLING_VISA_STALE");
    const v2 = submit(revised);
    expect(v2.visaVersions?.[1].retention?.amountTtcCents).toBe(1_080);
    const approved = approveBillingDraft(
      accept(v2, 2),
      draft.id,
      revised.drafts[0].updatedAt,
      "Lucien",
    );
    expect(approved.status).toBe("APPROVED");
  });
});

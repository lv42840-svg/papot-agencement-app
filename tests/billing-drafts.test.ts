import { describe, expect, it } from "vitest";
import {
  createBillingDraft,
  distributeBillingTax,
  parseBillingPayload,
  preparedHtCents,
  resolveBillingAmount,
  updateBillingDraft,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";

const quoteId = "c6339770-f28e-4e0c-aa42-bcb81dc523f9";
const source: BillingSource = {
  quoteId,
  commercialCaseId: "dfc6e3ba-9d42-481a-b470-aa38043f1bb3",
  chantierId: "3ab3d699-a50d-4331-926f-a030fce11e8c",
  clientId: "1871db30-72fd-4702-914d-2a4f775d6eb8",
  clientName: "Client test",
  affairName: "Chantier test",
  quoteLabel: "D-2026-0123",
  contractHtCents: 150_000,
  contractTaxGroups: [
    { ratePercent: 10, baseHtCents: 50_000 },
    { ratePercent: 20, baseHtCents: 100_000 },
  ],
};
const empty = (): BillingPayload => ({ schemaVersion: 1, drafts: [] });
const user = "Nadia";

describe("Projets de facture issus des devis retenus", () => {
  it("crée 30 % d'acompte sur 1 800 € même avec une désignation vide dans le devis", () => {
    const quoteSource: BillingSource = {
      ...source,
      contractHtCents: 180_000,
      contractTaxGroups: [{ ratePercent: 20, baseHtCents: 180_000 }],
      lines: [
        {
          lineId: "11111111-1111-4111-8111-111111111111",
          description: "   ",
          quantity: 1,
          unit: "u",
          amountHtCents: 180_000,
          vatRatePercent: 20,
        },
      ],
    };
    const draft = createBillingDraft(
      empty(),
      quoteSource,
      { requestId: crypto.randomUUID(), type: "DEPOSIT", cumulativePercent: 30 },
      user,
    );
    expect(draft.amountHtCents).toBe(54_000);
    expect(draft.vatCents).toBe(10_800);
    expect(draft.documentLines?.[0].description).toBe("Prestation du devis D-2026-0123");
    expect(draft.documentLines?.[0].unitPriceCents).toBe(54_000);
  });

  it("refuse une situation à 20 % après un acompte de 30 %, accepte 40 %", () => {
    const lineId = "11111111-1111-4111-8111-111111111111";
    const contract: BillingSource = {
      ...source,
      contractHtCents: 180_000,
      contractTaxGroups: [{ ratePercent: 20, baseHtCents: 180_000 }],
      lines: [
        {
          lineId,
          description: "Ouvrage test",
          amountHtCents: 180_000,
          vatRatePercent: 20,
        },
      ],
    };
    const deposit = createBillingDraft(
      empty(),
      contract,
      { requestId: crypto.randomUUID(), type: "DEPOSIT", cumulativePercent: 30 },
      user,
    );
    const afterDeposit = { schemaVersion: 1 as const, drafts: [deposit] };
    expect(deposit.amountHtCents).toBe(54_000);
    expect(() =>
      createBillingDraft(
        afterDeposit,
        contract,
        {
          requestId: crypto.randomUUID(),
          type: "PROGRESS",
          linePercentages: [{ lineId, percent: 20 }],
        },
        user,
      ),
    ).toThrow("BILLING_PROGRESS_TAX_ALLOCATION_UNAVAILABLE");
    const progress = createBillingDraft(
      afterDeposit,
      contract,
      {
        requestId: crypto.randomUUID(),
        type: "PROGRESS",
        linePercentages: [{ lineId, percent: 40 }],
      },
      user,
    );
    expect(progress.amountHtCents).toBe(18_000);
    expect(progress.totalTtcCents).toBe(21_600);
  });

  it("calcule un acompte puis la situation cumulée après déduction de l'acompte", () => {
    const acompte = createBillingDraft(
      empty(),
      source,
      { requestId: "00000000-0000-4000-8000-000000000001", type: "DEPOSIT", amountHtCents: 30_000 },
      user,
    );
    expect(acompte.amountHtCents).toBe(30_000);
    expect(acompte.vatCents).toBe(5_000);
    expect(acompte.totalTtcCents).toBe(35_000);
    expect(acompte.status).toBe("DRAFT");
    expect(acompte.chantierId).toBe(source.chantierId);

    const payload = { schemaVersion: 1 as const, drafts: [acompte] };
    const situation = createBillingDraft(
      payload,
      source,
      {
        requestId: "00000000-0000-4000-8000-000000000002",
        type: "PROGRESS",
        cumulativePercent: 40,
      },
      user,
    );
    expect(situation.amountHtCents).toBe(30_000);
    const final = createBillingDraft(
      { schemaVersion: 1, drafts: [acompte, situation] },
      source,
      { requestId: "00000000-0000-4000-8000-000000000003", type: "FINAL" },
      user,
    );
    expect(final.amountHtCents).toBe(90_000);
    expect(
      preparedHtCents({ schemaVersion: 1, drafts: [acompte, situation, final] }, quoteId),
    ).toBe(150_000);
  });

  it("ne dépasse pas le contrat même avec plusieurs projets", () => {
    expect(() =>
      resolveBillingAmount({
        type: "DEPOSIT",
        contractHtCents: 1_000,
        alreadyPreparedCents: 800,
        amountHtCents: 250,
      }),
    ).toThrow("BILLING_AMOUNT_EXCEEDS_CONTRACT");
    expect(() =>
      resolveBillingAmount({
        type: "PROGRESS",
        contractHtCents: 1_000,
        alreadyPreparedCents: 800,
        cumulativePercent: 50,
      }),
    ).toThrow("BILLING_AMOUNT_INVALID");
  });

  it("répartit au centime exact entre taux de TVA", () => {
    const parts = distributeBillingTax(source.contractTaxGroups, 10_001);
    expect(parts.groups.reduce((sum, part) => sum + part.baseHtCents, 0)).toBe(10_001);
    expect(parts.vatCents).toBe(parts.groups.reduce((sum, part) => sum + part.vatCents, 0));
    expect(parts.ttcCents).toBe(parts.vatCents + 10_001);
  });

  it("modifie un brouillon sans perdre ses références et refuse une édition obsolète", () => {
    const draft = createBillingDraft(
      empty(),
      source,
      { requestId: "00000000-0000-4000-8000-000000000004", type: "DEPOSIT", amountHtCents: 20_000 },
      user,
    );
    const payload = { schemaVersion: 1 as const, drafts: [draft] };
    const updated = updateBillingDraft(
      payload,
      draft.id,
      {
        expectedUpdatedAt: draft.updatedAt,
        label: "Acompte chantier",
        notes: "30 jours",
        amountHtCents: 22_000,
      },
      "Lucien",
      new Date("2026-10-17T10:00:00Z"),
    );
    expect(updated.amountHtCents).toBe(22_000);
    expect(updated.quoteId).toBe(quoteId);
    expect(updated.updatedByName).toBe("Lucien");
    expect(() =>
      updateBillingDraft(
        { schemaVersion: 1, drafts: [updated] },
        draft.id,
        { expectedUpdatedAt: draft.updatedAt, label: "Périmé", notes: "" },
        user,
      ),
    ).toThrow("BILLING_VERSION_CONFLICT");
    expect(parseBillingPayload({ schemaVersion: 1, drafts: [updated] }).drafts).toHaveLength(1);
  });
});

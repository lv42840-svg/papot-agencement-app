import { describe, expect, it } from "vitest";
import {
  createBillingDraft, parseBillingPayload, updateBillingDraft,
  type BillingPayload, type BillingSource,
} from "../src/lib/billing/domain";

const L1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const L2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const L3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const source: BillingSource = {
  quoteId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  commercialCaseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  chantierId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  clientId: "11111111-1111-4111-8111-111111111111",
  clientName: "Entreprise test",
  affairName: "Chantier test",
  quoteLabel: "D-2026-0200",
  contractHtCents: 3_500_000,
  contractTaxGroups: [
    { ratePercent: 10, baseHtCents: 2_000_000 },
    { ratePercent: 20, baseHtCents: 1_500_000 },
  ],
  lines: [
    { lineId: L1, description: "Menuiseries", amountHtCents: 2_000_000, vatRatePercent: 10 },
    { lineId: L2, description: "Serrurerie", amountHtCents: 1_000_000, vatRatePercent: 20 },
    { lineId: L3, description: "Pose", amountHtCents: 500_000, vatRatePercent: 20 },
  ],
};
function make(rows: Array<[string, number]>, payload: BillingPayload) {
  return createBillingDraft(payload, source, {
    requestId: crypto.randomUUID(), type: "PROGRESS",
    linePercentages: rows.map(([lineId, percent]) => ({ lineId, percent })),
  }, "Nadia");
}
const empty = (): BillingPayload => ({ schemaVersion: 1, drafts: [] });

describe("Situations cumulées ligne par ligne", () => {
  it("calcule 80 % menuiseries, 30 % serrurerie, 0 % pose sans globaliser les taux", () => {
    const one = make([[L1, 80], [L2, 30], [L3, 0]], empty());
    expect(one.amountHtCents).toBe(1_900_000);
    expect(one.taxGroups).toEqual([
      { ratePercent: 10, baseHtCents: 1_600_000, vatCents: 160_000 },
      { ratePercent: 20, baseHtCents: 300_000, vatCents: 60_000 },
    ]);
    expect(one.vatCents).toBe(220_000);
    expect(one.totalTtcCents).toBe(2_120_000);
    expect(one.lineProgress?.map((row) => row.percent)).toEqual([80, 30, 0]);
  });

  it("soustrait le cumul précédent et empêche une régression sur une ligne", () => {
    const first = make([[L1, 80], [L2, 30], [L3, 0]], empty());
    const second = make([[L1, 90], [L2, 60], [L3, 50]], {
      schemaVersion: 1, drafts: [first],
    });
    expect(second.amountHtCents).toBe(750_000);
    expect(second.taxGroups.map((row) => row.baseHtCents)).toEqual([200_000, 550_000]);
    expect(() => make([[L1, 70], [L2, 60], [L3, 50]], {
      schemaVersion: 1, drafts: [first, second],
    })).toThrow("BILLING_PROGRESS_CANNOT_DECREASE");
    expect(() => updateBillingDraft({ schemaVersion: 1, drafts: [first, second] }, first.id, {
      expectedUpdatedAt: first.updatedAt, label: "Modifiée", notes: "", amountHtCents: 1,
    }, "Nadia")).toThrow("BILLING_LINE_PROGRESS_EDIT_FORBIDDEN");
  });

  it("déduit un acompte puis répartit le solde de situation par taux de TVA", () => {
    const initial = empty();
    const deposit = createBillingDraft(initial, source, {
      requestId: crypto.randomUUID(), type: "DEPOSIT", amountHtCents: 350_000,
    }, "Nadia");
    expect(deposit.taxGroups.map((row) => row.baseHtCents)).toEqual([200_000, 150_000]);
    const situation = make([[L1, 50], [L2, 50], [L3, 50]], {
      schemaVersion: 1, drafts: [deposit],
    });
    expect(situation.amountHtCents).toBe(1_400_000);
    expect(situation.taxGroups.map((row) => row.baseHtCents))
      .toEqual([800_000, 600_000]);
    expect(situation.totalTtcCents).toBe(1_600_000);
  });

  it("refuse un mélange de TVA négatif derrière un acompte", () => {
    const deposit = createBillingDraft(empty(), source, {
      requestId: crypto.randomUUID(), type: "DEPOSIT", amountHtCents: 350_000,
    }, "Nadia");
    expect(() => make([[L1, 0], [L2, 100], [L3, 100]], {
      schemaVersion: 1, drafts: [deposit],
    })).toThrow("BILLING_PROGRESS_TAX_ALLOCATION_UNAVAILABLE");
  });

  it("refuse les lignes manquantes, inconnues et doublonnées", () => {
    expect(() => make([[L1, 90], [L2, 20]], empty())).toThrow("BILLING_PROGRESS_LINES_REQUIRED");
    expect(() => make([[L1, 90], [L1, 10], [L3, 50]], empty()))
      .toThrow("BILLING_PROGRESS_PERCENT_INVALID");
  });

  it("accepte le global cumulé avec snapshots de lignes et distingue l'ancien historique", () => {
    const one = createBillingDraft(empty(), source, {
      requestId: crypto.randomUUID(), type: "PROGRESS", cumulativePercent: 30,
    }, "Nadia");
    expect(one.amountHtCents).toBe(1_050_000);
    expect(one.lineProgress).toHaveLength(3);
    expect(() => make([[L1, 20], [L2, 40], [L3, 30]], {
      schemaVersion: 1, drafts: [one],
    })).toThrow("BILLING_PROGRESS_CANNOT_DECREASE");

    const legacy = {
      ...one, cumulativePercent: null, lineProgress: undefined,
    };
    expect(() => make([[L1, 40], [L2, 40], [L3, 40]], {
      schemaVersion: 1, drafts: [legacy],
    })).toThrow("BILLING_PROGRESS_HISTORY_UNDETERMINED");
  });

  it("conserve les snapshots et empêche la modification du montant de ligne après création", () => {
    const one = make([[L1, 20], [L2, 10], [L3, 0]], empty());
    const parsed = parseBillingPayload({ schemaVersion: 1, drafts: [one] });
    expect(parsed.drafts[0].lineProgress?.length).toBe(3);
    expect(parsed.drafts[0].contractHtCents).toBe(source.contractHtCents);
    expect(() => updateBillingDraft(parsed, one.id, {
      expectedUpdatedAt: one.updatedAt, label: "Retouchée", notes: "",
      amountHtCents: one.amountHtCents + 1,
    }, "Nadia")).toThrow("BILLING_LINE_PROGRESS_EDIT_FORBIDDEN");
  });
});

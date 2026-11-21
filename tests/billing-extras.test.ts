import { describe, expect, it } from "vitest";
import { addBillingExtra, confirmBillingExtra } from "../src/lib/billing/extras";
import { buildChantierMarketSources } from "../src/lib/billing/market-sources";
import { summarizeChantierBillingMarkets } from "../src/lib/billing/chantier-market";
import {
  createBillingDraft,
  type BillingPayload,
  type BillingSource,
} from "../src/lib/billing/domain";

const chantierId = "11111111-1111-4111-8111-111111111111";
const quoteId = "22222222-2222-4222-8222-222222222222";
const caseId = "33333333-3333-4333-8333-333333333333";
const clientId = "44444444-4444-4444-8444-444444444444";
const lineId = "55555555-5555-4555-8555-555555555555";
const requestId = "66666666-6666-4666-8666-666666666666";
const empty: BillingPayload = { schemaVersion: 1, drafts: [] };
const chantier = {
  id: chantierId,
  sourceCommercialCaseId: caseId,
  name: "Boutique Pralus",
  number: null,
  clientName: "Pralus",
  status: "ACTIVE" as const,
};
const source: BillingSource = {
  quoteId,
  commercialCaseId: caseId,
  chantierId,
  clientId,
  clientName: "Pralus",
  affairName: "Boutique Pralus",
  quoteLabel: "D-2026-0001",
  contractHtCents: 100000,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: 100000 }],
  lines: [{ lineId, description: "Ouvrage", amountHtCents: 100000, vatRatePercent: 20 }],
};
const input = {
  requestId,
  chantierId,
  description: "Cornières complémentaires",
  amountHtCents: 32000,
  vatRatePercent: 20,
};
describe("travaux supplémentaires", () => {
  it("met un supplément non confirmé en attente, sans le rendre facturable", () => {
    const pending = addBillingExtra(empty, input, "Nadia");
    expect(pending.extras?.[0].agreementStatus).toBe("TO_CONFIRM");
    expect(addBillingExtra(pending, input, "Nadia")).toEqual(pending);
    const market = buildChantierMarketSources([chantier], [source], [], pending.extras ?? [])[0];
    expect(market.contractHtCents).toBe(100000);
    const overview = summarizeChantierBillingMarkets(
      [chantier],
      [source],
      [],
      [],
      pending.extras,
    )[0];
    expect(overview.pendingExtraHtCents).toBe(32000);
    expect(overview.confirmedExtraHtCents).toBe(0);
  });

  it("ajoute un supplément au contrat après preuve d'accord, sans changer le devis signé", () => {
    const pending = addBillingExtra(empty, input, "Nadia");
    const approved = confirmBillingExtra(
      pending,
      { extraId: requestId, evidence: "Accord client du 19/11/2026" },
      "Lucien",
    );
    const market = buildChantierMarketSources([chantier], [source], [], approved.extras ?? [])[0];
    expect(source.contractHtCents).toBe(100000);
    expect(approved.extras?.[0].confirmedByName).toBe("Lucien");
    expect(market.contractHtCents).toBe(132000);
    expect(market.lines).toHaveLength(2);
    const draft = createBillingDraft(
      empty,
      market,
      { requestId: crypto.randomUUID(), type: "STANDARD" },
      "Nadia",
    );
    expect(draft.amountHtCents).toBe(132000);
    expect(draft.documentLines?.filter((row) => row.origin === "QUOTE")).toHaveLength(2);
  });

  it("refuse la confirmation non documentée et protège les accords confirmés", () => {
    const pending = addBillingExtra(empty, input, "Nadia");
    expect(() =>
      confirmBillingExtra(pending, { extraId: requestId, evidence: "" }, "Lucien"),
    ).toThrow();
    const approved = confirmBillingExtra(
      pending,
      { extraId: requestId, evidence: "Accord oral confirmé" },
      "Lucien",
    );
    expect(() =>
      confirmBillingExtra(approved, { extraId: requestId, evidence: "Accord différent" }, "Nadia"),
    ).toThrow("BILLING_EXTRA_ALREADY_CONFIRMED");
  });
});

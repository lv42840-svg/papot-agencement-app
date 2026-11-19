import { describe, expect, it } from "vitest";
import { createBillingDraft, type BillingManualMarket, type BillingSource } from "../src/lib/billing/domain";
import { buildChantierMarketSources } from "../src/lib/billing/market-sources";
import { calculateLineProgress } from "../src/lib/billing/progress";
import { billingPreparationFollowup } from "../src/lib/billing/preparation-followup";

const chantierId = "11111111-1111-4111-8111-111111111111";
const caseId = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const chantier = {
  id: chantierId,
  name: "Boutique Pralus",
  clientName: "Client Pralus",
  sourceCommercialCaseId: caseId,
};
const q1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const q2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const l1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const l2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const quote = (quoteId: string, lineId: string, amount: number): BillingSource => ({
  quoteId,
  commercialCaseId: caseId,
  chantierId,
  clientId,
  clientName: "Client Pralus",
  affairName: "Boutique",
  quoteLabel: quoteId,
  contractHtCents: amount,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: amount }],
  lines: [
    { lineId, description: "Ouvrage", amountHtCents: amount, vatRatePercent: 20 },
  ],
  structure: [
    { kind: "TITLE", title: "Mobilier" },
    { kind: "LINE", lineId },
  ],
});
const empty = { schemaVersion: 1 as const, drafts: [] };

describe("moteur marché unique par chantier", () => {
  const market = () =>
    buildChantierMarketSources(
      [chantier],
      [quote(q1, l1, 80_000), quote(q2, l2, 120_000)],
      [],
    )[0];

  it("assemble deux devis sans perdre la provenance des prestations", () => {
    const source = market();
    expect(source.quoteId).toBe(chantierId);
    expect(source.sourceQuoteIds).toEqual([q1, q2]);
    expect(source.contractHtCents).toBe(200_000);
    expect(source.lines?.map((line) => line.sourceQuoteId)).toEqual([q1, q2]);
    expect(source.structure?.filter((item) => item.kind === "TITLE")).toHaveLength(4);
    const draft = createBillingDraft(
      empty,
      source,
      { requestId: crypto.randomUUID(), type: "PROGRESS", cumulativePercent: 25 },
      "Nadia",
    );
    expect(draft.amountHtCents).toBe(50_000);
    expect(draft.documentLines?.filter((line) => line.origin === "QUOTE")).toHaveLength(2);
  });

  it("prend en compte les projets historiques d'un devis pour éviter la double facturation", () => {
    const oldSource = quote(q1, l1, 80_000);
    const legacy = createBillingDraft(
      empty,
      oldSource,
      { requestId: crypto.randomUUID(), type: "DEPOSIT", amountHtCents: 20_000 },
      "Nadia",
    );
    const source = market();
    const draft = createBillingDraft(
      { schemaVersion: 1, drafts: [legacy] },
      source,
      { requestId: crypto.randomUUID(), type: "PROGRESS", cumulativePercent: 40 },
      "Lucien",
    );
    expect(draft.amountHtCents).toBe(60_000);
    expect(
      draft.documentLines
        ?.filter((line) => line.origin === "QUOTE")
        .map((line) => [line.sourceLineId, line.unitPriceCents]),
    ).toEqual([
      [l1, 12_000],
      [l2, 48_000],
    ]);
    expect(billingPreparationFollowup([source], [legacy, draft])[0].preparedHtCents).toBe(80_000);
  });

  it("crée un projet réel sans devis après configuration explicite du marché", () => {
    const manual: BillingManualMarket = {
      chantierId,
      commercialCaseId: caseId,
      clientId,
      clientName: "Client",
      description: "Intervention sans devis",
      lineId: l1,
      amountHtCents: 98_000,
      vatRatePercent: 20,
      createdAt: new Date().toISOString(),
      createdByName: "Lucien",
    };
    const source = buildChantierMarketSources([chantier], [], [manual])[0];
    expect(source.sourceQuoteIds).toEqual([]);
    const draft = createBillingDraft(
      empty,
      source,
      { requestId: crypto.randomUUID(), type: "STANDARD" },
      "Nadia",
    );
    expect(draft.chantierId).toBe(chantierId);
    expect(draft.amountHtCents).toBe(98_000);
  });

  it("refuse les devis d'un autre client dans le marché", () => {
    expect(() =>
      buildChantierMarketSources(
        [chantier],
        [quote(q1, l1, 80_000), { ...quote(q2, l2, 120_000), clientId: q1 }],
        [],
      ),
    ).toThrow("BILLING_MARKET_CLIENT_MISMATCH");
  });
});

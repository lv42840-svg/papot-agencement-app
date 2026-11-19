import { describe, expect, it } from "vitest";
import {
  summarizeChantierBillingMarkets,
} from "../src/lib/billing/chantier-market";
import { createBillingDraft, type BillingSource } from "../src/lib/billing/domain";

const chantierId = "11111111-1111-4111-8111-111111111111";
const caseId = "44444444-4444-4444-8444-444444444444";
const clientId = "33333333-3333-4333-8333-333333333333";
const chantierWithoutQuote = "22222222-2222-4222-8222-222222222222";
const clientId = "33333333-3333-4333-8333-333333333333";
const caseId = "44444444-4444-4444-8444-444444444444";
const chantier = (id: string) => ({
  id,
  name: id === chantierId ? "Boutique" : "Dépannage sans devis",
  number: null,
  clientName: "Client test",
  status: "ACTIVE" as const,
});
const source = (quoteId: string, amount: number): BillingSource => ({
  quoteId,
  commercialCaseId: caseId,
  chantierId,
  clientId,
  clientName: "Client test",
  affairName: "Boutique",
  quoteLabel: quoteId,
  contractHtCents: amount,
  contractTaxGroups: [{ ratePercent: 20, baseHtCents: amount }],
});

describe("marché global de facturation par chantier", () => {
  it("additionne les devis retenus sans confondre les brouillons avec les factures émises", () => {
    const a = source("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 100_000);
    const b = source("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 50_000);
    const draft = createBillingDraft(
      { schemaVersion: 1, drafts: [] },
      a,
      { requestId: crypto.randomUUID(), type: "DEPOSIT", amountHtCents: 30_000 },
      "Nadia",
    );
    const markets = summarizeChantierBillingMarkets(
      [chantier(chantierId)],
      [a, b],
      [draft],
    );
    expect(markets[0]).toMatchObject({
      quoteCount: 2,
      draftCount: 1,
      contractHtCents: 150_000,
      preparedHtCents: 30_000,
      remainingToPrepareHtCents: 120_000,
      requiresMarketEntry: false,
    });
    expect(markets[0].quotes).toHaveLength(2);
  });

  it("conserve la visibilité d'un chantier sans devis, sans inventer de montant", () => {
    const [market] = summarizeChantierBillingMarkets(
      [chantier(chantierWithoutQuote)],
      [],
      [],
    );
    expect(market.requiresMarketEntry).toBe(true);
    expect(market.contractHtCents).toBe(0);
    expect(market.remainingToPrepareHtCents).toBe(0);
  });

  it("affiche un marché manuel sans devis dans l'aperçu du chantier", () => {
    const [manual] = summarizeChantierBillingMarkets(
      [chantier(chantierWithoutQuote)],
      [],
      [],
      [
        {
          chantierId: chantierWithoutQuote,
          commercialCaseId: caseId,
          clientId,
          clientName: "Client test",
          description: "Intervention",
          lineId: "55555555-5555-4555-8555-555555555555",
          amountHtCents: 50000,
          vatRatePercent: 20,
          createdAt: new Date().toISOString(),
          createdByName: "Nadia",
        },
      ],
    );
    expect(manual.requiresMarketEntry).toBe(false);
    expect(manual.contractHtCents).toBe(50000);
  });

  it("signale les sources dupliquées et un dépassement de préparation", () => {
    const a = source("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 100_000);
    expect(() =>
      summarizeChantierBillingMarkets([chantier(chantierId)], [a, a], []),
    ).toThrow("BILLING_CHANTIER_MARKET_QUOTE_DUPLICATE");
    const draft = createBillingDraft(
      { schemaVersion: 1, drafts: [] },
      a,
      { requestId: crypto.randomUUID(), type: "STANDARD" },
      "Nadia",
    );
    const market = summarizeChantierBillingMarkets(
      [chantier(chantierId)],
      [],
      [draft],
    )[0];
    expect(market.preparationExceedsContract).toBe(true);
  });
});

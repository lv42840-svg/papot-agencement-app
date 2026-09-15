import { describe, expect, it } from "vitest";
import type {
  QuoteItem,
  QuoteLine,
  QuoteOuvrageComponent,
} from "../src/lib/quotes/model";
import { calculateQuoteEconomicSummary } from "../src/lib/quotes/summary";

function component(
  id: string,
  quantity: number,
  costPriceCents: number | undefined,
  unitPriceCents: number,
): QuoteOuvrageComponent {
  return {
    id,
    description: `Composant ${id}`,
    unit: "u",
    quantity,
    quantityFormula: null,
    ...(costPriceCents === undefined ? {} : { costPriceCents }),
    unitPriceCents,
  };
}

function line(
  id: string,
  quantity: number,
  unitPriceCents: number,
  components: QuoteOuvrageComponent[],
): QuoteLine {
  return {
    id,
    kind: "LINE",
    parentId: null,
    description: `Ouvrage ${id}`,
    unit: "u",
    quantity,
    quantityFormula: null,
    unitPriceCents,
    components,
  };
}

describe("quote economic summary", () => {
  it("calcule le total HT et la marge globale sur tous les ouvrages", () => {
    const items: QuoteItem[] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "SECTION",
        parentId: null,
        title: "Mobilier",
      },
      line(
        "22222222-2222-4222-8222-222222222222",
        2,
        10_000,
        [
          component(
            "33333333-3333-4333-8333-333333333333",
            2,
            3_000,
            5_000,
          ),
        ],
      ),
      line(
        "44444444-4444-4444-8444-444444444444",
        1,
        5_000,
        [
          component(
            "55555555-5555-4555-8555-555555555555",
            1,
            2_000,
            5_000,
          ),
        ],
      ),
    ];

    const summary = calculateQuoteEconomicSummary(items);

    expect(summary.totalSaleCents).toBe(25_000);
    expect(summary.totalCostCents).toBe(14_000);
    expect(summary.marginAmountCents).toBe(11_000);
    expect(summary.marginPercent).toBeCloseTo(78.5714, 4);
  });

  it("laisse la marge globale indéterminée si un coût composant manque", () => {
    const items: QuoteItem[] = [
      line(
        "66666666-6666-4666-8666-666666666666",
        2,
        10_000,
        [
          component(
            "77777777-7777-4777-8777-777777777777",
            1,
            undefined,
            10_000,
          ),
        ],
      ),
    ];

    const summary = calculateQuoteEconomicSummary(items);

    expect(summary.totalSaleCents).toBe(20_000);
    expect(summary.totalCostCents).toBeNull();
    expect(summary.marginAmountCents).toBeNull();
    expect(summary.marginPercent).toBeNull();
  });

  it("laisse la marge indéterminée pour une ancienne ligne sans composants", () => {
    const items: QuoteItem[] = [
      line("88888888-8888-4888-8888-888888888888", 1, 12_000, []),
    ];

    expect(calculateQuoteEconomicSummary(items)).toEqual({
      totalSaleCents: 12_000,
      totalCostCents: null,
      marginAmountCents: null,
      marginPercent: null,
    });
  });

  it("calcule une marge négative sans la bloquer", () => {
    const items: QuoteItem[] = [
      line(
        "99999999-9999-4999-8999-999999999999",
        1,
        8_000,
        [
          component(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            1,
            10_000,
            8_000,
          ),
        ],
      ),
    ];

    const summary = calculateQuoteEconomicSummary(items);

    expect(summary.marginAmountCents).toBe(-2_000);
    expect(summary.marginPercent).toBe(-20);
  });
});

import { describe, expect, it } from "vitest";
import { buildQuoteItemNumbers } from "../src/lib/quotes/numbering";
import type { QuoteItem } from "../src/lib/quotes/model";

const ids = {
  lineA: "11111111-1111-4111-8111-111111111111",
  section: "22222222-2222-4222-8222-222222222222",
  subsection: "33333333-3333-4333-8333-333333333333",
  lineB: "44444444-4444-4444-8444-444444444444",
  lineC: "55555555-5555-4555-8555-555555555555",
};

function line(id: string, parentId: string | null): QuoteItem {
  return {
    id,
    kind: "LINE",
    parentId,
    description: "Ouvrage",
    unit: "u",
    quantity: 1,
    quantityFormula: null,
    unitPriceCents: 1000,
    components: [],
  };
}

describe("quote item numbering", () => {
  it("numbers legacy top-level lines sequentially", () => {
    const numbers = buildQuoteItemNumbers([line(ids.lineA, null), line(ids.lineB, null)]);

    expect(numbers.get(ids.lineA)).toBe("1");
    expect(numbers.get(ids.lineB)).toBe("2");
  });

  it("creates hierarchical numbers for title, subtitle and ouvrages", () => {
    const items: QuoteItem[] = [
      line(ids.lineA, null),
      { id: ids.section, kind: "SECTION", parentId: null, title: "Mobilier" },
      {
        id: ids.subsection,
        kind: "SUBSECTION",
        parentId: ids.section,
        title: "Banque accueil",
      },
      line(ids.lineB, ids.subsection),
      line(ids.lineC, ids.section),
    ];

    const numbers = buildQuoteItemNumbers(items);

    expect(numbers.get(ids.lineA)).toBe("1");
    expect(numbers.get(ids.section)).toBe("2");
    expect(numbers.get(ids.subsection)).toBe("2.1");
    expect(numbers.get(ids.lineB)).toBe("2.1.1");
    expect(numbers.get(ids.lineC)).toBe("2.2");
  });
});

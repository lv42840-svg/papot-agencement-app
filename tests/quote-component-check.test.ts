import { describe, expect, it } from "vitest";
import { createEmptyQuotePricingConfig } from "../src/lib/quotes/adjustments";
import { calculateQuoteComponentCheck } from "../src/lib/quotes/component-check";
import type { QuoteItem, QuoteLine, QuoteOuvrageComponent } from "../src/lib/quotes/model";

const LIBRARY_COMPONENT_ID = "11111111-1111-4111-8111-111111111111";

function component(
  id: string,
  description: string,
  unit: string,
  quantity: number,
  activity?: "BE" | "ATELIER" | "POSE",
): QuoteOuvrageComponent {
  return {
    id,
    description,
    unit,
    quantity,
    quantityFormula: null,
    costPriceCents: 1_000,
    unitPriceCents: 2_000,
    ...(activity ? { activity } : {}),
  };
}

function libraryComponent(
  id: string,
  quantity: number,
  description = "Mélaminé blanc",
): QuoteOuvrageComponent {
  return {
    ...component(id, description, "m²", quantity),
    librarySource: {
      schemaVersion: 1,
      kind: "COMPONENT",
      component: {
        sourceComponentId: LIBRARY_COMPONENT_ID,
        name: "Mélaminé blanc",
        description: "Panneau mélaminé blanc",
        unit: "m²",
        costPriceCents: 1_000,
        marginPercent: 100,
        salePriceCents: 2_000,
      },
    },
  };
}

function line(
  id: string,
  quantity: number,
  components: QuoteOuvrageComponent[],
  parentId: string | null = null,
): QuoteLine {
  return {
    id,
    kind: "LINE",
    parentId,
    description: `Ouvrage ${id}`,
    unit: "u",
    quantity,
    quantityFormula: null,
    unitPriceCents: 10_000,
    components,
  };
}

describe("quote component check", () => {
  it("cumule un composant de bibliothèque présent dans plusieurs ouvrages", () => {
    const items: QuoteItem[] = [
      line("22222222-2222-4222-8222-222222222222", 2, [
        libraryComponent("33333333-3333-4333-8333-333333333333", 3),
      ]),
      line("44444444-4444-4444-8444-444444444444", 4, [
        libraryComponent("55555555-5555-4555-8555-555555555555", 1.5, "Blanc modifié"),
      ]),
    ];

    const check = calculateQuoteComponentCheck(items, createEmptyQuotePricingConfig());

    expect(check.rows).toHaveLength(1);
    expect(check.rows[0]).toMatchObject({
      name: "Mélaminé blanc",
      unit: "m²",
      plannedQuantity: 12,
      pendingOptionQuantity: 0,
      rejectedOptionQuantity: 0,
      ouvrageCount: 2,
    });
  });

  it("regroupe aussi les composants libres identiques par libellé, unité et activité", () => {
    const items: QuoteItem[] = [
      line("66666666-6666-4666-8666-666666666666", 1, [
        component("77777777-7777-4777-8777-777777777777", "  Quincaillerie ", "u", 2),
      ]),
      line("88888888-8888-4888-8888-888888888888", 3, [
        component("99999999-9999-4999-8999-999999999999", "quincaillerie", "u", 4),
      ]),
    ];

    const check = calculateQuoteComponentCheck(items, createEmptyQuotePricingConfig());

    expect(check.rows).toHaveLength(1);
    expect(check.rows[0].plannedQuantity).toBe(14);
    expect(check.rows[0].ouvrageCount).toBe(2);
  });

  it("sépare les options en attente et refusées du prévu chantier", () => {
    const sectionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const retainedLineId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const pendingLineId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const rejectedLineId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const items: QuoteItem[] = [
      { id: sectionId, kind: "SECTION", parentId: null, title: "Options" },
      line(retainedLineId, 2, [
        component("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "Poignée", "u", 2),
      ]),
      line(
        pendingLineId,
        3,
        [component("ffffffff-ffff-4fff-8fff-ffffffffffff", "Poignée", "u", 2)],
        sectionId,
      ),
      line(rejectedLineId, 5, [
        component("12121212-1212-4212-8212-121212121212", "Poignée", "u", 2),
      ]),
    ];
    const config = createEmptyQuotePricingConfig();
    config.options = [
      {
        id: "13131313-1313-4313-8313-131313131313",
        targetItemId: sectionId,
        targetKind: "SECTION",
        label: "Option section",
        status: "PENDING",
      },
      {
        id: "14141414-1414-4414-8414-141414141414",
        targetItemId: rejectedLineId,
        targetKind: "LINE",
        label: "Option refusée",
        status: "REJECTED",
      },
    ];

    const check = calculateQuoteComponentCheck(items, config);

    expect(check.rows).toHaveLength(1);
    expect(check.rows[0]).toMatchObject({
      plannedQuantity: 4,
      pendingOptionQuantity: 6,
      rejectedOptionQuantity: 10,
      ouvrageCount: 3,
    });
  });

  it("totalise BE, atelier et pose en incluant les heures de pose ajoutées", () => {
    const items: QuoteItem[] = [
      line("15151515-1515-4515-8515-151515151515", 2, [
        component("16161616-1616-4616-8616-161616161616", "Heure BE", "h", 1.5, "BE"),
        component("17171717-1717-4717-8717-171717171717", "Heure atelier", "h", 4, "ATELIER"),
        component("18181818-1818-4818-8818-181818181818", "Heure pose", "h", 2, "POSE"),
      ]),
    ];
    const config = createEmptyQuotePricingConfig();
    config.adjustments = [
      {
        id: "19191919-1919-4919-8919-191919191919",
        kind: "POSE_HOURS",
        label: "Trajet",
        active: true,
        applyToOptions: false,
        marginTreatment: "MARGED",
        hours: 3,
      },
    ];

    const check = calculateQuoteComponentCheck(items, config);

    expect(check.plannedHours).toEqual({
      be: 3,
      atelier: 8,
      pose: 7,
      total: 18,
    });
  });
});

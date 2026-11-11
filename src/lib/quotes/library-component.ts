import {
  calculateLibraryComponentMarginPercent,
  parseLibraryComponent,
  type LibraryComponent,
} from "../library/component";
import type { ProductionActivity } from "../production-activity";
import type { QuoteLibraryComponentSource } from "./model";

export function createLibraryComponentFromQuoteLine(saisie: {
  componentId: string;
  name: string;
  description: string;
  unit: string;
  costPriceCents: number;
  salePriceCents: number;
  activity?: ProductionActivity;
}): { component: LibraryComponent; source: QuoteLibraryComponentSource } {
  if (!saisie.unit.trim()) throw new Error("LIBRARY_COMPONENT_UNIT_REQUIRED");

  const component = parseLibraryComponent({
    id: saisie.componentId,
    name: saisie.name,
    description: saisie.description,
    unit: saisie.unit,
    costPriceCents: saisie.costPriceCents,
    marginPercent: calculateLibraryComponentMarginPercent(
      saisie.costPriceCents,
      saisie.salePriceCents,
    ),
    salePriceCents: saisie.salePriceCents,
    ...(saisie.activity ? { activity: saisie.activity } : {}),
  });

  return {
    component,
    source: {
      schemaVersion: 1,
      kind: "COMPONENT",
      component: {
        sourceComponentId: component.id,
        name: component.name,
        description: component.description,
        unit: component.unit,
        costPriceCents: component.costPriceCents,
        marginPercent: component.marginPercent,
        salePriceCents: component.salePriceCents,
        ...(component.activity ? { activity: component.activity } : {}),
      },
    },
  };
}

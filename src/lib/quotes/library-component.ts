import {
  calculateLibraryComponentMarginPercent,
  parseLibraryComponent,
  type LibraryComponent,
} from "../library/component";
import type { QuoteLibraryComponentSource } from "./model";

export function createLibraryComponentFromQuoteLine(input: {
  componentId: string;
  name: string;
  description: string;
  unit: string;
  costPriceCents: number;
  salePriceCents: number;
}): { component: LibraryComponent; source: QuoteLibraryComponentSource } {
  if (!input.unit.trim()) throw new Error("LIBRARY_COMPONENT_UNIT_REQUIRED");

  const component = parseLibraryComponent({
    id: input.componentId,
    name: input.name,
    description: input.description,
    unit: input.unit,
    costPriceCents: input.costPriceCents,
    marginPercent: calculateLibraryComponentMarginPercent(
      input.costPriceCents,
      input.salePriceCents,
    ),
    salePriceCents: input.salePriceCents,
  });

  return {
    component,
    source: {
      schemaVersion: 1,
      kind: "COMPONENT",
      component,
    },
  };
}

import {
  calculateLibraryComponentMarginPercent,
  type LibraryComponent,
} from "../library/component";
import { upsertLibraryComponent, upsertLibraryOuvrage } from "../library/catalog-edit";
import type { LibraryOuvrage } from "../library/ouvrage";
import { parseLibraryPayload, type LibraryPayload } from "../library/storage";
import {
  quoteOuvrageComponentCostPriceCents,
  type QuoteLine,
  type QuoteOuvrageComponent,
} from "./model";

export type QuoteOuvrageLibraryPublishResult = {
  payload: LibraryPayload;
  ouvrageId: string;
  createdComponentCount: number;
};

type IdFactory = () => string;

function sameLibraryPricing(
  component: QuoteOuvrageComponent,
  candidate: LibraryComponent,
  costPriceCents: number,
): boolean {
  const source = component.librarySource?.component;
  if (!source || source.sourceComponentId !== candidate.id) return false;

  return (
    component.description === source.name &&
    component.unit === source.unit &&
    costPriceCents === source.costPriceCents &&
    component.unitPriceCents === source.salePriceCents &&
    candidate.name === source.name &&
    candidate.description === source.description &&
    candidate.unit === source.unit &&
    candidate.costPriceCents === source.costPriceCents &&
    candidate.marginPercent === source.marginPercent &&
    candidate.salePriceCents === source.salePriceCents
  );
}

function reusableLibraryComponent(
  payload: LibraryPayload,
  component: QuoteOuvrageComponent,
  costPriceCents: number,
): LibraryComponent | null {
  const sourceId = component.librarySource?.component.sourceComponentId;
  if (!sourceId) return null;
  const candidate = payload.components.find((item) => item.id === sourceId);
  if (!candidate) return null;
  return sameLibraryPricing(component, candidate, costPriceCents) ? candidate : null;
}

function libraryComponentFromQuoteComponent(
  component: QuoteOuvrageComponent,
  id: string,
  costPriceCents: number,
): LibraryComponent {
  const unit = component.unit.trim();
  if (!unit) throw new Error("QUOTE_LIBRARY_COMPONENT_UNIT_REQUIRED");

  const name = component.description.trim().slice(0, 240);
  if (!name) throw new Error("QUOTE_LIBRARY_COMPONENT_NAME_REQUIRED");

  let marginPercent: number;
  try {
    marginPercent = calculateLibraryComponentMarginPercent(
      costPriceCents,
      component.unitPriceCents,
    );
  } catch {
    throw new Error("QUOTE_LIBRARY_COMPONENT_PRICING_INVALID");
  }

  return {
    id,
    name,
    description: component.librarySource?.component.description ?? component.description,
    unit,
    costPriceCents,
    marginPercent,
    salePriceCents: component.unitPriceCents,
  };
}

export function publishQuoteOuvrageToLibrary(
  source: LibraryPayload,
  line: QuoteLine,
  idFactory: IdFactory = () => globalThis.crypto.randomUUID(),
): QuoteOuvrageLibraryPublishResult {
  const components = line.components ?? [];
  if (components.length === 0) {
    throw new Error("QUOTE_LIBRARY_OUVRAGE_COMPONENTS_REQUIRED");
  }

  let payload = parseLibraryPayload(source);
  let createdComponentCount = 0;
  const ouvrageComponents: LibraryOuvrage["components"] = [];

  for (const component of components) {
    const costPriceCents = quoteOuvrageComponentCostPriceCents(component);
    if (costPriceCents === null) {
      throw new Error("QUOTE_LIBRARY_COMPONENT_COST_REQUIRED");
    }

    const reusable = reusableLibraryComponent(payload, component, costPriceCents);
    let componentId = reusable?.id;

    if (!componentId) {
      componentId = idFactory();
      const libraryComponent = libraryComponentFromQuoteComponent(
        component,
        componentId,
        costPriceCents,
      );
      payload = upsertLibraryComponent(payload, libraryComponent);
      createdComponentCount += 1;
    }

    ouvrageComponents.push({
      id: idFactory(),
      componentId,
      quantity: component.quantity,
    });
  }

  const ouvrageId = idFactory();
  payload = upsertLibraryOuvrage(payload, {
    id: ouvrageId,
    name: line.description.trim().slice(0, 240),
    description: line.description,
    components: ouvrageComponents,
  });

  return { payload, ouvrageId, createdComponentCount };
}

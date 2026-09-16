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

export type QuoteComponentLibraryPublishMode = "CREATE_NEW" | "OVERWRITE_LINKED";

export type QuoteComponentLibraryPublishResult = {
  payload: LibraryPayload;
  componentId: string;
  created: boolean;
  updated: boolean;
};

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
  const sourceId = component.librarySource?.component.sourceComponentId;
  if (!sourceId || sourceId !== candidate.id) return false;

  const unit = component.unit.trim();
  const name = component.description.trim().slice(0, 240);
  const activity = component.activity ?? component.librarySource?.component.activity;
  let marginPercent: number;
  try {
    marginPercent = calculateLibraryComponentMarginPercent(
      costPriceCents,
      component.unitPriceCents,
    );
  } catch {
    return false;
  }

  return (
    candidate.name === name &&
    candidate.unit === unit &&
    candidate.costPriceCents === costPriceCents &&
    candidate.marginPercent === marginPercent &&
    candidate.salePriceCents === component.unitPriceCents &&
    candidate.activity === activity
  );
}

function linkedLibraryComponent(
  payload: LibraryPayload,
  component: QuoteOuvrageComponent,
): LibraryComponent | null {
  const sourceId = component.librarySource?.component.sourceComponentId;
  if (!sourceId) return null;
  return payload.components.find((item) => item.id === sourceId) ?? null;
}

function reusableLibraryComponent(
  payload: LibraryPayload,
  component: QuoteOuvrageComponent,
  costPriceCents: number,
): LibraryComponent | null {
  const candidate = linkedLibraryComponent(payload, component);
  if (!candidate) return null;
  return sameLibraryPricing(component, candidate, costPriceCents) ? candidate : null;
}

function libraryComponentFromQuoteComponent(
  component: QuoteOuvrageComponent,
  id: string,
  costPriceCents: number,
  preservedDescription?: string,
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

  const activity = component.activity ?? component.librarySource?.component.activity;
  return {
    id,
    name,
    description:
      preservedDescription ??
      component.librarySource?.component.description ??
      component.description,
    unit,
    costPriceCents,
    marginPercent,
    salePriceCents: component.unitPriceCents,
    ...(activity ? { activity } : {}),
  };
}

export function publishQuoteComponentToLibrary(
  source: LibraryPayload,
  component: QuoteOuvrageComponent,
  idFactory: IdFactory = () => globalThis.crypto.randomUUID(),
  mode: QuoteComponentLibraryPublishMode = "CREATE_NEW",
): QuoteComponentLibraryPublishResult {
  let payload = parseLibraryPayload(source);
  const costPriceCents = quoteOuvrageComponentCostPriceCents(component);
  if (costPriceCents === null) {
    throw new Error("QUOTE_LIBRARY_COMPONENT_COST_REQUIRED");
  }

  const reusable = reusableLibraryComponent(payload, component, costPriceCents);
  if (reusable) {
    return { payload, componentId: reusable.id, created: false, updated: false };
  }

  const linked = linkedLibraryComponent(payload, component);
  if (mode === "OVERWRITE_LINKED" && linked) {
    payload = upsertLibraryComponent(
      payload,
      libraryComponentFromQuoteComponent(
        component,
        linked.id,
        costPriceCents,
        linked.description,
      ),
    );
    return { payload, componentId: linked.id, created: false, updated: true };
  }

  const componentId = idFactory();
  payload = upsertLibraryComponent(
    payload,
    libraryComponentFromQuoteComponent(component, componentId, costPriceCents),
  );
  return { payload, componentId, created: true, updated: false };
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
    const publishedComponent = publishQuoteComponentToLibrary(payload, component, idFactory);
    payload = publishedComponent.payload;
    if (publishedComponent.created) createdComponentCount += 1;

    ouvrageComponents.push({
      id: idFactory(),
      componentId: publishedComponent.componentId,
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

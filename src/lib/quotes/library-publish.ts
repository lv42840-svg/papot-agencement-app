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
  candidat: LibraryComponent,
  costPriceCents: number,
): boolean {
  const sourceId = component.librarySource?.component.sourceComponentId;
  if (!sourceId || sourceId !== candidat.id) return false;

  const unit = component.unit.trim();
  const nom = component.description.trim().slice(0, 240);
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
    candidat.name === nom &&
    candidat.unit === unit &&
    candidat.costPriceCents === costPriceCents &&
    candidat.marginPercent === marginPercent &&
    candidat.salePriceCents === component.unitPriceCents &&
    candidat.activity === activity
  );
}

function linkedLibraryComponent(
  contenu: LibraryPayload,
  component: QuoteOuvrageComponent,
): LibraryComponent | null {
  const sourceId = component.librarySource?.component.sourceComponentId;
  if (!sourceId) return null;
  return contenu.components.find((element) => element.id === sourceId) ?? null;
}

function reusableLibraryComponent(
  contenu: LibraryPayload,
  component: QuoteOuvrageComponent,
  costPriceCents: number,
): LibraryComponent | null {
  const candidat = linkedLibraryComponent(contenu, component);
  if (!candidat) return null;
  return sameLibraryPricing(component, candidat, costPriceCents) ? candidat : null;
}

function libraryComponentFromQuoteComponent(
  component: QuoteOuvrageComponent,
  id: string,
  costPriceCents: number,
  preservedDescription?: string,
): LibraryComponent {
  const unit = component.unit.trim();
  if (!unit) throw new Error("QUOTE_LIBRARY_COMPONENT_UNIT_REQUIRED");

  const nom = component.description.trim().slice(0, 240);
  if (!nom) throw new Error("QUOTE_LIBRARY_COMPONENT_NAME_REQUIRED");

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
    name: nom,
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
  let contenu = parseLibraryPayload(source);
  const costPriceCents = quoteOuvrageComponentCostPriceCents(component);
  if (costPriceCents === null) {
    throw new Error("QUOTE_LIBRARY_COMPONENT_COST_REQUIRED");
  }

  const reusable = reusableLibraryComponent(contenu, component, costPriceCents);
  if (reusable) {
    return { payload: contenu, componentId: reusable.id, created: false, updated: false };
  }

  const linked = linkedLibraryComponent(contenu, component);
  if (mode === "OVERWRITE_LINKED" && linked) {
    contenu = upsertLibraryComponent(
      contenu,
      libraryComponentFromQuoteComponent(component, linked.id, costPriceCents, linked.description),
    );
    return { payload: contenu, componentId: linked.id, created: false, updated: true };
  }

  const componentId = idFactory();
  contenu = upsertLibraryComponent(
    contenu,
    libraryComponentFromQuoteComponent(component, componentId, costPriceCents),
  );
  return { payload: contenu, componentId, created: true, updated: false };
}

export function publishQuoteOuvrageToLibrary(
  source: LibraryPayload,
  ligne: QuoteLine,
  idFactory: IdFactory = () => globalThis.crypto.randomUUID(),
): QuoteOuvrageLibraryPublishResult {
  const components = ligne.components ?? [];
  if (components.length === 0) {
    throw new Error("QUOTE_LIBRARY_OUVRAGE_COMPONENTS_REQUIRED");
  }

  let contenu = parseLibraryPayload(source);
  let createdComponentCount = 0;
  const ouvrageComponents: LibraryOuvrage["components"] = [];

  for (const component of components) {
    const publishedComponent = publishQuoteComponentToLibrary(contenu, component, idFactory);
    contenu = publishedComponent.payload;
    if (publishedComponent.created) createdComponentCount += 1;

    ouvrageComponents.push({
      id: idFactory(),
      componentId: publishedComponent.componentId,
      quantity: component.quantity,
    });
  }

  const ouvrageId = idFactory();
  contenu = upsertLibraryOuvrage(contenu, {
    id: ouvrageId,
    name: ligne.description.trim().slice(0, 240),
    description: ligne.description,
    components: ouvrageComponents,
  });

  return { payload: contenu, ouvrageId, createdComponentCount };
}

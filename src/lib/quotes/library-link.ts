import type { LibraryComponent } from "../library/component";
import type { LibraryOuvrage } from "../library/ouvrage";
import type { LibraryPayload } from "../library/storage";
import { QUOTE_MAX_QUANTITY } from "./domain";
import {
  parseQuoteModel,
  type QuoteLibraryComponentSnapshot,
  type QuoteLibraryOuvrageSource,
  type QuoteLine,
  type QuoteModel,
} from "./model";

type QuoteLibraryInsertBase = {
  quote: QuoteModel;
  library: LibraryPayload;
  lineId: string;
  parentId?: string | null;
  quantity?: number;
};

type QuoteLibraryComponentInsert = QuoteLibraryInsertBase & {
  componentId: string;
};

type QuoteLibraryOuvrageInsert = QuoteLibraryInsertBase & {
  ouvrageId: string;
};

function parseInsertQuantity(value: number | undefined): number {
  const quantity = value ?? 1;
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > QUOTE_MAX_QUANTITY) {
    throw new Error("QUOTE_LIBRARY_QUANTITY_INVALID");
  }
  return quantity;
}

function snapshotComponent(component: LibraryComponent): QuoteLibraryComponentSnapshot {
  return {
    sourceComponentId: component.id,
    name: component.name,
    description: component.description,
    unit: component.unit,
    costPriceCents: component.costPriceCents,
    marginPercent: component.marginPercent,
    salePriceCents: component.salePriceCents,
  };
}

function findComponent(library: LibraryPayload, componentId: string): LibraryComponent {
  const component = library.components.find((candidate) => candidate.id === componentId);
  if (!component) throw new Error("QUOTE_LIBRARY_COMPONENT_NOT_FOUND");
  return component;
}

function findOuvrage(library: LibraryPayload, ouvrageId: string): LibraryOuvrage {
  const ouvrage = library.ouvrages.find((candidate) => candidate.id === ouvrageId);
  if (!ouvrage) throw new Error("QUOTE_LIBRARY_OUVRAGE_NOT_FOUND");
  return ouvrage;
}

function multiplyMoneyCents(quantity: number, amountCents: number): number {
  const total = Math.round(quantity * amountCents);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("QUOTE_LIBRARY_PRICE_INVALID");
  }
  return total;
}

function addMoneyCents(total: number, amount: number): number {
  const next = total + amount;
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new Error("QUOTE_LIBRARY_PRICE_INVALID");
  }
  return next;
}

function snapshotOuvrage(
  library: LibraryPayload,
  ouvrage: LibraryOuvrage,
): QuoteLibraryOuvrageSource {
  let costPriceCents = 0;
  let salePriceCents = 0;

  const components = ouvrage.components.map((line) => {
    const component = findComponent(library, line.componentId);
    const componentSnapshot = snapshotComponent(component);
    costPriceCents = addMoneyCents(
      costPriceCents,
      multiplyMoneyCents(line.quantity, component.costPriceCents),
    );
    salePriceCents = addMoneyCents(
      salePriceCents,
      multiplyMoneyCents(line.quantity, component.salePriceCents),
    );

    return {
      sourceLineId: line.id,
      quantity: line.quantity,
      component: componentSnapshot,
    };
  });

  return {
    schemaVersion: 1,
    kind: "OUVRAGE",
    sourceOuvrageId: ouvrage.id,
    name: ouvrage.name,
    description: ouvrage.description,
    costPriceCents,
    salePriceCents,
    components,
  };
}

function appendLibraryLine(quote: QuoteModel, line: QuoteLine): QuoteModel {
  return parseQuoteModel({
    ...quote,
    items: [...quote.items, line],
  });
}

export function insertLibraryComponentIntoQuote(params: QuoteLibraryComponentInsert): QuoteModel {
  const quote = parseQuoteModel(params.quote);
  const component = findComponent(params.library, params.componentId);
  const componentSnapshot = snapshotComponent(component);

  return appendLibraryLine(quote, {
    id: params.lineId,
    kind: "LINE",
    parentId: params.parentId ?? null,
    description: component.name,
    unit: component.unit,
    quantity: parseInsertQuantity(params.quantity),
    quantityFormula: null,
    unitPriceCents: component.salePriceCents,
    librarySource: {
      schemaVersion: 1,
      kind: "COMPONENT",
      component: componentSnapshot,
    },
  });
}

export function insertLibraryOuvrageIntoQuote(params: QuoteLibraryOuvrageInsert): QuoteModel {
  const quote = parseQuoteModel(params.quote);
  const ouvrage = findOuvrage(params.library, params.ouvrageId);
  const ouvrageSnapshot = snapshotOuvrage(params.library, ouvrage);

  return appendLibraryLine(quote, {
    id: params.lineId,
    kind: "LINE",
    parentId: params.parentId ?? null,
    description: ouvrage.name,
    unit: "",
    quantity: parseInsertQuantity(params.quantity),
    quantityFormula: null,
    unitPriceCents: ouvrageSnapshot.salePriceCents,
    librarySource: ouvrageSnapshot,
  });
}

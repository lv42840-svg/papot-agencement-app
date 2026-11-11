import type { LibraryComponent } from "../library/component";
import type { LibraryOuvrage } from "../library/ouvrage";
import type { LibraryPayload } from "../library/storage";
import { QUOTE_MAX_QUANTITY } from "./domain";
import {
  calculateQuoteOuvrageUnitPriceCents,
  parseQuoteModel,
  type QuoteLibraryComponentSnapshot,
  type QuoteLibraryOuvrageSource,
  type QuoteLine,
  type QuoteModel,
  type QuoteOuvrageComponent,
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

function parseInsertQuantity(valeur: number | undefined): number {
  const quantity = valeur ?? 1;
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
  const component = library.components.find((candidat) => candidat.id === componentId);
  if (!component) throw new Error("QUOTE_LIBRARY_COMPONENT_NOT_FOUND");
  return component;
}

function findOuvrage(library: LibraryPayload, ouvrageId: string): LibraryOuvrage {
  const ouvrage = library.ouvrages.find((candidat) => candidat.id === ouvrageId);
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

function addMoneyCents(total: number, montant: number): number {
  const suivant = total + montant;
  if (!Number.isSafeInteger(suivant) || suivant < 0) {
    throw new Error("QUOTE_LIBRARY_PRICE_INVALID");
  }
  return suivant;
}

function snapshotOuvrage(
  library: LibraryPayload,
  ouvrage: LibraryOuvrage,
): QuoteLibraryOuvrageSource {
  let costPriceCents = 0;
  let salePriceCents = 0;

  const components = ouvrage.components.map((ligne) => {
    const component = findComponent(library, ligne.componentId);
    const componentSnapshot = snapshotComponent(component);
    costPriceCents = addMoneyCents(
      costPriceCents,
      multiplyMoneyCents(ligne.quantity, component.costPriceCents),
    );
    salePriceCents = addMoneyCents(
      salePriceCents,
      multiplyMoneyCents(ligne.quantity, component.salePriceCents),
    );

    return {
      sourceLineId: ligne.id,
      quantity: ligne.quantity,
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

function quoteComponentFromSnapshot(
  snapshot: QuoteLibraryComponentSnapshot,
  quantity: number,
  id: string = globalThis.crypto.randomUUID(),
): QuoteOuvrageComponent {
  return {
    id,
    description: snapshot.name,
    unit: snapshot.unit,
    quantity,
    quantityFormula: null,
    unitPriceCents: snapshot.salePriceCents,
    librarySource: {
      schemaVersion: 1,
      kind: "COMPONENT",
      component: snapshot,
    },
  };
}

function appendLibraryLine(quote: QuoteModel, ligne: QuoteLine): QuoteModel {
  return parseQuoteModel({
    ...quote,
    items: [...quote.items, ligne],
  });
}

export function insertLibraryComponentIntoQuote(
  parametres: QuoteLibraryComponentInsert,
): QuoteModel {
  const quote = parseQuoteModel(parametres.quote);
  const component = findComponent(parametres.library, parametres.componentId);
  const componentSnapshot = snapshotComponent(component);
  const components = [
    quoteComponentFromSnapshot(componentSnapshot, parseInsertQuantity(parametres.quantity)),
  ];

  return appendLibraryLine(quote, {
    id: parametres.lineId,
    kind: "LINE",
    parentId: parametres.parentId ?? null,
    description: component.name,
    unit: "u",
    quantity: 1,
    quantityFormula: null,
    unitPriceCents: calculateQuoteOuvrageUnitPriceCents(components),
    components,
    librarySource: {
      schemaVersion: 1,
      kind: "COMPONENT",
      component: componentSnapshot,
    },
  });
}

export function insertLibraryOuvrageIntoQuote(parametres: QuoteLibraryOuvrageInsert): QuoteModel {
  const quote = parseQuoteModel(parametres.quote);
  const ouvrage = findOuvrage(parametres.library, parametres.ouvrageId);
  const ouvrageSnapshot = snapshotOuvrage(parametres.library, ouvrage);
  const components = ouvrageSnapshot.components.map((ligne) =>
    quoteComponentFromSnapshot(ligne.component, ligne.quantity, ligne.sourceLineId),
  );

  return appendLibraryLine(quote, {
    id: parametres.lineId,
    kind: "LINE",
    parentId: parametres.parentId ?? null,
    description: ouvrage.name,
    unit: "u",
    quantity: parseInsertQuantity(parametres.quantity),
    quantityFormula: null,
    unitPriceCents: calculateQuoteOuvrageUnitPriceCents(components),
    components,
    librarySource: ouvrageSnapshot,
  });
}

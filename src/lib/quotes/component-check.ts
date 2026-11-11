import type { ProductionActivity } from "../production-activity";
import {
  calculateQuoteAdjustedPricing,
  type QuoteOptionStatus,
  type QuotePricingConfig,
} from "./adjustments";
import type { QuoteItem, QuoteLine, QuoteOuvrageComponent } from "./model";

export type QuoteComponentCheckRow = {
  key: string;
  name: string;
  unit: string;
  activity: ProductionActivity | null;
  plannedQuantity: number;
  pendingOptionQuantity: number;
  rejectedOptionQuantity: number;
  ouvrageCount: number;
};

export type QuoteHoursCheck = {
  be: number;
  atelier: number;
  pose: number;
  total: number;
};

export type QuoteComponentCheck = {
  rows: QuoteComponentCheckRow[];
  plannedHours: QuoteHoursCheck;
  pendingOptionHours: QuoteHoursCheck;
  rejectedOptionHours: QuoteHoursCheck;
};

type MutableComponentRow = QuoteComponentCheckRow & {
  ouvrageIds: Set<string>;
};

type QuantityBucket = "plannedQuantity" | "pendingOptionQuantity" | "rejectedOptionQuantity";

function roundQuantity(valeur: number): number {
  return Math.round(valeur * 1_000_000) / 1_000_000;
}

function normalizeKeyPart(valeur: string): string {
  return valeur.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
}

function componentActivity(component: QuoteOuvrageComponent): ProductionActivity | null {
  return component.activity ?? component.librarySource?.component.activity ?? null;
}

function componentKey(component: QuoteOuvrageComponent): string {
  const unit = normalizeKeyPart(component.unit || component.librarySource?.component.unit || "u");
  const activity = componentActivity(component) ?? "NONE";
  const libraryId = component.librarySource?.component.sourceComponentId;
  if (libraryId) return `library:${libraryId}:${unit}:${activity}`;
  return `free:${normalizeKeyPart(component.description)}:${unit}:${activity}`;
}

function componentName(component: QuoteOuvrageComponent): string {
  return component.librarySource?.component.name ?? component.description;
}

function optionStatusForLine(
  ligne: QuoteLine,
  itemsById: ReadonlyMap<string, QuoteItem>,
  optionStatusByTarget: ReadonlyMap<string, QuoteOptionStatus>,
): QuoteOptionStatus | null {
  const direct = optionStatusByTarget.get(ligne.id);
  if (direct) return direct;
  if (!ligne.parentId) return null;

  const parent = itemsById.get(ligne.parentId);
  if (!parent) return null;
  const parentStatus = optionStatusByTarget.get(parent.id);
  if (parentStatus) return parentStatus;

  if (parent.kind === "SUBSECTION") {
    return optionStatusByTarget.get(parent.parentId) ?? null;
  }
  return null;
}

function bucketForStatus(statut: QuoteOptionStatus | null): QuantityBucket {
  if (statut === "PENDING") return "pendingOptionQuantity";
  if (statut === "REJECTED") return "rejectedOptionQuantity";
  return "plannedQuantity";
}

function emptyHours(): QuoteHoursCheck {
  return { be: 0, atelier: 0, pose: 0, total: 0 };
}

function finalizeHours(heures: QuoteHoursCheck): QuoteHoursCheck {
  const be = roundQuantity(heures.be);
  const atelier = roundQuantity(heures.atelier);
  const pose = roundQuantity(heures.pose);
  return { be, atelier, pose, total: roundQuantity(be + atelier + pose) };
}

function hoursBucketForStatus(
  statut: QuoteOptionStatus | null,
  planned: QuoteHoursCheck,
  pending: QuoteHoursCheck,
  rejected: QuoteHoursCheck,
): QuoteHoursCheck {
  if (statut === "PENDING") return pending;
  if (statut === "REJECTED") return rejected;
  return planned;
}

export function calculateQuoteComponentCheck(
  elements: QuoteItem[],
  pricingConfig: QuotePricingConfig,
): QuoteComponentCheck {
  const itemsById = new Map(elements.map((element) => [element.id, element]));
  const optionStatusByTarget = new Map(
    pricingConfig.options.map((option) => [option.targetItemId, option.status]),
  );
  const rowsByKey = new Map<string, MutableComponentRow>();
  const plannedHours = emptyHours();
  const pendingOptionHours = emptyHours();
  const rejectedOptionHours = emptyHours();

  for (const element of elements) {
    if (element.kind !== "LINE") continue;
    const statut = optionStatusForLine(element, itemsById, optionStatusByTarget);
    const quantityBucket = bucketForStatus(statut);
    const hoursBucket = hoursBucketForStatus(
      statut,
      plannedHours,
      pendingOptionHours,
      rejectedOptionHours,
    );

    for (const component of element.components ?? []) {
      const quantity = roundQuantity(element.quantity * component.quantity);
      const cle = componentKey(component);
      const courant = rowsByKey.get(cle) ?? {
        key: cle,
        name: componentName(component),
        unit: component.unit || component.librarySource?.component.unit || "u",
        activity: componentActivity(component),
        plannedQuantity: 0,
        pendingOptionQuantity: 0,
        rejectedOptionQuantity: 0,
        ouvrageCount: 0,
        ouvrageIds: new Set<string>(),
      };

      courant[quantityBucket] = roundQuantity(courant[quantityBucket] + quantity);
      courant.ouvrageIds.add(element.id);
      rowsByKey.set(cle, courant);

      const activity = componentActivity(component);
      if (activity === "BE") hoursBucket.be += quantity;
      if (activity === "ATELIER") hoursBucket.atelier += quantity;
    }
  }

  const adjustedPricing = calculateQuoteAdjustedPricing(elements, pricingConfig);
  for (const ligne of adjustedPricing.lines) {
    const hoursBucket = hoursBucketForStatus(
      ligne.optionStatus,
      plannedHours,
      pendingOptionHours,
      rejectedOptionHours,
    );
    hoursBucket.pose += ligne.poseHours;
  }

  const lignesTableau = Array.from(rowsByKey.values())
    .map(({ ouvrageIds, ...ligneTableau }) => ({ ...ligneTableau, ouvrageCount: ouvrageIds.size }))
    .sort((gauche, droite) =>
      gauche.name.localeCompare(droite.name, "fr", { sensitivity: "base" }),
    );

  return {
    rows: lignesTableau,
    plannedHours: finalizeHours(plannedHours),
    pendingOptionHours: finalizeHours(pendingOptionHours),
    rejectedOptionHours: finalizeHours(rejectedOptionHours),
  };
}

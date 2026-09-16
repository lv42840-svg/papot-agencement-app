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

function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeKeyPart(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
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
  line: QuoteLine,
  itemsById: ReadonlyMap<string, QuoteItem>,
  optionStatusByTarget: ReadonlyMap<string, QuoteOptionStatus>,
): QuoteOptionStatus | null {
  const direct = optionStatusByTarget.get(line.id);
  if (direct) return direct;
  if (!line.parentId) return null;

  const parent = itemsById.get(line.parentId);
  if (!parent) return null;
  const parentStatus = optionStatusByTarget.get(parent.id);
  if (parentStatus) return parentStatus;

  if (parent.kind === "SUBSECTION") {
    return optionStatusByTarget.get(parent.parentId) ?? null;
  }
  return null;
}

function bucketForStatus(status: QuoteOptionStatus | null): QuantityBucket {
  if (status === "PENDING") return "pendingOptionQuantity";
  if (status === "REJECTED") return "rejectedOptionQuantity";
  return "plannedQuantity";
}

function emptyHours(): QuoteHoursCheck {
  return { be: 0, atelier: 0, pose: 0, total: 0 };
}

function finalizeHours(hours: QuoteHoursCheck): QuoteHoursCheck {
  const be = roundQuantity(hours.be);
  const atelier = roundQuantity(hours.atelier);
  const pose = roundQuantity(hours.pose);
  return { be, atelier, pose, total: roundQuantity(be + atelier + pose) };
}

function hoursBucketForStatus(
  status: QuoteOptionStatus | null,
  planned: QuoteHoursCheck,
  pending: QuoteHoursCheck,
  rejected: QuoteHoursCheck,
): QuoteHoursCheck {
  if (status === "PENDING") return pending;
  if (status === "REJECTED") return rejected;
  return planned;
}

export function calculateQuoteComponentCheck(
  items: QuoteItem[],
  pricingConfig: QuotePricingConfig,
): QuoteComponentCheck {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const optionStatusByTarget = new Map(
    pricingConfig.options.map((option) => [option.targetItemId, option.status]),
  );
  const rowsByKey = new Map<string, MutableComponentRow>();
  const plannedHours = emptyHours();
  const pendingOptionHours = emptyHours();
  const rejectedOptionHours = emptyHours();

  for (const item of items) {
    if (item.kind !== "LINE") continue;
    const status = optionStatusForLine(item, itemsById, optionStatusByTarget);
    const quantityBucket = bucketForStatus(status);
    const hoursBucket = hoursBucketForStatus(
      status,
      plannedHours,
      pendingOptionHours,
      rejectedOptionHours,
    );

    for (const component of item.components ?? []) {
      const quantity = roundQuantity(item.quantity * component.quantity);
      const key = componentKey(component);
      const current = rowsByKey.get(key) ?? {
        key,
        name: componentName(component),
        unit: component.unit || component.librarySource?.component.unit || "u",
        activity: componentActivity(component),
        plannedQuantity: 0,
        pendingOptionQuantity: 0,
        rejectedOptionQuantity: 0,
        ouvrageCount: 0,
        ouvrageIds: new Set<string>(),
      };

      current[quantityBucket] = roundQuantity(current[quantityBucket] + quantity);
      current.ouvrageIds.add(item.id);
      rowsByKey.set(key, current);

      const activity = componentActivity(component);
      if (activity === "BE") hoursBucket.be += quantity;
      if (activity === "ATELIER") hoursBucket.atelier += quantity;
    }
  }

  const adjustedPricing = calculateQuoteAdjustedPricing(items, pricingConfig);
  for (const line of adjustedPricing.lines) {
    const hoursBucket = hoursBucketForStatus(
      line.optionStatus,
      plannedHours,
      pendingOptionHours,
      rejectedOptionHours,
    );
    hoursBucket.pose += line.poseHours;
  }

  const rows = Array.from(rowsByKey.values())
    .map(({ ouvrageIds, ...row }) => ({ ...row, ouvrageCount: ouvrageIds.size }))
    .sort((left, right) => left.name.localeCompare(right.name, "fr", { sensitivity: "base" }));

  return {
    rows,
    plannedHours: finalizeHours(plannedHours),
    pendingOptionHours: finalizeHours(pendingOptionHours),
    rejectedOptionHours: finalizeHours(rejectedOptionHours),
  };
}

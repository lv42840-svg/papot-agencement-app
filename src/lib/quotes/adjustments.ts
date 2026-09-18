import { z } from "zod";
import {
  calculateQuoteOuvrageUnitCostCents,
  quoteOuvrageComponentCostPriceCents,
  type QuoteItem,
  type QuoteLine,
  type QuoteOuvrageComponent,
} from "./model";

export const quoteAdjustmentMarginTreatmentSchema = z.enum(["MARGED", "PASS_THROUGH"]);
export const quoteOptionStatusSchema = z.enum(["PENDING", "RETAINED", "REJECTED"]);
export const quoteOptionTargetKindSchema = z.enum(["LINE", "SECTION", "SUBSECTION"]);

export const quoteCustomerDiscountValueSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("PERCENTAGE"),
    percent: z.number().finite().gt(0).lt(100),
  }),
  z.object({
    kind: z.literal("AMOUNT"),
    amountCents: z.number().int().safe().gt(0).max(1_000_000_000),
  }),
]);
export const quoteCustomerDiscountSchema = quoteCustomerDiscountValueSchema.nullable();

const adjustmentBaseSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(240),
  active: z.boolean(),
  applyToOptions: z.boolean(),
  marginTreatment: quoteAdjustmentMarginTreatmentSchema,
});

export const quotePercentageAdjustmentSchema = adjustmentBaseSchema.extend({
  kind: z.literal("PERCENTAGE"),
  percent: z.number().finite().gt(0).lt(100),
});

export const quotePoseHoursAdjustmentSchema = adjustmentBaseSchema.extend({
  kind: z.literal("POSE_HOURS"),
  hours: z.number().finite().gt(0).max(1_000_000),
});

export const quoteHotelAdjustmentSchema = adjustmentBaseSchema.extend({
  kind: z.literal("HOTEL"),
  applyToOptions: z.literal(false),
  nights: z.number().int().gt(0).max(10_000),
  pricePerNightCents: z.number().int().gt(0).max(100_000_000),
});

export const quotePricingAdjustmentSchema = z.discriminatedUnion("kind", [
  quotePercentageAdjustmentSchema,
  quotePoseHoursAdjustmentSchema,
  quoteHotelAdjustmentSchema,
]);

export const quoteOptionSchema = z.object({
  id: z.string().uuid(),
  targetItemId: z.string().uuid(),
  targetKind: quoteOptionTargetKindSchema,
  label: z.string().trim().min(1).max(240),
  status: quoteOptionStatusSchema,
});

export const quotePricingConfigSchema = z
  .object({
    adjustments: z.array(quotePricingAdjustmentSchema).max(100),
    options: z.array(quoteOptionSchema).max(500),
    customerDiscount: quoteCustomerDiscountSchema.optional(),
  })
  .superRefine((config, context) => {
    const adjustmentIds = new Set<string>();
    for (const adjustment of config.adjustments) {
      if (adjustmentIds.has(adjustment.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["adjustments"],
          message: "QUOTE_ADJUSTMENT_ID_DUPLICATE",
        });
      }
      adjustmentIds.add(adjustment.id);
    }

    const optionIds = new Set<string>();
    const optionTargets = new Set<string>();
    for (const option of config.options) {
      if (optionIds.has(option.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "QUOTE_OPTION_ID_DUPLICATE",
        });
      }
      if (optionTargets.has(option.targetItemId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "QUOTE_OPTION_TARGET_DUPLICATE",
        });
      }
      optionIds.add(option.id);
      optionTargets.add(option.targetItemId);
    }
  });

export type QuoteAdjustmentMarginTreatment = z.infer<typeof quoteAdjustmentMarginTreatmentSchema>;
export type QuotePricingAdjustment = z.infer<typeof quotePricingAdjustmentSchema>;
export type QuotePercentageAdjustment = z.infer<typeof quotePercentageAdjustmentSchema>;
export type QuotePoseHoursAdjustment = z.infer<typeof quotePoseHoursAdjustmentSchema>;
export type QuoteHotelAdjustment = z.infer<typeof quoteHotelAdjustmentSchema>;
export type QuoteOptionStatus = z.infer<typeof quoteOptionStatusSchema>;
export type QuoteOption = z.infer<typeof quoteOptionSchema>;
export type QuoteCustomerDiscount = z.infer<typeof quoteCustomerDiscountValueSchema>;
export type QuotePricingConfig = z.infer<typeof quotePricingConfigSchema>;

export function createEmptyQuotePricingConfig(): QuotePricingConfig {
  return { adjustments: [], options: [] };
}

export type QuoteAdjustedLine = {
  lineId: string;
  description: string;
  optionId: string | null;
  optionStatus: QuoteOptionStatus | null;
  baseSaleCents: number;
  saleCents: number;
  baseCostCents: number | null;
  costCents: number | null;
  basePoseHours: number;
  poseHours: number;
};

export type QuoteOptionPricingSummary = {
  id: string;
  label: string;
  status: QuoteOptionStatus;
  saleCents: number;
  poseHours: number;
};

export type QuoteAdjustedPricing = {
  lines: QuoteAdjustedLine[];
  grossSaleCents: number;
  customerDiscountCents: number;
  totalSaleCents: number;
  totalCostCents: number | null;
  marginAmountCents: number | null;
  marginPercent: number | null;
  totalPoseHours: number;
  pendingOptionsSaleCents: number;
  options: QuoteOptionPricingSummary[];
  warnings: string[];
};

type MutableLine = QuoteAdjustedLine & {
  line: QuoteLine;
  resolvedOption: QuoteOption | null;
  poseCostRateCents: number | null;
  poseSaleRateCents: number | null;
};

function assertSafeMoney(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("QUOTE_ADJUSTED_PRICING_MONEY_INVALID");
  }
  return value;
}

function lineAmountCents(quantity: number, unitAmountCents: number): number {
  return assertSafeMoney(Math.round(quantity * unitAmountCents));
}

function addMoney(left: number, right: number): number {
  return assertSafeMoney(left + right);
}

function subtractMoney(left: number, right: number): number {
  return assertSafeMoney(left - right);
}

function componentActivity(component: QuoteOuvrageComponent): "BE" | "ATELIER" | "POSE" | null {
  return component.activity ?? component.librarySource?.component.activity ?? null;
}

function linePoseProfile(line: QuoteLine): {
  hours: number;
  costRateCents: number | null;
  saleRateCents: number | null;
} {
  const poseComponents = (line.components ?? []).filter(
    (component) => componentActivity(component) === "POSE",
  );
  if (poseComponents.length === 0) {
    return { hours: 0, costRateCents: null, saleRateCents: null };
  }

  let hoursPerLineUnit = 0;
  let saleAmountPerLineUnit = 0;
  let costAmountPerLineUnit = 0;
  let costComplete = true;

  for (const component of poseComponents) {
    hoursPerLineUnit += component.quantity;
    saleAmountPerLineUnit += component.quantity * component.unitPriceCents;
    const costRate = quoteOuvrageComponentCostPriceCents(component);
    if (costRate === null) {
      costComplete = false;
    } else {
      costAmountPerLineUnit += component.quantity * costRate;
    }
  }

  if (!Number.isFinite(hoursPerLineUnit) || hoursPerLineUnit <= 0) {
    return { hours: 0, costRateCents: null, saleRateCents: null };
  }

  return {
    hours: Math.round(line.quantity * hoursPerLineUnit * 1_000_000) / 1_000_000,
    saleRateCents: saleAmountPerLineUnit / hoursPerLineUnit,
    costRateCents: costComplete ? costAmountPerLineUnit / hoursPerLineUnit : null,
  };
}

function optionForLine(
  line: QuoteLine,
  itemById: ReadonlyMap<string, QuoteItem>,
  optionByTarget: ReadonlyMap<string, QuoteOption>,
): QuoteOption | null {
  const direct = optionByTarget.get(line.id);
  if (direct) return direct;
  if (!line.parentId) return null;

  const parent = itemById.get(line.parentId);
  if (!parent) return null;
  const parentOption = optionByTarget.get(parent.id);
  if (parentOption) return parentOption;

  if (parent.kind === "SUBSECTION") {
    return optionByTarget.get(parent.parentId) ?? null;
  }
  return null;
}

function integerDistribution(
  total: number,
  entries: Array<{ lineId: string; weight: number }>,
): Map<string, number> {
  const result = new Map<string, number>();
  if (entries.length === 0 || total === 0) {
    for (const entry of entries) result.set(entry.lineId, 0);
    return result;
  }

  const safeWeights = entries.map((entry) => ({
    ...entry,
    weight: Number.isFinite(entry.weight) && entry.weight > 0 ? entry.weight : 0,
  }));
  const weightTotal = safeWeights.reduce((sum, entry) => sum + entry.weight, 0);
  const denominator = weightTotal > 0 ? weightTotal : safeWeights.length;
  const remainders: Array<{ lineId: string; remainder: number; index: number }> = [];
  let allocated = 0;

  safeWeights.forEach((entry, index) => {
    const weight = weightTotal > 0 ? entry.weight : 1;
    const exact = (total * weight) / denominator;
    const floor = Math.floor(exact);
    result.set(entry.lineId, floor);
    allocated += floor;
    remainders.push({ lineId: entry.lineId, remainder: exact - floor, index });
  });

  remainders.sort((left, right) => {
    if (right.remainder !== left.remainder) return right.remainder - left.remainder;
    return left.index - right.index;
  });

  let remaining = total - allocated;
  let cursor = 0;
  while (remaining > 0) {
    const target = remainders[cursor % remainders.length];
    result.set(target.lineId, (result.get(target.lineId) ?? 0) + 1);
    remaining -= 1;
    cursor += 1;
  }

  return result;
}

function moneyDistribution(
  totalCents: number,
  lines: MutableLine[],
  weight: (line: MutableLine) => number,
): Map<string, number> {
  return integerDistribution(
    totalCents,
    lines.map((line) => ({ lineId: line.lineId, weight: weight(line) })),
  );
}

function hoursDistribution(totalHours: number, lines: MutableLine[]): Map<string, number> {
  const factor = 1_000_000;
  const totalUnits = Math.round(totalHours * factor);
  const units = integerDistribution(
    totalUnits,
    lines.map((line) => ({ lineId: line.lineId, weight: line.basePoseHours })),
  );
  return new Map(Array.from(units, ([lineId, value]) => [lineId, value / factor]));
}

function applyMoneyToLines(
  lines: MutableLine[],
  totalSaleIncrementCents: number,
  totalCostIncrementCents: number,
  weights: (line: MutableLine) => number,
) {
  const saleDistribution = moneyDistribution(totalSaleIncrementCents, lines, weights);
  const costDistribution = moneyDistribution(totalCostIncrementCents, lines, weights);

  for (const line of lines) {
    line.saleCents = addMoney(line.saleCents, saleDistribution.get(line.lineId) ?? 0);
    if (line.costCents !== null) {
      line.costCents = addMoney(line.costCents, costDistribution.get(line.lineId) ?? 0);
    }
  }
}

function scopeSale(lines: MutableLine[]): number {
  return lines.reduce((total, line) => addMoney(total, line.saleCents), 0);
}

function applyPoseHoursAdjustment(
  lines: MutableLine[],
  adjustment: QuotePoseHoursAdjustment,
  warnings: string[],
  scopeLabel: string,
) {
  const eligible = lines.filter(
    (line) => line.basePoseHours > 0 && line.poseSaleRateCents !== null,
  );
  if (eligible.length === 0) {
    warnings.push(`QUOTE_POSE_HOURS_NO_BASE:${adjustment.id}:${scopeLabel}`);
    return;
  }

  const distributedHours = hoursDistribution(adjustment.hours, eligible);
  let zeroRateDetected = false;

  for (const line of eligible) {
    const addedHours = distributedHours.get(line.lineId) ?? 0;
    line.poseHours = Math.round((line.poseHours + addedHours) * 1_000_000) / 1_000_000;

    const costRate = line.poseCostRateCents;
    const costIncrement = costRate === null ? null : Math.round(addedHours * costRate);
    if (line.costCents !== null) {
      if (costIncrement === null) {
        line.costCents = null;
      } else {
        line.costCents = addMoney(line.costCents, assertSafeMoney(costIncrement));
      }
    }

    const saleRate =
      adjustment.marginTreatment === "PASS_THROUGH" ? costRate : line.poseSaleRateCents;
    if (saleRate === null) {
      warnings.push(`QUOTE_POSE_HOURS_COST_MISSING:${adjustment.id}:${line.lineId}`);
      continue;
    }
    if (saleRate === 0) zeroRateDetected = true;
    const saleIncrement = assertSafeMoney(Math.round(addedHours * saleRate));
    line.saleCents = addMoney(line.saleCents, saleIncrement);
  }

  if (zeroRateDetected) {
    warnings.push(`QUOTE_POSE_HOURS_ZERO_RATE:${adjustment.id}:${scopeLabel}`);
  }
}

function applyHotelAdjustment(
  lines: MutableLine[],
  adjustment: QuoteHotelAdjustment,
  warnings: string[],
  scopeLabel: string,
) {
  const eligible = lines.filter((line) => line.poseHours > 0);
  if (eligible.length === 0) {
    warnings.push(`QUOTE_HOTEL_NO_POSE_HOURS:${adjustment.id}:${scopeLabel}`);
    return;
  }

  const hotelCostCents = assertSafeMoney(adjustment.nights * adjustment.pricePerNightCents);
  const costDistribution = moneyDistribution(hotelCostCents, eligible, (line) => line.poseHours);

  for (const line of eligible) {
    const costIncrement = costDistribution.get(line.lineId) ?? 0;
    if (line.costCents !== null) {
      line.costCents = addMoney(line.costCents, costIncrement);
    }

    let saleIncrement = costIncrement;
    if (adjustment.marginTreatment === "MARGED") {
      const costRate = line.poseCostRateCents;
      const saleRate = line.poseSaleRateCents;
      if (costRate === null || saleRate === null || costRate <= 0 || saleRate <= 0) {
        warnings.push(`QUOTE_HOTEL_MARGIN_RATE_MISSING:${adjustment.id}:${line.lineId}`);
      } else {
        saleIncrement = assertSafeMoney(Math.round((costIncrement * saleRate) / costRate));
      }
    }

    line.saleCents = addMoney(line.saleCents, saleIncrement);
  }
}

function applyScopeAdjustments(
  lines: MutableLine[],
  adjustments: QuotePricingAdjustment[],
  isOption: boolean,
  warnings: string[],
  scopeLabel: string,
) {
  if (lines.length === 0) return;
  const applicable = adjustments.filter(
    (adjustment) => adjustment.active && (!isOption || adjustment.applyToOptions),
  );

  // Règle métier PAPOT : 1) heures de pose / trajet, 2) hôtel pondéré sur la pose,
  // 3) marge supplémentaire PAPOT, 4) commissions et autres pourcentages sans marge.
  for (const adjustment of applicable) {
    if (adjustment.kind !== "POSE_HOURS") continue;
    applyPoseHoursAdjustment(lines, adjustment, warnings, scopeLabel);
  }

  for (const adjustment of applicable) {
    if (adjustment.kind !== "HOTEL") continue;
    applyHotelAdjustment(lines, adjustment, warnings, scopeLabel);
  }

  const margedPercent = applicable.reduce((sum, adjustment) => {
    if (adjustment.kind !== "PERCENTAGE" || adjustment.marginTreatment !== "MARGED") {
      return sum;
    }
    return sum + adjustment.percent;
  }, 0);

  if (margedPercent > 0) {
    const currentSaleCents = scopeSale(lines);
    const incrementCents = assertSafeMoney(Math.round((currentSaleCents * margedPercent) / 100));
    applyMoneyToLines(lines, incrementCents, 0, (line) => line.saleCents);
  }

  const passThroughPercent = applicable.reduce((sum, adjustment) => {
    if (adjustment.kind !== "PERCENTAGE" || adjustment.marginTreatment !== "PASS_THROUGH") {
      return sum;
    }
    return sum + adjustment.percent;
  }, 0);

  if (passThroughPercent >= 100) {
    throw new Error("QUOTE_PASS_THROUGH_PERCENT_INVALID");
  }
  if (passThroughPercent > 0) {
    const currentSaleCents = scopeSale(lines);
    const targetSaleCents = assertSafeMoney(
      Math.round(currentSaleCents / (1 - passThroughPercent / 100)),
    );
    const incrementCents = targetSaleCents - currentSaleCents;
    applyMoneyToLines(lines, incrementCents, incrementCents, (line) => line.saleCents);
  }
}

function sumPoseHours(lines: MutableLine[]): number {
  return Math.round(lines.reduce((sum, line) => sum + line.poseHours, 0) * 1_000_000) / 1_000_000;
}

function marginPercent(saleCents: number, costCents: number): number | null {
  if (costCents === 0) return saleCents === 0 ? 0 : null;
  return ((saleCents - costCents) / costCents) * 100;
}

export function calculateQuoteAdjustedPricing(
  items: QuoteItem[],
  config: QuotePricingConfig = createEmptyQuotePricingConfig(),
): QuoteAdjustedPricing {
  const parsedConfig = quotePricingConfigSchema.parse(config);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const optionByTarget = new Map(
    parsedConfig.options.map((option) => [option.targetItemId, option]),
  );

  const lines: MutableLine[] = items
    .filter((item): item is QuoteLine => item.kind === "LINE")
    .map((line) => {
      const baseSaleCents = lineAmountCents(line.quantity, line.unitPriceCents ?? 0);
      const components = line.components ?? [];
      const unitCostCents =
        components.length > 0 ? calculateQuoteOuvrageUnitCostCents(components) : null;
      const baseCostCents =
        unitCostCents === null ? null : lineAmountCents(line.quantity, unitCostCents);
      const resolvedOption = optionForLine(line, itemById, optionByTarget);
      const poseProfile = linePoseProfile(line);
      return {
        line,
        lineId: line.id,
        description: line.description,
        resolvedOption,
        optionId: resolvedOption?.id ?? null,
        optionStatus: resolvedOption?.status ?? null,
        baseSaleCents,
        saleCents: baseSaleCents,
        baseCostCents,
        costCents: baseCostCents,
        basePoseHours: poseProfile.hours,
        poseHours: poseProfile.hours,
        poseCostRateCents: poseProfile.costRateCents,
        poseSaleRateCents: poseProfile.saleRateCents,
      };
    });

  const warnings: string[] = [];
  const mainBaseLines = lines.filter((line) => !line.resolvedOption);
  applyScopeAdjustments(mainBaseLines, parsedConfig.adjustments, false, warnings, "MAIN");

  for (const option of parsedConfig.options) {
    const optionLines = lines.filter((line) => line.resolvedOption?.id === option.id);
    applyScopeAdjustments(optionLines, parsedConfig.adjustments, true, warnings, option.id);
  }

  const retainedOptionIds = new Set(
    parsedConfig.options
      .filter((option) => option.status === "RETAINED")
      .map((option) => option.id),
  );
  const mainLines = lines.filter(
    (line) => !line.resolvedOption || retainedOptionIds.has(line.resolvedOption.id),
  );

  const grossSaleCents = scopeSale(mainLines);
  let customerDiscountCents = 0;
  const customerDiscount = parsedConfig.customerDiscount;
  if (customerDiscount) {
    customerDiscountCents =
      customerDiscount.kind === "PERCENTAGE"
        ? Math.round((grossSaleCents * customerDiscount.percent) / 100)
        : customerDiscount.amountCents;
    if (customerDiscountCents > grossSaleCents) {
      throw new Error("QUOTE_CUSTOMER_DISCOUNT_TOO_HIGH");
    }
    const discountDistribution = moneyDistribution(
      customerDiscountCents,
      mainLines,
      (line) => line.saleCents,
    );
    for (const line of mainLines) {
      line.saleCents = subtractMoney(line.saleCents, discountDistribution.get(line.lineId) ?? 0);
    }
  }

  const totalSaleCents = scopeSale(mainLines);
  const costComplete = mainLines.every((line) => line.costCents !== null);
  const totalCostCents = costComplete
    ? mainLines.reduce((total, line) => addMoney(total, line.costCents ?? 0), 0)
    : null;
  const marginAmountCents = totalCostCents === null ? null : totalSaleCents - totalCostCents;

  const optionSummaries = parsedConfig.options.map((option) => {
    const optionLines = lines.filter((line) => line.resolvedOption?.id === option.id);
    return {
      id: option.id,
      label: option.label,
      status: option.status,
      saleCents: optionLines.reduce((total, line) => addMoney(total, line.saleCents), 0),
      poseHours: sumPoseHours(optionLines),
    };
  });
  const pendingOptionsSaleCents = optionSummaries
    .filter((option) => option.status === "PENDING")
    .reduce((total, option) => addMoney(total, option.saleCents), 0);

  return {
    grossSaleCents,
    customerDiscountCents,
    lines: lines.map(
      ({
        line: _line,
        resolvedOption: _resolvedOption,
        poseCostRateCents: _poseCostRateCents,
        poseSaleRateCents: _poseSaleRateCents,
        ...line
      }) => line,
    ),
    totalSaleCents,
    totalCostCents,
    marginAmountCents,
    marginPercent: totalCostCents === null ? null : marginPercent(totalSaleCents, totalCostCents),
    totalPoseHours: sumPoseHours(mainLines),
    pendingOptionsSaleCents,
    options: optionSummaries,
    warnings,
  };
}

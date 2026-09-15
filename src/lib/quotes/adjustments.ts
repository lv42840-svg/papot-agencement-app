import { z } from "zod";
import { calculateQuoteOuvrageUnitCostCents, type QuoteItem, type QuoteLine } from "./model";
import { calculateQuoteSalePriceFromMarginCents } from "./pricing";

export const quoteAdjustmentMarginTreatmentSchema = z.enum(["MARGED", "PASS_THROUGH"]);
export const quoteOptionStatusSchema = z.enum(["PENDING", "RETAINED", "REJECTED"]);
export const quoteOptionTargetKindSchema = z.enum(["LINE", "SECTION", "SUBSECTION"]);

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
  costRateCents: z.number().int().safe().min(0),
  marginPercent: z.number().finite().min(-100).max(10_000),
});

export const quotePricingAdjustmentSchema = z.discriminatedUnion("kind", [
  quotePercentageAdjustmentSchema,
  quotePoseHoursAdjustmentSchema,
]);

export const quoteOptionSchema = z.object({
  id: z.string().uuid(),
  targetItemId: z.string().uuid(),
  targetKind: quoteOptionTargetKindSchema,
  label: z.string().trim().min(1).max(240),
  status: quoteOptionStatusSchema,
});

export const quoteLinePoseHoursSchema = z.object({
  lineId: z.string().uuid(),
  hours: z.number().finite().min(0).max(1_000_000),
});

export const quotePricingConfigSchema = z
  .object({
    adjustments: z.array(quotePricingAdjustmentSchema).max(100),
    options: z.array(quoteOptionSchema).max(500),
    linePoseHours: z.array(quoteLinePoseHoursSchema).max(1000),
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

    const poseLines = new Set<string>();
    for (const entry of config.linePoseHours) {
      if (poseLines.has(entry.lineId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["linePoseHours"],
          message: "QUOTE_POSE_HOURS_LINE_DUPLICATE",
        });
      }
      poseLines.add(entry.lineId);
    }
  });

export type QuoteAdjustmentMarginTreatment = z.infer<typeof quoteAdjustmentMarginTreatmentSchema>;
export type QuotePricingAdjustment = z.infer<typeof quotePricingAdjustmentSchema>;
export type QuotePercentageAdjustment = z.infer<typeof quotePercentageAdjustmentSchema>;
export type QuotePoseHoursAdjustment = z.infer<typeof quotePoseHoursAdjustmentSchema>;
export type QuoteOptionStatus = z.infer<typeof quoteOptionStatusSchema>;
export type QuoteOption = z.infer<typeof quoteOptionSchema>;
export type QuotePricingConfig = z.infer<typeof quotePricingConfigSchema>;

export function createEmptyQuotePricingConfig(): QuotePricingConfig {
  return { adjustments: [], options: [], linePoseHours: [] };
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

  const baseSaleCents = lines.reduce((total, line) => addMoney(total, line.baseSaleCents), 0);

  for (const adjustment of applicable) {
    if (adjustment.kind !== "PERCENTAGE" || adjustment.marginTreatment !== "MARGED") continue;
    const incrementCents = assertSafeMoney(Math.round((baseSaleCents * adjustment.percent) / 100));
    applyMoneyToLines(lines, incrementCents, 0, (line) => line.baseSaleCents);
  }

  for (const adjustment of applicable) {
    if (adjustment.kind !== "POSE_HOURS") continue;
    const eligible = lines.filter((line) => line.basePoseHours > 0);
    if (eligible.length === 0) {
      warnings.push(`QUOTE_POSE_HOURS_NO_BASE:${adjustment.id}:${scopeLabel}`);
      continue;
    }

    const distributedHours = hoursDistribution(adjustment.hours, eligible);
    for (const line of eligible) {
      line.poseHours += distributedHours.get(line.lineId) ?? 0;
    }

    const totalCostIncrementCents = assertSafeMoney(
      Math.round(adjustment.hours * adjustment.costRateCents),
    );
    const saleRateCents =
      adjustment.marginTreatment === "PASS_THROUGH"
        ? adjustment.costRateCents
        : calculateQuoteSalePriceFromMarginCents(
            adjustment.costRateCents,
            adjustment.marginPercent,
          );
    const totalSaleIncrementCents = assertSafeMoney(Math.round(adjustment.hours * saleRateCents));
    applyMoneyToLines(
      eligible,
      totalSaleIncrementCents,
      totalCostIncrementCents,
      (line) => distributedHours.get(line.lineId) ?? 0,
    );
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
  const poseByLine = new Map(
    parsedConfig.linePoseHours.map((entry) => [entry.lineId, entry.hours]),
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
      const basePoseHours = poseByLine.get(line.id) ?? 0;
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
        basePoseHours,
        poseHours: basePoseHours,
      };
    });

  const warnings: string[] = [];
  const mainLines = lines.filter(
    (line) => !line.resolvedOption || line.resolvedOption.status === "RETAINED",
  );
  applyScopeAdjustments(mainLines, parsedConfig.adjustments, false, warnings, "MAIN");

  for (const option of parsedConfig.options) {
    if (option.status === "RETAINED") continue;
    const optionLines = lines.filter((line) => line.resolvedOption?.id === option.id);
    applyScopeAdjustments(optionLines, parsedConfig.adjustments, true, warnings, option.id);
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
    lines: lines.map(({ line: _line, resolvedOption: _resolvedOption, ...line }) => line),
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

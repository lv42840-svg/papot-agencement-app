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
  .superRefine((configuration, contexte) => {
    const adjustmentIds = new Set<string>();
    for (const adjustment of configuration.adjustments) {
      if (adjustmentIds.has(adjustment.id)) {
        contexte.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["adjustments"],
          message: "QUOTE_ADJUSTMENT_ID_DUPLICATE",
        });
      }
      adjustmentIds.add(adjustment.id);
    }

    const optionIds = new Set<string>();
    const optionTargets = new Set<string>();
    for (const option of configuration.options) {
      if (optionIds.has(option.id)) {
        contexte.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "QUOTE_OPTION_ID_DUPLICATE",
        });
      }
      if (optionTargets.has(option.targetItemId)) {
        contexte.addIssue({
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

function assertSafeMoney(valeur: number): number {
  if (!Number.isSafeInteger(valeur) || valeur < 0) {
    throw new Error("QUOTE_ADJUSTED_PRICING_MONEY_INVALID");
  }
  return valeur;
}

function lineAmountCents(quantity: number, unitAmountCents: number): number {
  return assertSafeMoney(Math.round(quantity * unitAmountCents));
}

function addMoney(gauche: number, droite: number): number {
  return assertSafeMoney(gauche + droite);
}

function subtractMoney(gauche: number, droite: number): number {
  return assertSafeMoney(gauche - droite);
}

function componentActivity(component: QuoteOuvrageComponent): "BE" | "ATELIER" | "POSE" | null {
  return component.activity ?? component.librarySource?.component.activity ?? null;
}

function linePoseProfile(ligne: QuoteLine): {
  hours: number;
  costRateCents: number | null;
  saleRateCents: number | null;
} {
  const poseComponents = (ligne.components ?? []).filter(
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
    hours: Math.round(ligne.quantity * hoursPerLineUnit * 1_000_000) / 1_000_000,
    saleRateCents: saleAmountPerLineUnit / hoursPerLineUnit,
    costRateCents: costComplete ? costAmountPerLineUnit / hoursPerLineUnit : null,
  };
}

function optionForLine(
  ligne: QuoteLine,
  itemById: ReadonlyMap<string, QuoteItem>,
  optionByTarget: ReadonlyMap<string, QuoteOption>,
): QuoteOption | null {
  const direct = optionByTarget.get(ligne.id);
  if (direct) return direct;
  if (!ligne.parentId) return null;

  const parent = itemById.get(ligne.parentId);
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
  entrees: Array<{ lineId: string; weight: number }>,
): Map<string, number> {
  const resultat = new Map<string, number>();
  if (entrees.length === 0 || total === 0) {
    for (const entree of entrees) resultat.set(entree.lineId, 0);
    return resultat;
  }

  const safeWeights = entrees.map((entree) => ({
    ...entree,
    weight: Number.isFinite(entree.weight) && entree.weight > 0 ? entree.weight : 0,
  }));
  const weightTotal = safeWeights.reduce((somme, entree) => somme + entree.weight, 0);
  const denominator = weightTotal > 0 ? weightTotal : safeWeights.length;
  const remainders: Array<{ lineId: string; remainder: number; index: number }> = [];
  let allocated = 0;

  safeWeights.forEach((entree, indice) => {
    const weight = weightTotal > 0 ? entree.weight : 1;
    const exact = (total * weight) / denominator;
    const floor = Math.floor(exact);
    resultat.set(entree.lineId, floor);
    allocated += floor;
    remainders.push({ lineId: entree.lineId, remainder: exact - floor, index: indice });
  });

  remainders.sort((gauche, droite) => {
    if (droite.remainder !== gauche.remainder) return droite.remainder - gauche.remainder;
    return gauche.index - droite.index;
  });

  let remaining = total - allocated;
  let cursor = 0;
  while (remaining > 0) {
    const cible = remainders[cursor % remainders.length];
    resultat.set(cible.lineId, (resultat.get(cible.lineId) ?? 0) + 1);
    remaining -= 1;
    cursor += 1;
  }

  return resultat;
}

function moneyDistribution(
  totalCents: number,
  lignes: MutableLine[],
  weight: (ligne: MutableLine) => number,
): Map<string, number> {
  return integerDistribution(
    totalCents,
    lignes.map((ligne) => ({ lineId: ligne.lineId, weight: weight(ligne) })),
  );
}

function hoursDistribution(totalHours: number, lignes: MutableLine[]): Map<string, number> {
  const factor = 1_000_000;
  const totalUnits = Math.round(totalHours * factor);
  const units = integerDistribution(
    totalUnits,
    lignes.map((ligne) => ({ lineId: ligne.lineId, weight: ligne.basePoseHours })),
  );
  return new Map(Array.from(units, ([lineId, valeur]) => [lineId, valeur / factor]));
}

function applyMoneyToLines(
  lignes: MutableLine[],
  totalSaleIncrementCents: number,
  totalCostIncrementCents: number,
  weights: (ligne: MutableLine) => number,
) {
  const saleDistribution = moneyDistribution(totalSaleIncrementCents, lignes, weights);
  const costDistribution = moneyDistribution(totalCostIncrementCents, lignes, weights);

  for (const ligne of lignes) {
    ligne.saleCents = addMoney(ligne.saleCents, saleDistribution.get(ligne.lineId) ?? 0);
    if (ligne.costCents !== null) {
      ligne.costCents = addMoney(ligne.costCents, costDistribution.get(ligne.lineId) ?? 0);
    }
  }
}

function scopeSale(lignes: MutableLine[]): number {
  return lignes.reduce((total, ligne) => addMoney(total, ligne.saleCents), 0);
}

function applyPoseHoursAdjustment(
  lignes: MutableLine[],
  adjustment: QuotePoseHoursAdjustment,
  warnings: string[],
  scopeLabel: string,
) {
  const eligible = lignes.filter(
    (ligne) => ligne.basePoseHours > 0 && ligne.poseSaleRateCents !== null,
  );
  if (eligible.length === 0) {
    warnings.push(`QUOTE_POSE_HOURS_NO_BASE:${adjustment.id}:${scopeLabel}`);
    return;
  }

  const distributedHours = hoursDistribution(adjustment.hours, eligible);
  let zeroRateDetected = false;

  for (const ligne of eligible) {
    const addedHours = distributedHours.get(ligne.lineId) ?? 0;
    ligne.poseHours = Math.round((ligne.poseHours + addedHours) * 1_000_000) / 1_000_000;

    const costRate = ligne.poseCostRateCents;
    const costIncrement = costRate === null ? null : Math.round(addedHours * costRate);
    if (ligne.costCents !== null) {
      if (costIncrement === null) {
        ligne.costCents = null;
      } else {
        ligne.costCents = addMoney(ligne.costCents, assertSafeMoney(costIncrement));
      }
    }

    const saleRate =
      adjustment.marginTreatment === "PASS_THROUGH" ? costRate : ligne.poseSaleRateCents;
    if (saleRate === null) {
      warnings.push(`QUOTE_POSE_HOURS_COST_MISSING:${adjustment.id}:${ligne.lineId}`);
      continue;
    }
    if (saleRate === 0) zeroRateDetected = true;
    const saleIncrement = assertSafeMoney(Math.round(addedHours * saleRate));
    ligne.saleCents = addMoney(ligne.saleCents, saleIncrement);
  }

  if (zeroRateDetected) {
    warnings.push(`QUOTE_POSE_HOURS_ZERO_RATE:${adjustment.id}:${scopeLabel}`);
  }
}

function applyHotelAdjustment(
  lignes: MutableLine[],
  adjustment: QuoteHotelAdjustment,
  warnings: string[],
  scopeLabel: string,
) {
  const eligible = lignes.filter((ligne) => ligne.poseHours > 0);
  if (eligible.length === 0) {
    warnings.push(`QUOTE_HOTEL_NO_POSE_HOURS:${adjustment.id}:${scopeLabel}`);
    return;
  }

  const hotelCostCents = assertSafeMoney(adjustment.nights * adjustment.pricePerNightCents);
  const costDistribution = moneyDistribution(hotelCostCents, eligible, (ligne) => ligne.poseHours);

  for (const ligne of eligible) {
    const costIncrement = costDistribution.get(ligne.lineId) ?? 0;
    if (ligne.costCents !== null) {
      ligne.costCents = addMoney(ligne.costCents, costIncrement);
    }

    let saleIncrement = costIncrement;
    if (adjustment.marginTreatment === "MARGED") {
      const costRate = ligne.poseCostRateCents;
      const saleRate = ligne.poseSaleRateCents;
      if (costRate === null || saleRate === null || costRate <= 0 || saleRate <= 0) {
        warnings.push(`QUOTE_HOTEL_MARGIN_RATE_MISSING:${adjustment.id}:${ligne.lineId}`);
      } else {
        saleIncrement = assertSafeMoney(Math.round((costIncrement * saleRate) / costRate));
      }
    }

    ligne.saleCents = addMoney(ligne.saleCents, saleIncrement);
  }
}

function applyScopeAdjustments(
  lignes: MutableLine[],
  adjustments: QuotePricingAdjustment[],
  isOption: boolean,
  warnings: string[],
  scopeLabel: string,
) {
  if (lignes.length === 0) return;
  const applicable = adjustments.filter(
    (adjustment) => adjustment.active && (!isOption || adjustment.applyToOptions),
  );

  // Règle métier PAPOT : 1) heures de pose / trajet, 2) hôtel pondéré sur la pose,
  // 3) marge supplémentaire PAPOT, 4) commissions et autres pourcentages sans marge.
  for (const adjustment of applicable) {
    if (adjustment.kind !== "POSE_HOURS") continue;
    applyPoseHoursAdjustment(lignes, adjustment, warnings, scopeLabel);
  }

  for (const adjustment of applicable) {
    if (adjustment.kind !== "HOTEL") continue;
    applyHotelAdjustment(lignes, adjustment, warnings, scopeLabel);
  }

  const margedPercent = applicable.reduce((somme, adjustment) => {
    if (adjustment.kind !== "PERCENTAGE" || adjustment.marginTreatment !== "MARGED") {
      return somme;
    }
    return somme + adjustment.percent;
  }, 0);

  if (margedPercent > 0) {
    const currentSaleCents = scopeSale(lignes);
    const incrementCents = assertSafeMoney(Math.round((currentSaleCents * margedPercent) / 100));
    applyMoneyToLines(lignes, incrementCents, 0, (ligne) => ligne.saleCents);
  }

  const passThroughPercent = applicable.reduce((somme, adjustment) => {
    if (adjustment.kind !== "PERCENTAGE" || adjustment.marginTreatment !== "PASS_THROUGH") {
      return somme;
    }
    return somme + adjustment.percent;
  }, 0);

  if (passThroughPercent >= 100) {
    throw new Error("QUOTE_PASS_THROUGH_PERCENT_INVALID");
  }
  if (passThroughPercent > 0) {
    const currentSaleCents = scopeSale(lignes);
    const targetSaleCents = assertSafeMoney(
      Math.round(currentSaleCents / (1 - passThroughPercent / 100)),
    );
    const incrementCents = targetSaleCents - currentSaleCents;
    applyMoneyToLines(lignes, incrementCents, incrementCents, (ligne) => ligne.saleCents);
  }
}

function sumPoseHours(lignes: MutableLine[]): number {
  return (
    Math.round(lignes.reduce((somme, ligne) => somme + ligne.poseHours, 0) * 1_000_000) / 1_000_000
  );
}

function marginPercent(saleCents: number, costCents: number): number | null {
  if (costCents === 0) return saleCents === 0 ? 0 : null;
  return ((saleCents - costCents) / costCents) * 100;
}

export function calculateQuoteAdjustedPricing(
  elements: QuoteItem[],
  configuration: QuotePricingConfig = createEmptyQuotePricingConfig(),
): QuoteAdjustedPricing {
  const parsedConfig = quotePricingConfigSchema.parse(configuration);
  const itemById = new Map(elements.map((element) => [element.id, element]));
  const optionByTarget = new Map(
    parsedConfig.options.map((option) => [option.targetItemId, option]),
  );

  const lignes: MutableLine[] = elements
    .filter((element): element is QuoteLine => element.kind === "LINE")
    .map((ligne) => {
      const baseSaleCents = lineAmountCents(ligne.quantity, ligne.unitPriceCents ?? 0);
      const components = ligne.components ?? [];
      const unitCostCents =
        components.length > 0 ? calculateQuoteOuvrageUnitCostCents(components) : null;
      const baseCostCents =
        unitCostCents === null ? null : lineAmountCents(ligne.quantity, unitCostCents);
      const resolvedOption = optionForLine(ligne, itemById, optionByTarget);
      const poseProfile = linePoseProfile(ligne);
      return {
        line: ligne,
        lineId: ligne.id,
        description: ligne.description,
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
  const mainBaseLines = lignes.filter((ligne) => !ligne.resolvedOption);
  applyScopeAdjustments(mainBaseLines, parsedConfig.adjustments, false, warnings, "MAIN");

  for (const option of parsedConfig.options) {
    const optionLines = lignes.filter((ligne) => ligne.resolvedOption?.id === option.id);
    applyScopeAdjustments(optionLines, parsedConfig.adjustments, true, warnings, option.id);
  }

  const retainedOptionIds = new Set(
    parsedConfig.options
      .filter((option) => option.status === "RETAINED")
      .map((option) => option.id),
  );
  const mainLines = lignes.filter(
    (ligne) => !ligne.resolvedOption || retainedOptionIds.has(ligne.resolvedOption.id),
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
      (ligne) => ligne.saleCents,
    );
    for (const ligne of mainLines) {
      ligne.saleCents = subtractMoney(ligne.saleCents, discountDistribution.get(ligne.lineId) ?? 0);
    }
  }

  const totalSaleCents = scopeSale(mainLines);
  const costComplete = mainLines.every((ligne) => ligne.costCents !== null);
  const totalCostCents = costComplete
    ? mainLines.reduce((total, ligne) => addMoney(total, ligne.costCents ?? 0), 0)
    : null;
  const marginAmountCents = totalCostCents === null ? null : totalSaleCents - totalCostCents;

  const optionSummaries = parsedConfig.options.map((option) => {
    const optionLines = lignes.filter((ligne) => ligne.resolvedOption?.id === option.id);
    return {
      id: option.id,
      label: option.label,
      status: option.status,
      saleCents: optionLines.reduce((total, ligne) => addMoney(total, ligne.saleCents), 0),
      poseHours: sumPoseHours(optionLines),
    };
  });
  const pendingOptionsSaleCents = optionSummaries
    .filter((option) => option.status === "PENDING")
    .reduce((total, option) => addMoney(total, option.saleCents), 0);

  return {
    grossSaleCents,
    customerDiscountCents,
    lines: lignes.map(
      ({
        line: _line,
        resolvedOption: _resolvedOption,
        poseCostRateCents: _poseCostRateCents,
        poseSaleRateCents: _poseSaleRateCents,
        ...ligne
      }) => ligne,
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

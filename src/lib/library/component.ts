import { z } from "zod";
import { productionActivitySchema } from "../production-activity";

const priceCentsSchema = z.number().int().safe().min(0);
const marginPercentSchema = z.number().finite().min(0);

export const libraryComponentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4000),
  unit: z.string().trim().min(1).max(40),
  costPriceCents: priceCentsSchema,
  marginPercent: marginPercentSchema,
  salePriceCents: priceCentsSchema,
  activity: productionActivitySchema.optional(),
});

export type LibraryComponent = z.infer<typeof libraryComponentSchema>;

function parsePriceCents(value: number): number {
  const parsed = priceCentsSchema.safeParse(value);
  if (!parsed.success) throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");
  return parsed.data;
}

function parseMarginPercent(value: number): number {
  const parsed = marginPercentSchema.safeParse(value);
  if (!parsed.success) throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");
  return parsed.data;
}

export function calculateLibraryComponentSalePriceCents(
  costPriceCents: number,
  marginPercent: number,
): number {
  const cost = parsePriceCents(costPriceCents);
  const margin = parseMarginPercent(marginPercent);
  const salePriceCents = Math.round(cost * (1 + margin / 100));

  if (!Number.isSafeInteger(salePriceCents)) {
    throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");
  }

  return salePriceCents;
}

export function calculateLibraryComponentMarginPercent(
  costPriceCents: number,
  salePriceCents: number,
): number {
  const cost = parsePriceCents(costPriceCents);
  const salePrice = parsePriceCents(salePriceCents);

  if (salePrice < cost) throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");
  if (cost === 0) {
    if (salePrice === 0) return 0;
    throw new Error("LIBRARY_COMPONENT_MARGIN_UNDEFINED");
  }

  return ((salePrice - cost) / cost) * 100;
}

export function parseLibraryComponent(value: unknown): LibraryComponent {
  const parsed = libraryComponentSchema.safeParse(value);
  if (!parsed.success) throw new Error("LIBRARY_COMPONENT_INVALID");

  const expectedSalePriceCents = calculateLibraryComponentSalePriceCents(
    parsed.data.costPriceCents,
    parsed.data.marginPercent,
  );
  if (expectedSalePriceCents !== parsed.data.salePriceCents) {
    throw new Error("LIBRARY_COMPONENT_PRICING_MISMATCH");
  }

  return parsed.data;
}

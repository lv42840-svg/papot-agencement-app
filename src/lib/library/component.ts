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

function parsePriceCents(valeur: number): number {
  const analyse = priceCentsSchema.safeParse(valeur);
  if (!analyse.success) {
    throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");
  }
  return analyse.data;
}

function parseMarginPercent(valeur: number): number {
  const analyse = marginPercentSchema.safeParse(valeur);
  if (!analyse.success) {
    throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");
  }
  return analyse.data;
}

export function calculateLibraryComponentSalePriceCents(
  prixRevientCentimes: number,
  margePourcent: number,
): number {
  const cout = parsePriceCents(prixRevientCentimes);
  const marge = parseMarginPercent(margePourcent);
  const prixVenteCentimes = Math.round(cout * (1 + marge / 100));

  if (!Number.isSafeInteger(prixVenteCentimes)) {
    throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");
  }

  return prixVenteCentimes;
}

export function calculateLibraryComponentMarginPercent(
  prixRevientCentimes: number,
  prixVenteCentimes: number,
): number {
  const cout = parsePriceCents(prixRevientCentimes);
  const prixVente = parsePriceCents(prixVenteCentimes);

  if (prixVente < cout) {
    throw new Error("LIBRARY_COMPONENT_PRICING_INVALID");
  }
  if (cout === 0) {
    if (prixVente === 0) return 0;
    throw new Error("LIBRARY_COMPONENT_MARGIN_UNDEFINED");
  }

  return ((prixVente - cout) / cout) * 100;
}

export function parseLibraryComponent(valeur: unknown): LibraryComponent {
  const analyse = libraryComponentSchema.safeParse(valeur);
  if (!analyse.success) throw new Error("LIBRARY_COMPONENT_INVALID");

  const prixVenteAttenduCentimes = calculateLibraryComponentSalePriceCents(
    analyse.data.costPriceCents,
    analyse.data.marginPercent,
  );
  if (prixVenteAttenduCentimes !== analyse.data.salePriceCents) {
    throw new Error("LIBRARY_COMPONENT_PRICING_MISMATCH");
  }

  return analyse.data;
}

import { z } from "zod";

export const libraryComponentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4000),
  unit: z.string().trim().min(1).max(40),
  unitPriceCents: z.number().int().safe().min(0),
  vatRatePercent: z.number().finite().min(0).max(100),
});

export type LibraryComponent = z.infer<typeof libraryComponentSchema>;

export function parseLibraryComponent(value: unknown): LibraryComponent {
  const parsed = libraryComponentSchema.safeParse(value);
  if (!parsed.success) throw new Error("LIBRARY_COMPONENT_INVALID");
  return parsed.data;
}

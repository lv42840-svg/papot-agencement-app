import { z } from "zod";

export const libraryOuvrageComponentLineSchema = z.object({
  id: z.string().uuid(),
  componentId: z.string().uuid(),
  quantity: z.number().finite().positive(),
});

export const libraryOuvrageSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(240),
  description: z.string().trim().max(4000),
  components: z.array(libraryOuvrageComponentLineSchema).min(1),
});

export type LibraryOuvrageComponentLine = z.infer<typeof libraryOuvrageComponentLineSchema>;
export type LibraryOuvrage = z.infer<typeof libraryOuvrageSchema>;

export function parseLibraryOuvrage(value: unknown): LibraryOuvrage {
  const parsed = libraryOuvrageSchema.safeParse(value);
  if (!parsed.success) throw new Error("LIBRARY_OUVRAGE_INVALID");

  const lineIds = new Set<string>();
  for (const line of parsed.data.components) {
    if (lineIds.has(line.id)) throw new Error("LIBRARY_OUVRAGE_LINE_ID_DUPLICATE");
    lineIds.add(line.id);
  }

  return parsed.data;
}

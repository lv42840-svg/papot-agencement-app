import { z } from "zod";
export const editHistorySchema = z.object({
  revision: z.number().int().positive(),
  key: z.string(),
  at: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});
export function assertEditRevision(expected: unknown, actual: number): void {
  if (!Number.isSafeInteger(expected) || expected !== actual)
    throw new Error("EDIT_VERSION_CONFLICT");
}
export const EDIT_CONFLICT_MESSAGE =
  "Cette ligne a été modifiée par un autre utilisateur. Rechargez les données avant de corriger à nouveau. Votre saisie n’a pas été enregistrée.";

import { z } from "zod";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const chantierStatusSchema = z.enum(["ACTIVE", "DONE", "ARCHIVED"]);
export const launchDocumentStateSchema = z.enum(["PRESENT", "MISSING_DECLARED"]);

export const chantierHoursSchema = z.object({
  be: z.number().nonnegative(),
  workshop: z.number().nonnegative(),
  install: z.number().nonnegative(),
});

export const chantierHistoryEventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "LAUNCHED",
    "DETAILS_UPDATED",
    "PLANNED_HOURS_UPDATED",
    "MARKED_DONE",
    "REACTIVATED",
    "ARCHIVED",
    "UNARCHIVED",
  ]),
  at: isoDateTimeSchema,
  actorName: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1500),
});

export const chantierRecordSchema = z.object({
  id: z.string().uuid(),
  sourceCommercialCaseId: z.string().uuid(),
  sourceEntryId: z.string().uuid().nullable(),
  number: nullableText(80),
  reference: nullableText(160),
  name: z.string().trim().min(1).max(240),
  clientName: nullableText(240),
  companyName: nullableText(240),
  siteLabel: nullableText(240),
  contactName: nullableText(160),
  contactPhone: nullableText(80),
  contactEmail: nullableText(240),
  description: nullableText(4000),
  nextAction: nullableText(2000),
  status: chantierStatusSchema,
  plannedInstallDate: dateOnlySchema,
  launchYear: z.number().int().min(2020).max(2100),
  launchDocuments: z.object({
    quote: launchDocumentStateSchema,
    signedQuote: launchDocumentStateSchema,
    costing: launchDocumentStateSchema,
  }),
  signedQuoteReminder: z.boolean(),
  plannedHours: chantierHoursSchema,
  actualHours: chantierHoursSchema,
  launchedAt: isoDateTimeSchema,
  launchedByName: z.string().trim().min(1).max(120),
  completedAt: isoDateTimeSchema.nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  updatedByName: z.string().trim().min(1).max(120),
  history: z.array(chantierHistoryEventSchema),
});

export const chantiersPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  chantiers: z.array(chantierRecordSchema),
});

export type ChantierStatus = z.infer<typeof chantierStatusSchema>;
export type ChantierHours = z.infer<typeof chantierHoursSchema>;
export type ChantierHistoryEvent = z.infer<typeof chantierHistoryEventSchema>;
export type ChantierRecord = z.infer<typeof chantierRecordSchema>;
export type ChantiersPayload = z.infer<typeof chantiersPayloadSchema>;

export const CHANTIER_STATUS_LABELS: Record<ChantierStatus, string> = {
  ACTIVE: "Actif",
  DONE: "Terminé",
  ARCHIVED: "Archivé",
};

export const CHANTIER_OPERATIONAL_SPACES = [
  { id: "admin", label: "Admin" },
  { id: "be", label: "BE" },
  { id: "workshop", label: "Atelier" },
  { id: "install", label: "Pose" },
  { id: "meeting", label: "Réunion de chantier" },
  { id: "mail", label: "Mail" },
  { id: "reception", label: "Réception" },
] as const;

export function createInitialChantiersPayload(): ChantiersPayload {
  return { schemaVersion: 1, chantiers: [] };
}

export function parseChantiersPayload(value: unknown): ChantiersPayload {
  if (value == null) return createInitialChantiersPayload();
  return chantiersPayloadSchema.parse(value);
}

export function chantierRemainingHours(item: ChantierRecord): ChantierHours {
  return {
    be: item.plannedHours.be - item.actualHours.be,
    workshop: item.plannedHours.workshop - item.actualHours.workshop,
    install: item.plannedHours.install - item.actualHours.install,
  };
}

export function findChantierByCommercialCase(
  payload: ChantiersPayload,
  commercialCaseId: string,
): ChantierRecord | undefined {
  return payload.chantiers.find((item) => item.sourceCommercialCaseId === commercialCaseId);
}

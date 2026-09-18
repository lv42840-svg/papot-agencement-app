import { z } from "zod";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableText = (max: number) => z.string().trim().max(max).nullable();

export const chantierStatusSchema = z.enum(["ACTIVE", "DONE", "ARCHIVED"]);
export const launchDocumentStateSchema = z.enum(["PRESENT", "MISSING_DECLARED"]);
export const technicalOriginSchema = z.enum(["QUOTE_LINE", "TS"]);
export const beItemStatusSchema = z.enum(["TODO", "DRAW", "VALIDATION", "VALIDATED"]);
export const workshopItemStatusSchema = z.enum(["PREPARE", "READY", "IN_PROGRESS", "DONE"]);
export const installItemStatusSchema = z.enum(["TODO", "IN_PROGRESS", "DONE"]);
export const operationalSpaceIdSchema = z.enum([
  "admin",
  "be",
  "workshop",
  "install",
  "meeting",
  "mail",
  "reception",
]);
export const operationalSpaceStateSchema = z.enum(["APPLICABLE", "NOT_APPLICABLE"]);

const defaultOperationalSpaceStates = {
  admin: "APPLICABLE",
  be: "APPLICABLE",
  workshop: "APPLICABLE",
  install: "APPLICABLE",
  meeting: "APPLICABLE",
  mail: "APPLICABLE",
  reception: "APPLICABLE",
} as const;

export const operationalSpaceStatesSchema = z
  .object({
    admin: operationalSpaceStateSchema,
    be: operationalSpaceStateSchema,
    workshop: operationalSpaceStateSchema,
    install: operationalSpaceStateSchema,
    meeting: operationalSpaceStateSchema,
    mail: operationalSpaceStateSchema,
    reception: operationalSpaceStateSchema,
  })
  .default(defaultOperationalSpaceStates);

export const chantierHoursSchema = z.object({
  be: z.number().nonnegative(),
  workshop: z.number().nonnegative(),
  install: z.number().nonnegative(),
});

const technicalBaseSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(240),
  originKind: technicalOriginSchema,
  originLabel: nullableText(500),
  installedByUs: z.boolean(),
  sourceQuoteId: z.string().uuid().nullable().default(null),
  sourceQuoteLineId: z.string().uuid().nullable().default(null),
  sourceTsId: z.string().uuid().nullable().default(null),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const beItemSchema = technicalBaseSchema.extend({
  status: beItemStatusSchema,
});

export const workshopItemSchema = technicalBaseSchema.extend({
  sourceBeItemId: z.string().uuid().nullable(),
  status: workshopItemStatusSchema,
});

export const installItemSchema = z.object({
  id: z.string().uuid(),
  sourceBeItemId: z.string().uuid().nullable(),
  sourceWorkshopItemId: z.string().uuid().nullable(),
  name: z.string().trim().min(1).max(240),
  originKind: technicalOriginSchema,
  originLabel: nullableText(500),
  sourceQuoteId: z.string().uuid().nullable().default(null),
  sourceQuoteLineId: z.string().uuid().nullable().default(null),
  sourceTsId: z.string().uuid().nullable().default(null),
  status: installItemStatusSchema,
  note: nullableText(2000),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const chantierTsSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(500),
  linkedQuoteId: z.string().uuid().nullable().default(null),
  linkedQuoteLineId: z.string().uuid().nullable().default(null),
  createdAt: isoDateTimeSchema,
  createdByName: z.string().trim().min(1).max(120),
  updatedAt: isoDateTimeSchema,
  updatedByName: z.string().trim().min(1).max(120),
});

export const chantierOperationalSchema = z
  .object({
    spaces: operationalSpaceStatesSchema,
    beItems: z.array(beItemSchema).default([]),
    workshopItems: z.array(workshopItemSchema).default([]),
    installItems: z.array(installItemSchema).default([]),
    tsItems: z.array(chantierTsSchema).default([]),
  })
  .default({
    spaces: defaultOperationalSpaceStates,
    beItems: [],
    workshopItems: [],
    installItems: [],
    tsItems: [],
  });

export const chantierHistoryEventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "LAUNCHED",
    "DETAILS_UPDATED",
    "PLANNED_HOURS_UPDATED",
    "OPERATIONAL_ITEM_CREATED",
    "OPERATIONAL_STATUS_UPDATED",
    "OPERATIONAL_SPACE_STATE_UPDATED",
    "TS_CREATED",
    "TS_LINKED_TO_QUOTE",
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
  operational: chantierOperationalSchema,
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
export type TechnicalOrigin = z.infer<typeof technicalOriginSchema>;
export type BeItemStatus = z.infer<typeof beItemStatusSchema>;
export type WorkshopItemStatus = z.infer<typeof workshopItemStatusSchema>;
export type InstallItemStatus = z.infer<typeof installItemStatusSchema>;
export type OperationalSpaceId = z.infer<typeof operationalSpaceIdSchema>;
export type OperationalSpaceState = z.infer<typeof operationalSpaceStateSchema>;
export type BeItem = z.infer<typeof beItemSchema>;
export type WorkshopItem = z.infer<typeof workshopItemSchema>;
export type InstallItem = z.infer<typeof installItemSchema>;
export type ChantierTs = z.infer<typeof chantierTsSchema>;
export type ChantierOperational = z.infer<typeof chantierOperationalSchema>;
export type ChantierHistoryEvent = z.infer<typeof chantierHistoryEventSchema>;
export type ChantierRecord = z.infer<typeof chantierRecordSchema>;
export type ChantiersPayload = z.infer<typeof chantiersPayloadSchema>;

export const CHANTIER_STATUS_LABELS: Record<ChantierStatus, string> = {
  ACTIVE: "Actif",
  DONE: "Terminé",
  ARCHIVED: "Archivé",
};

export const BE_STATUS_LABELS: Record<BeItemStatus, string> = {
  TODO: "À faire",
  DRAW: "À dessiner",
  VALIDATION: "En validation",
  VALIDATED: "Validé",
};

export const WORKSHOP_STATUS_LABELS: Record<WorkshopItemStatus, string> = {
  PREPARE: "À préparer",
  READY: "Prêt à fabriquer",
  IN_PROGRESS: "En fabrication",
  DONE: "Terminé",
};

export const INSTALL_STATUS_LABELS: Record<InstallItemStatus, string> = {
  TODO: "À faire",
  IN_PROGRESS: "En cours",
  DONE: "Terminé",
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

import { z } from "zod";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const entryPrioritySchema = z.enum(["NORMAL", "URGENT"]);
export const entryStatusSchema = z.enum(["TO_QUALIFY", "ASSIGNED", "DONE"]);

export const entriesTagSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().trim().min(1).max(80),
  active: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
});

export const entryAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storagePath: z.string().trim().min(1).max(1000),
  uploadedAt: isoDateTimeSchema,
  uploadedByName: z.string().trim().min(1).max(120),
});

export const entryHistoryEventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "CREATED",
    "QUALIFICATION_SAVED",
    "ASSIGNED",
    "SNOOZED",
    "DEADLINE_POSTPONED",
    "REASSIGNED",
    "COMPLETED",
    "DERIVED_CREATED",
    "ATTACHMENTS_ADDED",
  ]),
  at: isoDateTimeSchema,
  actorName: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500),
});

export const entryRecordSchema = z.object({
  id: z.string().uuid(),
  rawText: z.string().trim().min(1).max(4000),
  structuredDescription: z.string().trim().max(4000).nullable(),
  nextAction: z.string().trim().max(2000).nullable(),
  tagIds: z.array(z.string().min(1).max(100)),
  priority: entryPrioritySchema,
  status: entryStatusSchema,
  createdAt: isoDateTimeSchema,
  createdByName: z.string().trim().min(1).max(120),
  assigneeName: z.string().trim().max(120).nullable(),
  dueDate: dateOnlySchema.nullable(),
  snoozedUntilDate: dateOnlySchema.nullable(),
  result: z.string().trim().max(4000).nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  parentEntryId: z.string().uuid().nullable(),
  clientId: z.string().uuid().nullable().optional(),
  commercialCaseId: z.string().uuid().nullable().optional(),
  derivedEntryIds: z.array(z.string().uuid()),
  attachments: z.array(entryAttachmentSchema).default([]),
  history: z.array(entryHistoryEventSchema),
});

export const entryNotificationSchema = z.object({
  id: z.string().uuid(),
  entryId: z.string().uuid(),
  recipientName: z.string().trim().min(1).max(120),
  createdAt: isoDateTimeSchema,
  message: z.string().trim().min(1).max(500),
  readAt: isoDateTimeSchema.nullable(),
});

export const entriesPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  tags: z.array(entriesTagSchema),
  entries: z.array(entryRecordSchema),
  notifications: z.array(entryNotificationSchema),
});

export type EntriesTag = z.infer<typeof entriesTagSchema>;
export type EntryAttachment = z.infer<typeof entryAttachmentSchema>;
export type EntryRecord = z.infer<typeof entryRecordSchema>;
export type EntryNotification = z.infer<typeof entryNotificationSchema>;
export type EntriesPayload = z.infer<typeof entriesPayloadSchema>;
export type EntryPriority = z.infer<typeof entryPrioritySchema>;

const DEFAULT_TAGS: EntriesTag[] = [
  { id: "contact", label: "Contact", active: true, sortOrder: 0 },
  { id: "devis", label: "Devis", active: true, sortOrder: 1 },
  { id: "chiffrage-seul", label: "Chiffrage seul", active: true, sortOrder: 2 },
  { id: "sav", label: "SAV", active: true, sortOrder: 3 },
  {
    id: "intervention-chantier",
    label: "Intervention chantier",
    active: true,
    sortOrder: 4,
  },
  {
    id: "compte-rendu-chantier",
    label: "Compte rendu de chantier",
    active: true,
    sortOrder: 5,
  },
];

export function createInitialEntriesPayload(): EntriesPayload {
  return {
    schemaVersion: 1,
    tags: DEFAULT_TAGS.map((etiquette) => ({ ...etiquette })),
    entries: [],
    notifications: [],
  };
}

export function parseEntriesPayload(valeur: unknown): EntriesPayload {
  if (valeur == null) return createInitialEntriesPayload();
  return entriesPayloadSchema.parse(valeur);
}

export function normalizePersonName(valeur: string): string {
  return valeur
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr-FR");
}

function parisDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const valeurs = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(valeurs.year),
    month: Number(valeurs.month),
    day: Number(valeurs.day),
  };
}

export function parisDateKey(date: Date = new Date()): string {
  const { year: annee, month: mois, day: jour } = parisDateParts(date);
  return `${annee.toString().padStart(4, "0")}-${mois.toString().padStart(2, "0")}-${jour
    .toString()
    .padStart(2, "0")}`;
}

function easterSunday(annee: number): { month: number; day: number } {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31);
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return { month: mois, day: jour };
}

function addUtcDays(annee: number, mois: number, jour: number, jours: number): string {
  const date = new Date(Date.UTC(annee, mois - 1, jour + jours, 12));
  return `${date.getUTCFullYear().toString().padStart(4, "0")}-${(date.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${date.getUTCDate().toString().padStart(2, "0")}`;
}

export function frenchNationalHolidayKeys(annee: number): Set<string> {
  const fixed = ["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"].map(
    (suffix) => `${annee}-${suffix}`,
  );
  const easter = easterSunday(annee);
  const movable = [
    addUtcDays(annee, easter.month, easter.day, 1),
    addUtcDays(annee, easter.month, easter.day, 39),
    addUtcDays(annee, easter.month, easter.day, 50),
  ];
  return new Set([...fixed, ...movable]);
}

export function isFrenchBusinessDay(date: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
  }).format(date);
  if (weekday === "Sat" || weekday === "Sun") return false;
  const { year: annee } = parisDateParts(date);
  return !frenchNationalHolidayKeys(annee).has(parisDateKey(date));
}

export function addFrenchBusinessHours(debut: Date, heures: number): Date {
  if (!Number.isInteger(heures) || heures < 0) throw new Error("BUSINESS_HOURS_INVALID");
  let cursor = new Date(debut.getTime());
  let remaining = heures;
  while (remaining > 0) {
    if (isFrenchBusinessDay(cursor)) remaining -= 1;
    cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
  }
  return cursor;
}

export function qualificationAttentionAt(entree: EntryRecord): Date {
  if (entree.snoozedUntilDate) {
    return new Date(`${entree.snoozedUntilDate}T12:00:00Z`);
  }
  return addFrenchBusinessHours(new Date(entree.createdAt), 48);
}

export function isQualificationAttentionDue(
  entree: EntryRecord,
  maintenant: Date = new Date(),
): boolean {
  if (entree.status !== "TO_QUALIFY") return false;
  if (entree.snoozedUntilDate) return parisDateKey(maintenant) >= entree.snoozedUntilDate;
  return maintenant.getTime() >= qualificationAttentionAt(entree).getTime();
}

export function isAssignedOverdue(entree: EntryRecord, maintenant: Date = new Date()): boolean {
  return Boolean(
    entree.status === "ASSIGNED" && entree.dueDate && parisDateKey(maintenant) > entree.dueDate,
  );
}

export function activeTags(contenu: EntriesPayload): EntriesTag[] {
  return contenu.tags
    .filter((etiquette) => etiquette.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

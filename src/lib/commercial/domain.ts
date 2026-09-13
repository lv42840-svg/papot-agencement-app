import { z } from "zod";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const commercialStatusSchema = z.enum([
  "PISTE",
  "CHIFFRAGE",
  "WAITING",
  "FOLLOW_UP",
  "LIKELY",
  "CONFIRMED",
  "LOST",
  "ABANDONED",
]);

export const commercialDocumentCategorySchema = z.enum([
  "RECEIVED",
  "INTERNAL_QUOTING",
  "QUOTE",
  "COSTING",
  "MISC",
]);

export const commercialDocumentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storagePath: z.string().trim().min(1).max(1200),
  category: commercialDocumentCategorySchema,
  versionLabel: z.string().trim().max(80).nullable(),
  variantLabel: z.string().trim().max(80).nullable(),
  isCurrent: z.boolean(),
  isSignedQuote: z.boolean(),
  uploadedAt: isoDateTimeSchema,
  uploadedByName: z.string().trim().min(1).max(120),
});

export const commercialHistoryEventSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "CREATED",
    "DETAILS_UPDATED",
    "STATUS_CHANGED",
    "QUOTE_SENT",
    "FOLLOW_UP",
    "QUOTE_DUE_POSTPONED",
    "CLOSED",
    "REOPENED",
    "DOCUMENTS_ADDED",
    "NOTES_UPDATED",
    "PROVISION_UPDATED",
    "AUTO_DUE",
  ]),
  at: isoDateTimeSchema,
  actorName: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1000),
});

export const commercialCaseSchema = z.object({
  id: z.string().uuid(),
  sourceEntryId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(1).max(240),
  clientName: z.string().trim().max(240).nullable(),
  siteLabel: z.string().trim().max(240).nullable(),
  contactName: z.string().trim().max(160).nullable(),
  contactPhone: z.string().trim().max(80).nullable(),
  contactEmail: z.string().trim().max(240).nullable(),
  description: z.string().trim().max(4000).nullable(),
  nextAction: z.string().trim().max(2000).nullable(),
  status: commercialStatusSchema,
  quoteOwnerName: z.string().trim().max(120).nullable(),
  quoteDueDate: dateOnlySchema.nullable(),
  reviewDate: dateOnlySchema.nullable(),
  expectedConfirmationDate: dateOnlySchema.nullable(),
  plannedInstallDate: dateOnlySchema.nullable(),
  quoteSentAt: isoDateTimeSchema.nullable(),
  confirmedAt: isoDateTimeSchema.nullable(),
  closedAt: isoDateTimeSchema.nullable(),
  closingReason: z.string().trim().max(2000).nullable(),
  quoteNotes: z.string().max(12000),
  provisionHours: z.object({
    be: z.number().nonnegative(),
    workshop: z.number().nonnegative(),
    install: z.number().nonnegative(),
  }),
  documents: z.array(commercialDocumentSchema),
  createdAt: isoDateTimeSchema,
  createdByName: z.string().trim().min(1).max(120),
  updatedAt: isoDateTimeSchema,
  updatedByName: z.string().trim().min(1).max(120),
  history: z.array(commercialHistoryEventSchema),
});

export const commercialPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  cases: z.array(commercialCaseSchema),
});

export type CommercialStatus = z.infer<typeof commercialStatusSchema>;
export type CommercialDocumentCategory = z.infer<typeof commercialDocumentCategorySchema>;
export type CommercialDocument = z.infer<typeof commercialDocumentSchema>;
export type CommercialHistoryEvent = z.infer<typeof commercialHistoryEventSchema>;
export type CommercialCase = z.infer<typeof commercialCaseSchema>;
export type CommercialPayload = z.infer<typeof commercialPayloadSchema>;

export const COMMERCIAL_STATUS_LABELS: Record<CommercialStatus, string> = {
  PISTE: "Piste",
  CHIFFRAGE: "Chiffrage en cours",
  WAITING: "En attente",
  FOLLOW_UP: "À relancer",
  LIKELY: "Ça va tomber",
  CONFIRMED: "Confirmée",
  LOST: "Perdu",
  ABANDONED: "Abandonné",
};

export const COMMERCIAL_DOCUMENT_CATEGORY_LABELS: Record<CommercialDocumentCategory, string> = {
  RECEIVED: "Documents reçus",
  INTERNAL_QUOTING: "Chiffrage interne",
  QUOTE: "Devis",
  COSTING: "Déboursé",
  MISC: "Divers",
};

export function createInitialCommercialPayload(): CommercialPayload {
  return { schemaVersion: 1, cases: [] };
}

export function parseCommercialPayload(value: unknown): CommercialPayload {
  if (value == null) return createInitialCommercialPayload();
  return commercialPayloadSchema.parse(value);
}

export function commercialParisDateKey(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isCommercialClosed(item: CommercialCase): boolean {
  return item.status === "LOST" || item.status === "ABANDONED";
}

export function isCommercialActive(item: CommercialCase): boolean {
  return !isCommercialClosed(item) && item.status !== "CONFIRMED";
}

export function isQuoteOverdue(item: CommercialCase, now: Date = new Date()): boolean {
  return (
    item.status === "CHIFFRAGE" &&
    Boolean(item.quoteDueDate) &&
    (item.quoteDueDate as string) < commercialParisDateKey(now)
  );
}

export function commercialNeedsFollowUp(item: CommercialCase, now: Date = new Date()): boolean {
  if (item.status === "FOLLOW_UP") return true;
  const today = commercialParisDateKey(now);
  if ((item.status === "PISTE" || item.status === "WAITING") && item.reviewDate) {
    return item.reviewDate <= today;
  }
  if (item.status === "LIKELY" && item.expectedConfirmationDate) {
    return item.expectedConfirmationDate <= today;
  }
  return false;
}

export function nextCommercialDeadline(item: CommercialCase): string | null {
  if (item.status === "CHIFFRAGE") return item.quoteDueDate;
  if (item.status === "PISTE" || item.status === "WAITING") return item.reviewDate;
  if (item.status === "LIKELY") return item.expectedConfirmationDate;
  return null;
}

export function commercialHasSignedQuote(item: CommercialCase): boolean {
  return item.documents.some((document) => document.category === "QUOTE" && document.isSignedQuote);
}

function autoHistory(item: CommercialCase, summary: string, now: Date): void {
  item.history.push({
    id: globalThis.crypto.randomUUID(),
    type: "AUTO_DUE",
    at: now.toISOString(),
    actorName: "PAPOT",
    summary,
  });
}

export function applyCommercialAutomaticTransitions(
  source: CommercialPayload,
  now: Date = new Date(),
): { payload: CommercialPayload; changed: boolean } {
  const payload = structuredClone(source);
  const today = commercialParisDateKey(now);
  let changed = false;

  for (const item of payload.cases) {
    if ((item.status === "PISTE" || item.status === "WAITING") && item.reviewDate && item.reviewDate <= today) {
      const previous = item.status;
      item.status = "FOLLOW_UP";
      item.updatedAt = now.toISOString();
      item.updatedByName = "PAPOT";
      autoHistory(
        item,
        `${COMMERCIAL_STATUS_LABELS[previous]} arrivé à échéance le ${item.reviewDate} : passage automatique en À relancer.`,
        now,
      );
      changed = true;
      continue;
    }

    if (item.status === "LIKELY" && item.expectedConfirmationDate && item.expectedConfirmationDate <= today) {
      item.status = "FOLLOW_UP";
      item.updatedAt = now.toISOString();
      item.updatedByName = "PAPOT";
      autoHistory(
        item,
        `Date prévisionnelle de confirmation ${item.expectedConfirmationDate} atteinte : passage automatique en À relancer.`,
        now,
      );
      changed = true;
    }
  }

  return { payload, changed };
}

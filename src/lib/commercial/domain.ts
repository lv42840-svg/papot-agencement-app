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

export const commercialSiteAddressSchema = z.object({
  addressLine1: z.string().trim().max(240).default(""),
  addressLine2: z.string().trim().max(240).default(""),
  postalCode: z.string().trim().max(20).default(""),
  city: z.string().trim().max(160).default(""),
});

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
  isSignedQuote: z.boolean().default(false),
  legacySignedQuote: z.boolean().optional(),
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
    "CLIENT_LINKED",
    "SOURCE_ENTRY_LINKED",
    "AUTO_DUE",
  ]),
  at: isoDateTimeSchema,
  actorName: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1000),
});

export const commercialClientSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["COMPANY", "INDIVIDUAL"]),
  displayName: z.string().trim().min(1).max(240),
  email: z.string().trim().max(240).nullable(),
  phone: z.string().trim().max(80).nullable(),
  addressLine1: z.string().trim().max(240).nullable().default(null),
  addressLine2: z.string().trim().max(240).nullable().default(null),
  postalCode: z.string().trim().max(20).nullable().default(null),
  city: z.string().trim().max(160).nullable().default(null),
});

export const commercialCaseSchema = z.object({
  id: z.string().uuid(),
  sourceEntryId: z.string().uuid().nullable().default(null),
  clientId: z.string().uuid().nullable().optional(),
  primaryContactId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(240),
  clientName: z.string().trim().max(240).nullable(),
  siteLabel: z.string().trim().max(240).nullable(),
  siteAddressOverride: commercialSiteAddressSchema.nullable().default(null),
  contactName: z.string().trim().max(160).nullable(),
  contactPhone: z.string().trim().max(80).nullable(),
  contactEmail: z.string().trim().max(240).nullable(),
  description: z.string().trim().max(4000).nullable(),
  nextAction: z.string().trim().max(2000).nullable(),
  status: commercialStatusSchema,
  reviewDate: dateOnlySchema.nullable(),
  expectedConfirmationDate: dateOnlySchema.nullable(),
  plannedInstallDate: dateOnlySchema.nullable(),
  confirmedAt: isoDateTimeSchema.nullable(),
  closedAt: isoDateTimeSchema.nullable(),
  closingReason: z.string().trim().max(2000).nullable(),
  documents: z.array(commercialDocumentSchema),
  createdAt: isoDateTimeSchema,
  createdByName: z.string().trim().min(1).max(120),
  updatedAt: isoDateTimeSchema,
  updatedByName: z.string().trim().min(1).max(120),
  history: z.array(commercialHistoryEventSchema),
  quoteOwnerName: z.string().trim().max(120).nullable().default(null),
  quoteDueDate: dateOnlySchema.nullable().default(null),
  quoteSentAt: isoDateTimeSchema.nullable().default(null),
  quoteNotes: z.string().default(""),
  provisionHours: z
    .object({
      be: z.number().nonnegative(),
      workshop: z.number().nonnegative(),
      install: z.number().nonnegative(),
    })
    .default({ be: 0, workshop: 0, install: 0 }),
});

export const commercialPayloadSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  clients: z.array(commercialClientSchema).optional(),
  cases: z.array(commercialCaseSchema),
});

export type CommercialStatus = z.infer<typeof commercialStatusSchema>;
export type CommercialDocumentCategory = z.infer<typeof commercialDocumentCategorySchema>;
export type CommercialSiteAddress = z.infer<typeof commercialSiteAddressSchema>;
export type CommercialDocument = z.infer<typeof commercialDocumentSchema>;
export type CommercialHistoryEvent = z.infer<typeof commercialHistoryEventSchema>;
export type CommercialClient = z.infer<typeof commercialClientSchema>;
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
  INTERNAL_QUOTING: "Chiffrage historique/interne",
  QUOTE: "Devis historique",
  COSTING: "Déboursé historique",
  MISC: "Divers",
};

export function createInitialCommercialPayload(): CommercialPayload {
  return { schemaVersion: 2, clients: [], cases: [] };
}

export function parseCommercialPayload(value: unknown): CommercialPayload {
  if (value == null) return createInitialCommercialPayload();
  const parsed = commercialPayloadSchema.parse(value);
  return {
    ...parsed,
    schemaVersion: 2,
    clients: parsed.clients ?? [],
    cases: parsed.cases.map((item) => ({
      ...item,
      clientId: item.clientId ?? null,
      primaryContactId: item.primaryContactId ?? null,
      documents: item.documents.map((document) => ({
        ...document,
        isSignedQuote: document.isSignedQuote ?? document.legacySignedQuote ?? false,
        legacySignedQuote: document.legacySignedQuote ?? document.isSignedQuote ?? false,
      })),
    })),
  };
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

export function commercialNeedsFollowUp(item: CommercialCase, now: Date = new Date()): boolean {
  if (item.status === "FOLLOW_UP") return true;
  const today = commercialParisDateKey(now);
  if (
    (item.status === "PISTE" || item.status === "WAITING" || item.status === "CHIFFRAGE") &&
    item.reviewDate
  ) {
    return item.reviewDate <= today;
  }
  if (item.status === "LIKELY" && item.expectedConfirmationDate) {
    return item.expectedConfirmationDate <= today;
  }
  return false;
}

export function nextCommercialDeadline(item: CommercialCase): string | null {
  if (item.status === "LIKELY") return item.expectedConfirmationDate;
  if (item.status === "PISTE" || item.status === "WAITING" || item.status === "CHIFFRAGE")
    return item.reviewDate;
  return null;
}

export function isQuoteOverdue(item: CommercialCase, now: Date = new Date()): boolean {
  return (
    item.status === "CHIFFRAGE" &&
    item.quoteDueDate !== null &&
    item.quoteDueDate < commercialParisDateKey(now)
  );
}

export function commercialHasSignedQuote(item: CommercialCase): boolean {
  return item.documents.some(
    (document) =>
      document.category === "QUOTE" && (document.legacySignedQuote || document.isSignedQuote),
  );
}

export function applyCommercialAutomaticTransitions(
  source: CommercialPayload,
  now: Date = new Date(),
): { payload: CommercialPayload; changed: boolean } {
  const payload = structuredClone(parseCommercialPayload(source));
  const today = commercialParisDateKey(now);
  let changed = false;
  for (const item of payload.cases) {
    if (
      (item.status === "PISTE" || item.status === "WAITING") &&
      item.reviewDate &&
      item.reviewDate <= today
    ) {
      const previous = item.status;
      item.status = "FOLLOW_UP";
      item.updatedAt = now.toISOString();
      item.updatedByName = "PAPOT";
      item.history.push({
        id: globalThis.crypto.randomUUID(),
        type: "AUTO_DUE",
        at: now.toISOString(),
        actorName: "PAPOT",
        summary: `${COMMERCIAL_STATUS_LABELS[previous]} arrivé à échéance le ${item.reviewDate} : passage automatique en À relancer.`,
      });
      changed = true;
    }
  }
  return { payload, changed };
}

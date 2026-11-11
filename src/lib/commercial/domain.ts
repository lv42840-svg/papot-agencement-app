import { z } from "zod";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const commercialStatusSchema = z.enum([
  "PISTE",
  "CHIFFRAGE",
  "SENT",
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
    "FORECAST_QUOTES_UPDATED",
    "CLIENT_LINKED",
    "SOURCE_ENTRY_LINKED",
    "AUTO_DUE",
    "QUOTES_RETAINED",
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
  retainedQuoteIds: z.array(z.string().uuid()).max(1000).default([]),
  forecastQuoteIds: z.array(z.string().uuid()).max(1000).nullable().optional(),
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
  SENT: "Envoyé",
  WAITING: "En attente",
  FOLLOW_UP: "À relancer",
  LIKELY: "Ça va tomber",
  CONFIRMED: "Validé",
  LOST: "Perdu",
  ABANDONED: "Abandonné",
};

export const COMMERCIAL_FOLLOW_STATUS_OPTIONS = [
  "PISTE",
  "SENT",
  "FOLLOW_UP",
  "WAITING",
  "CONFIRMED",
] as const satisfies readonly CommercialStatus[];

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

export function parseCommercialPayload(valeur: unknown): CommercialPayload {
  if (valeur == null) return createInitialCommercialPayload();
  const analyse = commercialPayloadSchema.parse(valeur);
  return {
    ...analyse,
    schemaVersion: 2,
    clients: analyse.clients ?? [],
    cases: analyse.cases.map((element) => ({
      ...element,
      clientId: element.clientId ?? null,
      primaryContactId: element.primaryContactId ?? null,
      documents: element.documents.map((document) => ({
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
  const valeurs = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${valeurs.year}-${valeurs.month}-${valeurs.day}`;
}

export function isCommercialClosed(element: CommercialCase): boolean {
  return element.status === "LOST" || element.status === "ABANDONED";
}

export function isCommercialActive(element: CommercialCase): boolean {
  return !isCommercialClosed(element) && element.status !== "CONFIRMED";
}

export function commercialNeedsFollowUp(
  element: CommercialCase,
  maintenant: Date = new Date(),
): boolean {
  if (element.status === "FOLLOW_UP") return true;
  const aujourdhui = commercialParisDateKey(maintenant);
  if (
    (element.status === "PISTE" ||
      element.status === "SENT" ||
      element.status === "WAITING" ||
      element.status === "CHIFFRAGE") &&
    element.reviewDate
  ) {
    return element.reviewDate <= aujourdhui;
  }
  if (element.status === "LIKELY" && element.expectedConfirmationDate) {
    return element.expectedConfirmationDate <= aujourdhui;
  }
  return false;
}

export function nextCommercialDeadline(element: CommercialCase): string | null {
  if (element.status === "LIKELY") return element.expectedConfirmationDate;
  if (
    element.status === "PISTE" ||
    element.status === "SENT" ||
    element.status === "WAITING" ||
    element.status === "CHIFFRAGE"
  ) {
    return element.reviewDate;
  }
  return null;
}

export function isQuoteOverdue(element: CommercialCase, maintenant: Date = new Date()): boolean {
  return (
    element.status === "CHIFFRAGE" &&
    element.quoteDueDate !== null &&
    element.quoteDueDate < commercialParisDateKey(maintenant)
  );
}

export function commercialHasSignedQuote(element: CommercialCase): boolean {
  return element.documents.some(
    (document) =>
      document.category === "QUOTE" && (document.legacySignedQuote || document.isSignedQuote),
  );
}

export function applyCommercialAutomaticTransitions(
  source: CommercialPayload,
  maintenant: Date = new Date(),
): { payload: CommercialPayload; changed: boolean } {
  const contenu = structuredClone(parseCommercialPayload(source));
  const aujourdhui = commercialParisDateKey(maintenant);
  let changed = false;
  for (const element of contenu.cases) {
    if (
      (element.status === "PISTE" || element.status === "SENT" || element.status === "WAITING") &&
      element.reviewDate &&
      element.reviewDate <= aujourdhui
    ) {
      const precedent = element.status;
      element.status = "FOLLOW_UP";
      element.updatedAt = maintenant.toISOString();
      element.updatedByName = "PAPOT";
      element.history.push({
        id: globalThis.crypto.randomUUID(),
        type: "AUTO_DUE",
        at: maintenant.toISOString(),
        actorName: "PAPOT",
        summary: `${COMMERCIAL_STATUS_LABELS[precedent]} arrivé à échéance le ${element.reviewDate} : passage automatique en À relancer.`,
      });
      changed = true;
    }
  }
  return { payload: contenu, changed };
}

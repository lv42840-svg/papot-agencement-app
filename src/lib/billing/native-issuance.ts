import { z } from "zod";
import { calculateInvoiceDocumentTotals } from "./document-lines";
import type { BillingDraft, BillingPayload } from "./domain";
import { clientDisplayName, type ClientRecord } from "../clients/domain";
import type { CompanyProfile } from "../company-profile/domain";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((text) => {
  const date = new Date(text + "T00:00:00Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === text;
}, "BILLING_NATIVE_DATE_INVALID");
const cents = z.number().int().nonnegative().safe();
const taxGroup = z.object({
  ratePercent: z.number().finite().min(0).max(100),
  baseHtCents: cents,
  vatCents: cents,
});
const documentLine = z.object({
  id: z.string().uuid(),
  origin: z.enum(["QUOTE", "FREE", "TITLE"]),
  headingLevel: z.enum(["SECTION", "SUBSECTION"]).optional(),
  sourceLineId: z.string().uuid().nullable(),
  allocationLineId: z.string().uuid().nullable().optional(),
  description: z.string().trim().min(1).max(4000),
  quantity: z.number().finite().nonnegative(),
  unit: z.string().trim().max(40),
  unitPriceCents: cents,
  vatRatePercent: z.number().finite().min(0).max(100),
});
const seller = z.object({
  name: z.string().trim().min(1),
  legalForm: z.string().trim().min(1),
  address: z.string().trim().min(1),
  postalCode: z.string().trim().min(1),
  city: z.string().trim().min(1),
  siret: z.string().regex(/^\d{14}$/),
  rcs: z.string().trim().min(1),
  capital: z.string(),
  vatNumber: z.string().trim().min(1),
  iban: z.string(),
  bic: z.string(),
  insurerName: z.string(),
  insurerAddress: z.string(),
  insuranceCoverage: z.string(),
});
const buyer = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().min(1),
  addressLine2: z.string(),
  postalCode: z.string().trim().min(1),
  city: z.string().trim().min(1),
  siret: z.string(),
  vatNumber: z.string(),
  type: z.enum(["PARTICULIER", "ENTREPRISE", "COLLECTIVITE", "AUTRE"]),
});

export const nativeIssuedInvoiceSchema = z.object({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  draftId: z.string().uuid(),
  chantierId: z.string().uuid(),
  clientId: z.string().uuid(),
  ordinal: z.number().int().positive().safe(),
  number: z.string().regex(/^PA-\d{4}-\d{6,}$/),
  issuedAt: z.string().datetime({ offset: true }),
  issuedOn: dateSchema,
  serviceOn: dateSchema,
  dueOn: dateSchema,
  operationCategory: z.enum(["SERVICE", "GOODS", "MIXED"]),
  vatOnDebits: z.boolean(),
  buyerPurchaseOrderNumber: z.string().trim().max(160),
  latePenaltyRatePercent: z.number().finite().positive().max(100),
  collectionFeeCents: cents,
  seller,
  buyer,
  type: z.enum(["STANDARD", "DEPOSIT", "PROGRESS", "FINAL"]),
  label: z.string().trim().min(1),
  affairName: z.string().trim().min(1),
  quoteLabel: z.string().trim().min(1),
  notes: z.string(),
  paymentTerms: z.string().trim().min(1),
  documentLines: z.array(documentLine).min(1),
  taxGroups: z.array(taxGroup).min(1),
  amountHtCents: cents.positive(),
  vatCents: cents,
  totalTtcCents: cents.positive(),
  retentionTtcCents: cents,
  priorDepositNumbers: z.array(z.string()),
  issuedByName: z.string().trim().min(1),
  status: z.literal("ISSUED"),
});
export type NativeIssuedInvoice = z.infer<typeof nativeIssuedInvoiceSchema>;
export const nativeInvoiceLedgerSchema = z.object({
  lastOrdinal: z.number().int().nonnegative().safe(),
  invoices: z.array(nativeIssuedInvoiceSchema),
});
export type NativeInvoiceLedger = z.infer<typeof nativeInvoiceLedgerSchema>;

export function emptyNativeInvoiceLedger(): NativeInvoiceLedger {
  return { lastOrdinal: 0, invoices: [] };
}

export const issueNativeInvoiceInputSchema = z.object({
  requestId: z.string().uuid(),
  draftId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  serviceOn: dateSchema,
  dueOn: dateSchema,
  operationCategory: z.enum(["SERVICE", "GOODS", "MIXED"]),
  vatOnDebits: z.boolean(),
  buyerPurchaseOrderNumber: z.string().trim().max(160),
  latePenaltyRatePercent: z.number().finite().positive().max(100),
});
export type IssueNativeInvoiceInput = z.infer<typeof issueNativeInvoiceInputSchema>;

function parisDate(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now).map((part) => [part.type, part.value]),
  );
  return [parts.year, parts.month, parts.day].join("-");
}

function assertProfiles(profile: CompanyProfile, client: ClientRecord): void {
  if (!profile.name.trim() || !profile.legalForm.trim() || !profile.addressLine1.trim() ||
    !profile.postalCode.trim() || !profile.city.trim() ||
    !/^\d{14}$/.test(profile.siret.replace(/\s/g, "")) ||
    !profile.vatNumber.trim() || !profile.rcs.trim()) {
    throw new Error("BILLING_NATIVE_SELLER_PROFILE_INCOMPLETE");
  }
  if (client.isArchived || !clientDisplayName(client).trim() || !client.addressLine1.trim() ||
    !client.postalCode.trim() || !client.city.trim() ||
    (client.type !== "PARTICULIER" && !/^\d{14}$/.test(client.siret)) ||
    !client.paymentTerms.trim()) {
    throw new Error("BILLING_NATIVE_BUYER_PROFILE_INCOMPLETE");
  }
}

/**
 * Number and frozen invoice are saved in one BillingRepository.mutate transaction.
 * An idempotent retry never consumes a second number. No Pennylane request occurs.
 */
export function issueNativeInvoice(
  payload: BillingPayload,
  rawInput: IssueNativeInvoiceInput,
  profile: CompanyProfile,
  client: ClientRecord,
  actor: string,
  now = new Date(),
): BillingPayload {
  const input = issueNativeInvoiceInputSchema.parse(rawInput);
  const state = payload.nativeInvoiceLedger ?? emptyNativeInvoiceLedger();
  const replay = state.invoices.find((item) => item.requestId === input.requestId);
  if (replay) {
    if (replay.draftId !== input.draftId) throw new Error("BILLING_NATIVE_REQUEST_REUSED");
    return payload;
  }
  if (!Number.isFinite(now.valueOf())) throw new Error("BILLING_NATIVE_DATE_INVALID");
  const issuedAt = now.toISOString();
  const issuedOn = parisDate(now);
  const draft: BillingDraft | undefined = payload.drafts.find((d) => d.id === input.draftId);
  if (!draft) throw new Error("BILLING_DRAFT_NOT_FOUND");
  if (draft.status !== "APPROVED") throw new Error("BILLING_NATIVE_APPROVAL_REQUIRED");
  if (draft.updatedAt !== input.expectedUpdatedAt) throw new Error("BILLING_VERSION_CONFLICT");
  if (!draft.chantierId || draft.clientId !== client.id) {
    throw new Error("BILLING_NATIVE_SOURCE_INVALID");
  }
  if (state.invoices.some((item) => item.draftId === draft.id)) {
    throw new Error("BILLING_NATIVE_ALREADY_ISSUED");
  }
  if (state.invoices.length && state.invoices.at(-1)!.issuedAt > issuedAt) {
    throw new Error("BILLING_NATIVE_DATE_BACKWARDS");
  }
  if ((draft.type !== "DEPOSIT" && input.serviceOn > issuedOn) || input.dueOn < issuedOn) {
    throw new Error("BILLING_NATIVE_DATES_INVALID");
  }
  assertProfiles(profile, client);
  if (!draft.documentLines?.length) throw new Error("BILLING_DOCUMENT_EDIT_REQUIRED");
  const totals = calculateInvoiceDocumentTotals(draft.documentLines);
  if (
    totals.amountHtCents !== draft.amountHtCents ||
    totals.vatCents !== draft.vatCents ||
    totals.totalTtcCents !== draft.totalTtcCents ||
    totals.taxGroups.length !== draft.taxGroups.length ||
    totals.taxGroups.some((t) => !draft.taxGroups.some((g) =>
      g.ratePercent === t.ratePercent &&
      g.baseHtCents === t.baseHtCents &&
      g.vatCents === t.vatCents
    ))
  ) {
    throw new Error("BILLING_APPROVAL_TOTALS_MISMATCH");
  }
  const ordinal = state.lastOrdinal + 1;
  if (!Number.isSafeInteger(ordinal)) throw new Error("BILLING_NATIVE_SEQUENCE_EXHAUSTED");
  const number = ["PA", issuedOn.slice(0, 4), String(ordinal).padStart(6, "0")].join("-");
  if (state.invoices.some((item) => item.ordinal === ordinal || item.number === number)) {
    throw new Error("BILLING_NATIVE_SEQUENCE_CONFLICT");
  }
  if (payload.financialLedger?.invoices.some((item) => item.number === number)) {
    throw new Error("BILLING_NATIVE_NUMBER_ALREADY_USED");
  }
  const record = nativeIssuedInvoiceSchema.parse({
    id: globalThis.crypto.randomUUID(),
    requestId: input.requestId,
    draftId: draft.id,
    chantierId: draft.chantierId,
    clientId: client.id,
    ordinal,
    number,
    issuedAt,
    issuedOn,
    serviceOn: input.serviceOn,
    dueOn: input.dueOn,
    operationCategory: input.operationCategory,
    vatOnDebits: input.vatOnDebits,
    buyerPurchaseOrderNumber: input.buyerPurchaseOrderNumber,
    latePenaltyRatePercent: input.latePenaltyRatePercent,
    collectionFeeCents: client.type === "PARTICULIER" ? 0 : 4000,
    seller: {
      name: profile.name, legalForm: profile.legalForm, address: profile.addressLine1,
      postalCode: profile.postalCode, city: profile.city,
      siret: profile.siret.replace(/\s/g, ""), rcs: profile.rcs, capital: profile.capital,
      vatNumber: profile.vatNumber, iban: profile.iban, bic: profile.bic,
      insurerName: profile.insurerName, insurerAddress: profile.insurerAddress,
      insuranceCoverage: profile.insuranceCoverage,
    },
    buyer: {
      name: clientDisplayName(client), address: client.addressLine1,
      addressLine2: client.addressLine2, postalCode: client.postalCode, city: client.city,
      siret: client.siret, vatNumber: client.vatNumber, type: client.type,
    },
    type: draft.type,
    label: draft.label, affairName: draft.affairName, quoteLabel: draft.quoteLabel,
    notes: draft.notes, paymentTerms: client.paymentTerms,
    documentLines: draft.documentLines.map((line) => ({ ...line })),
    taxGroups: draft.taxGroups.map((t) => ({ ...t })),
    amountHtCents: draft.amountHtCents, vatCents: draft.vatCents,
    totalTtcCents: draft.totalTtcCents,
    retentionTtcCents: draft.retention?.amountTtcCents ?? 0,
    priorDepositNumbers: state.invoices
      .filter((item) => item.chantierId === draft.chantierId && item.type === "DEPOSIT")
      .map((item) => item.number),
    issuedByName: actor,
    status: "ISSUED",
  });
  return {
    ...payload,
    nativeInvoiceLedger: {
      lastOrdinal: ordinal,
      invoices: [...state.invoices, record],
    },
  };
}

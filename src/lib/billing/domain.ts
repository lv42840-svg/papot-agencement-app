import { calculateLineProgress } from "./progress";
import { buildInvoiceDocumentLines, calculateInvoiceDocumentTotals } from "./document-lines";
import { z } from "zod";

const centsSchema = z.number().int().nonnegative().safe();
const dateTimeSchema = z.string().datetime({ offset: true });

export const billingTypeSchema = z.enum(["STANDARD", "DEPOSIT", "PROGRESS", "FINAL"]);
export type BillingType = z.infer<typeof billingTypeSchema>;

export const billingTaxGroupSchema = z.object({
  ratePercent: z.number().finite().min(0).max(100),
  baseHtCents: centsSchema,
});
export type BillingTaxGroup = z.infer<typeof billingTaxGroupSchema>;

export const billingSourceLineSchema = z.object({
  lineId: z.string().uuid(),
  description: z.string().min(1).max(4000),
  amountHtCents: centsSchema,
  vatRatePercent: z.number().finite().min(0).max(100),
  quantity: z.number().finite().positive().optional(),
  unit: z.string().trim().max(40).optional(),
});
export type BillingSourceLine = z.infer<typeof billingSourceLineSchema>;

export const billingLineProgressSchema = z.object({
  lineId: z.string().uuid(),
  percent: z.number().finite().min(0).max(100),
  cumulativeHtCents: centsSchema,
});
export type BillingLineProgress = z.infer<typeof billingLineProgressSchema>;

export const billingDocumentLineSchema = z
  .object({
    id: z.string().uuid(),
    origin: z.enum(["QUOTE", "FREE", "TITLE"]),
    sourceLineId: z.string().uuid().nullable(),
    description: z.string().trim().min(1).max(4000),
    quantity: z.number().finite().min(0).max(1000000),
    unit: z.string().trim().max(40),
    unitPriceCents: centsSchema,
    vatRatePercent: z.number().finite().min(0).max(100),
  })
  .superRefine((ligne, ctx) => {
    if (ligne.origin === "TITLE") {
      if (ligne.quantity !== 0 || ligne.unitPriceCents !== 0 || ligne.sourceLineId !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "BILLING_TITLE_INVALID" });
      }
    } else if (
      ligne.quantity <= 0 ||
      (ligne.origin === "QUOTE" && !ligne.sourceLineId) ||
      (ligne.origin === "FREE" && ligne.sourceLineId !== null)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "BILLING_DOCUMENT_LINE_INVALID" });
    }
  });
export type BillingDocumentLine = z.infer<typeof billingDocumentLineSchema>;

export const billingSourceSchema = z.object({
  quoteId: z.string().uuid(),
  commercialCaseId: z.string().uuid(),
  chantierId: z.string().uuid().nullable(),
  clientId: z.string().uuid(),
  clientName: z.string().min(1),
  affairName: z.string().min(1),
  quoteLabel: z.string().min(1),
  contractHtCents: centsSchema.positive(),
  contractTaxGroups: z.array(billingTaxGroupSchema).min(1),
  lines: z.array(billingSourceLineSchema).max(1000).optional(),
});
export type BillingSource = z.infer<typeof billingSourceSchema>;

export const billingDraftSchema = billingSourceSchema.extend({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
  status: z.enum(["DRAFT", "APPROVED"]),
  approvedAt: dateTimeSchema.optional(),
  approvedByName: z.string().trim().min(1).optional(),
  type: billingTypeSchema,
  label: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(4000),
  amountHtCents: centsSchema.positive(),
  taxGroups: z.array(billingTaxGroupSchema.extend({ vatCents: centsSchema })).min(1),
  vatCents: centsSchema,
  totalTtcCents: centsSchema.positive(),
  cumulativePercent: z.number().finite().min(0).max(100).nullable(),
  lineProgress: z.array(billingLineProgressSchema).max(1000).optional(),
  documentLines: z.array(billingDocumentLineSchema).max(1000).optional(),
  createdAt: dateTimeSchema,
  createdByName: z.string().trim().min(1),
  updatedAt: dateTimeSchema,
  updatedByName: z.string().trim().min(1),
});
export type BillingDraft = z.infer<typeof billingDraftSchema>;

export const DEFAULT_BILLING_TITLES = [
  "Facture de travaux",
  "Facture d'acompte",
  "Situation de travaux",
  "Facture de solde",
  "Travaux supplémentaires",
] as const;

export const billingTitlesSchema = z
  .array(z.string().trim().min(1).max(240))
  .min(1)
  .max(50)
  .refine(
    (elements) =>
      new Set(elements.map((element) => element.toLocaleLowerCase("fr-FR"))).size ===
      elements.length,
    "BILLING_TITLES_DUPLICATE",
  );

export const billingPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  drafts: z.array(billingDraftSchema),
  invoiceTitles: billingTitlesSchema.optional(),
});
export type BillingPayload = z.infer<typeof billingPayloadSchema>;

export function parseBillingPayload(valeur: unknown): BillingPayload {
  if (valeur === null || valeur === undefined) return { schemaVersion: 1, drafts: [] };
  return billingPayloadSchema.parse(valeur);
}

export function preparedHtCents(
  contenu: BillingPayload,
  idDevis: string,
  excludingId?: string,
): number {
  return contenu.drafts
    .filter((brouillon) => brouillon.quoteId === idDevis && brouillon.id !== excludingId)
    .reduce((somme, brouillon) => somme + brouillon.amountHtCents, 0);
}

function assertSource(source: BillingSource): BillingSource {
  const valid = billingSourceSchema.parse(source);
  if (
    valid.contractTaxGroups.reduce((somme, group) => somme + group.baseHtCents, 0) !==
    valid.contractHtCents
  ) {
    throw new Error("BILLING_SOURCE_TOTAL_MISMATCH");
  }
  if (valid.lines?.length) {
    const lineTotal = valid.lines.reduce((somme, ligne) => somme + ligne.amountHtCents, 0);
    if (lineTotal !== valid.contractHtCents) throw new Error("BILLING_SOURCE_LINES_MISMATCH");
    if (new Set(valid.lines.map((ligne) => ligne.lineId)).size !== valid.lines.length) {
      throw new Error("BILLING_SOURCE_LINES_DUPLICATE");
    }
    for (const group of valid.contractTaxGroups) {
      const fromLines = valid.lines
        .filter((ligne) => ligne.vatRatePercent === group.ratePercent)
        .reduce((somme, ligne) => somme + ligne.amountHtCents, 0);
      if (fromLines !== group.baseHtCents) throw new Error("BILLING_SOURCE_TAX_MISMATCH");
    }
  }
  return valid;
}

export function distributeBillingTax(
  groups: BillingTaxGroup[],
  amountHtCents: number,
): { groups: BillingDraft["taxGroups"]; vatCents: number; ttcCents: number } {
  if (!Number.isSafeInteger(amountHtCents) || amountHtCents <= 0) {
    throw new Error("BILLING_AMOUNT_INVALID");
  }
  const contractHtCents = groups.reduce((somme, group) => somme + group.baseHtCents, 0);
  if (!Number.isSafeInteger(contractHtCents) || amountHtCents > contractHtCents) {
    throw new Error("BILLING_AMOUNT_EXCEEDS_CONTRACT");
  }
  // Largest remainder keeps the total at exactly the requested cent, across VAT rates.
  const allocations = groups.map((group, indice) => {
    const raw = (amountHtCents * group.baseHtCents) / contractHtCents;
    return {
      index: indice,
      ratePercent: group.ratePercent,
      baseHtCents: Math.floor(raw),
      fraction: raw % 1,
    };
  });
  let remaining =
    amountHtCents -
    allocations.reduce((somme, ligneTableau) => somme + ligneTableau.baseHtCents, 0);
  for (const ligneTableau of [...allocations].sort(
    (a, b) => b.fraction - a.fraction || a.index - b.index,
  )) {
    if (remaining <= 0) break;
    ligneTableau.baseHtCents += 1;
    remaining -= 1;
  }
  const taxGroups = allocations.map((ligneTableau) => ({
    ratePercent: ligneTableau.ratePercent,
    baseHtCents: ligneTableau.baseHtCents,
    vatCents: Math.round((ligneTableau.baseHtCents * ligneTableau.ratePercent) / 100),
  }));
  const vatCents = taxGroups.reduce((somme, group) => somme + group.vatCents, 0);
  return { groups: taxGroups, vatCents, ttcCents: amountHtCents + vatCents };
}

export function resolveBillingAmount(saisie: {
  type: BillingType;
  contractHtCents: number;
  alreadyPreparedCents: number;
  amountHtCents?: number;
  cumulativePercent?: number;
}): number {
  const { type, contractHtCents, alreadyPreparedCents } = saisie;
  const remaining = contractHtCents - alreadyPreparedCents;
  if (remaining <= 0) throw new Error("BILLING_CONTRACT_ALREADY_PREPARED");
  let amountHtCents: number;
  if (type === "STANDARD" || type === "FINAL") {
    amountHtCents = remaining;
  } else if (saisie.cumulativePercent !== undefined) {
    if (
      !Number.isFinite(saisie.cumulativePercent) ||
      saisie.cumulativePercent <= 0 ||
      saisie.cumulativePercent > 100
    )
      throw new Error("BILLING_PERCENT_INVALID");
    const percentTarget = Math.round((contractHtCents * saisie.cumulativePercent) / 100);
    // Situation = cumulative advancement, from which previous invoices/deposits are deducted.
    // Deposit = percentage of the contract, not cumulative advancement.
    amountHtCents = type === "PROGRESS" ? percentTarget - alreadyPreparedCents : percentTarget;
  } else {
    amountHtCents = saisie.amountHtCents ?? 0;
  }
  if (!Number.isSafeInteger(amountHtCents) || amountHtCents <= 0) {
    throw new Error("BILLING_AMOUNT_INVALID");
  }
  if (amountHtCents > remaining) throw new Error("BILLING_AMOUNT_EXCEEDS_CONTRACT");
  return amountHtCents;
}

export function createBillingDraft(
  contenu: BillingPayload,
  source: BillingSource,
  saisie: {
    requestId: string;
    type: BillingType;
    amountHtCents?: number;
    cumulativePercent?: number;
    linePercentages?: Array<{ lineId: string; percent: number }>;
  },
  actorName: string,
  maintenant = new Date(),
): BillingDraft {
  const validSource = assertSource(source);
  const alreadyPreparedCents = preparedHtCents(contenu, source.quoteId);
  if (
    saisie.linePercentages &&
    (saisie.type !== "PROGRESS" ||
      saisie.amountHtCents !== undefined ||
      saisie.cumulativePercent !== undefined)
  ) {
    throw new Error("BILLING_PROGRESS_INPUT_CONFLICT");
  }
  const hasLineHistory = contenu.drafts.some(
    (brouillon) =>
      brouillon.quoteId === source.quoteId &&
      brouillon.type === "PROGRESS" &&
      Boolean(brouillon.lineProgress?.length),
  );
  if (hasLineHistory && saisie.type === "PROGRESS" && saisie.amountHtCents !== undefined) {
    throw new Error("BILLING_PROGRESS_AMOUNT_AFTER_LINES_FORBIDDEN");
  }
  const linePercentages =
    saisie.type === "PROGRESS"
      ? (saisie.linePercentages ??
        (saisie.cumulativePercent !== undefined && validSource.lines?.length
          ? validSource.lines.map((ligne) => ({
              lineId: ligne.lineId,
              percent: saisie.cumulativePercent!,
            }))
          : null))
      : null;
  const lineResult = linePercentages
    ? calculateLineProgress(contenu, validSource, linePercentages)
    : null;
  const amountHtCents =
    lineResult?.amountHtCents ??
    resolveBillingAmount({
      ...saisie,
      contractHtCents: validSource.contractHtCents,
      alreadyPreparedCents,
    });
  const tax = lineResult?.tax ?? distributeBillingTax(validSource.contractTaxGroups, amountHtCents);
  const typeLabel: Record<BillingType, string> = {
    STANDARD: "Facture classique",
    DEPOSIT: "Facture d'acompte",
    PROGRESS: "Facture de situation",
    FINAL: "Facture de solde",
  };
  const brouillon = billingDraftSchema.parse({
    ...validSource,
    id: globalThis.crypto.randomUUID(),
    requestId: saisie.requestId,
    status: "DRAFT",
    type: saisie.type,
    label: typeLabel[saisie.type],
    notes: "",
    amountHtCents,
    taxGroups: tax.groups,
    vatCents: tax.vatCents,
    totalTtcCents: tax.ttcCents,
    cumulativePercent: saisie.cumulativePercent ?? null,
    ...(lineResult ? { lineProgress: lineResult.lineProgress } : {}),
    createdAt: maintenant.toISOString(),
    createdByName: actorName,
    updatedAt: maintenant.toISOString(),
    updatedByName: actorName,
  });
  return billingDraftSchema.parse({
    ...brouillon,
    documentLines: buildInvoiceDocumentLines(brouillon, contenu),
  });
}

export function updateBillingDraft(
  contenu: BillingPayload,
  idBrouillon: string,
  saisie: {
    expectedUpdatedAt: string;
    label: string;
    notes: string;
    amountHtCents?: number;
  },
  actorName: string,
  maintenant = new Date(),
): BillingDraft {
  const brouillon = contenu.drafts.find((element) => element.id === idBrouillon);
  if (!brouillon) throw new Error("BILLING_DRAFT_NOT_FOUND");
  if (brouillon.status !== "DRAFT") throw new Error("BILLING_DRAFT_LOCKED");
  if (brouillon.updatedAt !== saisie.expectedUpdatedAt) throw new Error("BILLING_VERSION_CONFLICT");
  const alreadyPreparedCents = preparedHtCents(contenu, brouillon.quoteId, brouillon.id);
  const amountHtCents =
    brouillon.type === "STANDARD" || brouillon.type === "FINAL"
      ? brouillon.amountHtCents
      : (saisie.amountHtCents ?? brouillon.amountHtCents);
  if (amountHtCents + alreadyPreparedCents > brouillon.contractHtCents) {
    throw new Error("BILLING_AMOUNT_EXCEEDS_CONTRACT");
  }
  if (brouillon.lineProgress?.length && amountHtCents !== brouillon.amountHtCents) {
    throw new Error("BILLING_LINE_PROGRESS_EDIT_FORBIDDEN");
  }
  if (amountHtCents !== brouillon.amountHtCents) {
    const draftIndex = contenu.drafts.findIndex((element) => element.id === idBrouillon);
    if (
      contenu.drafts
        .slice(draftIndex + 1)
        .some((element) => element.quoteId === brouillon.quoteId && element.type === "PROGRESS")
    ) {
      throw new Error("BILLING_DRAFT_HAS_DEPENDENTS");
    }
  }
  const tax = distributeBillingTax(brouillon.contractTaxGroups, amountHtCents);
  const documentLines =
    brouillon.documentLines && amountHtCents !== brouillon.amountHtCents
      ? buildInvoiceDocumentLines(
          {
            ...brouillon,
            amountHtCents,
            taxGroups: tax.groups,
            vatCents: tax.vatCents,
            totalTtcCents: tax.ttcCents,
          },
          contenu,
        )
      : brouillon.documentLines;
  return billingDraftSchema.parse({
    ...brouillon,
    ...(documentLines ? { documentLines } : {}),
    label: saisie.label,
    notes: saisie.notes,
    amountHtCents,
    taxGroups: tax.groups,
    vatCents: tax.vatCents,
    totalTtcCents: tax.ttcCents,
    // Editing the amount explicitly switches the draft away from a cumulative percentage.
    cumulativePercent:
      amountHtCents !== brouillon.amountHtCents ? null : brouillon.cumulativePercent,
    updatedAt: maintenant.toISOString(),
    updatedByName: actorName,
  });
}

/** Persists an editable invoice document, independently of the signed quote. */
export function updateBillingDocument(
  contenu: BillingPayload,
  idBrouillon: string,
  saisie: {
    expectedUpdatedAt: string;
    label: string;
    notes: string;
    documentLines: BillingDocumentLine[];
    linePercentages?: Array<{ lineId: string; percent: number }>;
  },
  actorName: string,
  maintenant = new Date(),
): BillingDraft {
  const indice = contenu.drafts.findIndex((candidat) => candidat.id === idBrouillon);
  if (indice < 0) throw new Error("BILLING_DRAFT_NOT_FOUND");
  const brouillon = contenu.drafts[indice];
  if (brouillon.status !== "DRAFT") throw new Error("BILLING_DRAFT_LOCKED");
  if (brouillon.updatedAt !== saisie.expectedUpdatedAt) throw new Error("BILLING_VERSION_CONFLICT");
  const documentLines = z
    .array(billingDocumentLineSchema)
    .min(1)
    .max(1000)
    .parse(saisie.documentLines);
  if (new Set(documentLines.map((ligne) => ligne.id)).size !== documentLines.length) {
    throw new Error("BILLING_DOCUMENT_DUPLICATE_LINE");
  }
  const quoteIds = new Set((brouillon.lines ?? []).map((ligne) => ligne.lineId));
  const seenQuoteIds = new Set<string>();
  const allowedRates = new Set(brouillon.contractTaxGroups.map((group) => group.ratePercent));
  for (const ligne of documentLines) {
    if (ligne.origin === "QUOTE") {
      if (
        !ligne.sourceLineId ||
        !quoteIds.has(ligne.sourceLineId) ||
        seenQuoteIds.has(ligne.sourceLineId)
      ) {
        throw new Error("BILLING_DOCUMENT_SOURCE_LINE_INVALID");
      }
      seenQuoteIds.add(ligne.sourceLineId);
    }
    if (ligne.origin !== "TITLE" && !allowedRates.has(ligne.vatRatePercent)) {
      throw new Error("BILLING_DOCUMENT_VAT_OUTSIDE_CONTRACT");
    }
  }
  const totals = calculateInvoiceDocumentTotals(documentLines);
  const priorDrafts = contenu.drafts.slice(0, indice);
  const recalculatedProgress = saisie.linePercentages
    ? calculateLineProgress(
        { schemaVersion: 1, drafts: priorDrafts },
        brouillon,
        saisie.linePercentages,
      )
    : null;
  if (recalculatedProgress && brouillon.type !== "PROGRESS") {
    throw new Error("BILLING_PROGRESS_INPUT_CONFLICT");
  }
  // A progress correction must not save a document whose amounts disagree
  // with the cumulative progress ledger. This also protects VAT by rate.
  if (recalculatedProgress) {
    const attendu = recalculatedProgress.tax.groups;
    const reel = totals.taxGroups;
    if (
      totals.amountHtCents !== recalculatedProgress.amountHtCents ||
      attendu.some(
        (group) =>
          (reel.find((ligneTableau) => ligneTableau.ratePercent === group.ratePercent)
            ?.baseHtCents ?? 0) !== group.baseHtCents,
      ) ||
      reel.some(
        (group) =>
          (attendu.find((ligneTableau) => ligneTableau.ratePercent === group.ratePercent)
            ?.baseHtCents ?? 0) !== group.baseHtCents,
      )
    ) {
      throw new Error("BILLING_PROGRESS_DOCUMENT_MISMATCH");
    }
  }
  const progressChanged =
    recalculatedProgress?.lineProgress.some(
      (ligneTableau) =>
        ligneTableau.percent !==
        brouillon.lineProgress?.find((precedent) => precedent.lineId === ligneTableau.lineId)
          ?.percent,
    ) ?? false;
  const priorCents = preparedHtCents(contenu, brouillon.quoteId, brouillon.id);
  if (totals.amountHtCents + priorCents > brouillon.contractHtCents) {
    throw new Error("BILLING_AMOUNT_EXCEEDS_CONTRACT");
  }
  const financialChange =
    totals.amountHtCents !== brouillon.amountHtCents ||
    brouillon.taxGroups.some(
      (group) =>
        (totals.taxGroups.find((valeur) => valeur.ratePercent === group.ratePercent)?.baseHtCents ??
          0) !== group.baseHtCents,
    );
  if (
    (financialChange || progressChanged) &&
    contenu.drafts.slice(indice + 1).some((candidat) => candidat.quoteId === brouillon.quoteId)
  ) {
    throw new Error("BILLING_DRAFT_HAS_DEPENDENTS");
  }
  return billingDraftSchema.parse({
    ...brouillon,
    label: saisie.label,
    notes: saisie.notes,
    documentLines,
    ...(recalculatedProgress
      ? { lineProgress: recalculatedProgress.lineProgress, cumulativePercent: null }
      : {}),
    amountHtCents: totals.amountHtCents,
    taxGroups: totals.taxGroups,
    vatCents: totals.vatCents,
    totalTtcCents: totals.totalTtcCents,
    updatedAt: maintenant.toISOString(),
    updatedByName: actorName,
  });
}

/** Internal approval only: does not allocate a legal invoice number or issue a document. */
export function approveBillingDraft(
  contenu: BillingPayload,
  idBrouillon: string,
  expectedUpdatedAt: string,
  actorName: string,
  maintenant = new Date(),
): BillingDraft {
  const brouillon = contenu.drafts.find((element) => element.id === idBrouillon);
  if (!brouillon) throw new Error("BILLING_DRAFT_NOT_FOUND");
  if (brouillon.status !== "DRAFT") throw new Error("BILLING_DRAFT_LOCKED");
  if (brouillon.updatedAt !== expectedUpdatedAt) throw new Error("BILLING_VERSION_CONFLICT");
  const lignes = brouillon.documentLines ?? buildInvoiceDocumentLines(brouillon, contenu);
  const totals = calculateInvoiceDocumentTotals(lignes);
  if (
    totals.amountHtCents !== brouillon.amountHtCents ||
    totals.vatCents !== brouillon.vatCents ||
    totals.totalTtcCents !== brouillon.totalTtcCents ||
    brouillon.taxGroups.some(
      (group) =>
        (totals.taxGroups.find((ligneTableau) => ligneTableau.ratePercent === group.ratePercent)
          ?.baseHtCents ?? 0) !== group.baseHtCents,
    )
  )
    throw new Error("BILLING_APPROVAL_TOTALS_MISMATCH");
  return billingDraftSchema.parse({
    ...brouillon,
    documentLines: lignes,
    status: "APPROVED",
    approvedAt: maintenant.toISOString(),
    approvedByName: actorName,
    updatedAt: maintenant.toISOString(),
    updatedByName: actorName,
  });
}

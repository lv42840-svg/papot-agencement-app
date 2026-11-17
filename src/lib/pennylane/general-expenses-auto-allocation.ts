import {
  invoiceAllocationDraftSchema,
  supplierKey,
  type InvoiceAllocationDraft,
  type InvoiceSource,
} from "./purchase-allocations";

/** Prépare la validation immédiate des seules factures FG sûres et jamais traitées. */
export type InvoiceForGeneralExpenses = {
  source: InvoiceSource;
  alreadyAllocated: boolean;
  /** Un BC engagé pour ce fournisseur vise potentiellement un chantier ou le SAV. */
  possibleChantierOrder?: boolean;
};

export type GeneralExpensesPlan = {
  candidates: Array<{ invoiceId: string; draft: InvoiceAllocationDraft }>;
  matchingSupplierInvoices: number;
  skippedExisting: number;
  skippedChantierOrder: number;
  skippedDuplicate: number;
  skippedInvalid: number;
};

function duplicateInvoiceKey(source: InvoiceSource): string | null {
  if (!source.supplierId || !source.invoiceNumber.trim() || source.amountHtCents === null)
    return null;
  return [source.supplierId, supplierKey(source.invoiceNumber), source.amountHtCents].join(":");
}

/**
 * Uniquement les premières affectations PAPOT à valider en une seule opération.
 * Les factures déjà traitées, les rapprochements BC chantier possibles, les
 * avoirs, devises non EUR et doublons restent hors de l'automatisation.
 * La validation comptable dans Pennylane reste indépendante.
 */
export function planGeneralExpensesAllocations(
  invoices: readonly InvoiceForGeneralExpenses[],
  preferredSupplierIds: ReadonlySet<string>,
  createId: () => string = () => crypto.randomUUID(),
): GeneralExpensesPlan {
  const duplicates = new Map<string, number>();
  for (const invoice of invoices) {
    const key = duplicateInvoiceKey(invoice.source);
    if (key) duplicates.set(key, (duplicates.get(key) ?? 0) + 1);
  }

  const plan: GeneralExpensesPlan = {
    candidates: [],
    matchingSupplierInvoices: 0,
    skippedExisting: 0,
    skippedChantierOrder: 0,
    skippedDuplicate: 0,
    skippedInvalid: 0,
  };

  for (const invoice of invoices) {
    const source = invoice.source;
    if (!source.supplierId || !preferredSupplierIds.has(source.supplierId)) continue;
    plan.matchingSupplierInvoices += 1;

    if (invoice.alreadyAllocated) {
      plan.skippedExisting += 1;
      continue;
    }
    // Aucun lien fiable à un BC = vérification humaine dès qu'un BC chantier
    // du même fournisseur existe. Ne jamais détourner son coût vers les FG.
    if (invoice.possibleChantierOrder) {
      plan.skippedChantierOrder += 1;
      continue;
    }

    const key = duplicateInvoiceKey(source);
    if (
      !key ||
      source.amountHtCents === null ||
      source.amountHtCents <= 0 ||
      !Number.isSafeInteger(source.amountHtCents) ||
      source.amountHtCents > 100_000_000_000
    ) {
      plan.skippedInvalid += 1;
      continue;
    }
    if ((duplicates.get(key) ?? 0) !== 1) {
      plan.skippedDuplicate += 1;
      continue;
    }
    const draft = invoiceAllocationDraftSchema.parse({
      mode: "GLOBAL",
      rows: [
        {
          id: createId(),
          sourceLineId: null,
          destination: { kind: "GENERAL_EXPENSES", chantierId: null },
          amountHtCents: source.amountHtCents,
        },
      ],
      charges: [],
      orderLinks: [],
      note: "Affectation FG automatique validée dans PAPOT (Pennylane indépendant).",
    });
    plan.candidates.push({ invoiceId: source.id, draft });
  }
  return plan;
}

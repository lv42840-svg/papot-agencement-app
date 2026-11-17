import {
  invoiceAllocationDraftSchema,
  supplierKey,
  type InvoiceAllocationDraft,
  type InvoiceSource,
} from "./purchase-allocations";

/** Planifie uniquement les premières affectations : ne modifie jamais un travail déjà commencé. */
export type InvoiceForGeneralExpenses = {
  source: InvoiceSource;
  alreadyAllocated: boolean;
};

export type GeneralExpensesPlan = {
  candidates: Array<{ invoiceId: string; draft: InvoiceAllocationDraft }>;
  matchingSupplierInvoices: number;
  skippedExisting: number;
  skippedDuplicate: number;
  skippedInvalid: number;
};

function duplicateInvoiceKey(source: InvoiceSource): string | null {
  if (!source.supplierId || !source.invoiceNumber.trim() || source.amountHtCents === null)
    return null;
  return [source.supplierId, supplierKey(source.invoiceNumber), source.amountHtCents].join(":");
}

/**
 * Affectation en brouillon seulement : la validation opérationnelle et comptable
 * reste explicite. Les avoirs, devises non EUR, doublons et dossiers existants
 * restent entre les mains de l'utilisateur.
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
      note: "Pré-affectation automatique FG : à contrôler et valider dans PAPOT.",
    });
    plan.candidates.push({ invoiceId: source.id, draft });
  }
  return plan;
}

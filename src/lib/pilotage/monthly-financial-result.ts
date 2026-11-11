import { z } from "zod";
import { summarizeIssuedInvoices, type IssuedInvoiceRecord } from "../billing/issued-summary";

export const financialMonthSchema = z.string().regex(/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/);

/** Completeness must be certified for the selected month, not merely an API connection. */
export type MonthlySource<T> = {
  month: string;
  complete: boolean;
  records: readonly T[];
};

/**
 * Canonical adapter input, NOT a new supplier-invoice entry form.
 * id must include the source company identity. Credit amounts are absolute here.
 * ADVANCE is cash/prepayment, not an additional expense alongside the final invoice.
 * A supplier invoice is counted once at company level even if its analytical allocation is pending.
 */
export type RecognizedSupplierInvoice = {
  id: string;
  documentDate: string;
  type: "INVOICE" | "CREDIT_NOTE";
  status: "VALIDATED" | "DRAFT" | "CANCELLED";
  recognition: "EXPENSE" | "ADVANCE";
  amountHtCents: number;
};

export type MonthlyPayrollExpense = {
  month: string;
  complete: boolean;
  /** Full payroll expense, excluding holding invoices already in the supplier source. */
  totalExpenseCents: number;
};

export type MonthlyFinancialResult = {
  month: string;
  invoicedRevenueCents: number | null;
  supplierExpenseCents: number | null;
  payrollExpenseCents: number | null;
  totalExpenseCents: number | null;
  resultCents: number | null;
  complete: boolean;
};

const supplierSchema = z.object({
  id: z.string().min(1),
  documentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((valeur) => {
      const date = new Date(`${valeur}T12:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === valeur;
    }),
  type: z.enum(["INVOICE", "CREDIT_NOTE"]),
  status: z.enum(["VALIDATED", "DRAFT", "CANCELLED"]),
  recognition: z.enum(["EXPENSE", "ADVANCE"]),
  amountHtCents: z.number().int().safe().nonnegative(),
});

function money(valeur: number): number {
  if (!Number.isSafeInteger(valeur)) throw new Error("MONTHLY_FINANCIAL_AMOUNT_INVALID");
  return valeur;
}

function isComplete(source: { month: string; complete: boolean } | null, mois: string): boolean {
  return source?.complete === true && source.month === mois;
}

/**
 * Invoices and payroll are source totals; analytical allocations only explain them.
 * There is deliberately no quotes, purchase orders, chantier-status filter, or hour-cost input:
 * commitments must never be added to invoices, nor allocated labor to total payroll.
 */
export function calculateMonthlyFinancialResult(saisie: {
  month: string;
  customerInvoices: MonthlySource<IssuedInvoiceRecord> | null;
  supplierInvoices: MonthlySource<RecognizedSupplierInvoice> | null;
  payroll: MonthlyPayrollExpense | null;
}): MonthlyFinancialResult {
  const mois = financialMonthSchema.parse(saisie.month);
  const revenueComplete = isComplete(saisie.customerInvoices, mois);
  const suppliersComplete = isComplete(saisie.supplierInvoices, mois);
  const payrollComplete = isComplete(saisie.payroll, mois);
  const invoicedRevenueCents = revenueComplete
    ? summarizeIssuedInvoices(
        saisie.customerInvoices!.records,
        true,
        new Date(`${mois}-15T12:00:00Z`),
      ).monthly.amountHtCents
    : null;
  let supplierExpenseCents: number | null = null;
  if (suppliersComplete) {
    supplierExpenseCents = 0;
    const identifiants = new Set<string>();
    for (const raw of saisie.supplierInvoices!.records) {
      const element = supplierSchema.parse(raw);
      if (identifiants.has(element.id)) throw new Error("MONTHLY_SUPPLIER_INVOICE_DUPLICATE");
      identifiants.add(element.id);
      if (
        element.documentDate.slice(0, 7) !== mois ||
        element.status !== "VALIDATED" ||
        element.recognition !== "EXPENSE"
      )
        continue;
      supplierExpenseCents = money(
        supplierExpenseCents +
          (element.type === "CREDIT_NOTE" ? -element.amountHtCents : element.amountHtCents),
      );
    }
  }
  const payrollExpenseCents = payrollComplete ? money(saisie.payroll!.totalExpenseCents) : null;
  if (payrollExpenseCents !== null && payrollExpenseCents < 0)
    throw new Error("MONTHLY_PAYROLL_AMOUNT_INVALID");
  const totalExpenseCents =
    supplierExpenseCents === null || payrollExpenseCents === null
      ? null
      : money(supplierExpenseCents + payrollExpenseCents);
  const resultCents =
    invoicedRevenueCents === null || totalExpenseCents === null
      ? null
      : money(invoicedRevenueCents - totalExpenseCents);
  return {
    month: mois,
    invoicedRevenueCents,
    supplierExpenseCents,
    payrollExpenseCents,
    totalExpenseCents,
    resultCents,
    complete: resultCents !== null,
  };
}

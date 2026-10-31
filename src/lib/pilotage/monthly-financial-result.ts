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
  documentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
  type: z.enum(["INVOICE", "CREDIT_NOTE"]),
  status: z.enum(["VALIDATED", "DRAFT", "CANCELLED"]),
  recognition: z.enum(["EXPENSE", "ADVANCE"]),
  amountHtCents: z.number().int().safe().nonnegative(),
});

function money(value: number): number {
  if (!Number.isSafeInteger(value)) throw new Error("MONTHLY_FINANCIAL_AMOUNT_INVALID");
  return value;
}

function isComplete(source: { month: string; complete: boolean } | null, month: string): boolean {
  return source?.complete === true && source.month === month;
}

/**
 * Invoices and payroll are source totals; analytical allocations only explain them.
 * There is deliberately no quotes, purchase orders, chantier-status filter, or hour-cost input:
 * commitments must never be added to invoices, nor allocated labor to total payroll.
 */
export function calculateMonthlyFinancialResult(input: {
  month: string;
  customerInvoices: MonthlySource<IssuedInvoiceRecord> | null;
  supplierInvoices: MonthlySource<RecognizedSupplierInvoice> | null;
  payroll: MonthlyPayrollExpense | null;
}): MonthlyFinancialResult {
  const month = financialMonthSchema.parse(input.month);
  const revenueComplete = isComplete(input.customerInvoices, month);
  const suppliersComplete = isComplete(input.supplierInvoices, month);
  const payrollComplete = isComplete(input.payroll, month);
  const invoicedRevenueCents = revenueComplete
    ? summarizeIssuedInvoices(input.customerInvoices!.records, true, new Date(`${month}-15T12:00:00Z`)).monthly.amountHtCents
    : null;
  let supplierExpenseCents: number | null = null;
  if (suppliersComplete) {
    supplierExpenseCents = 0;
    const ids = new Set<string>();
    for (const raw of input.supplierInvoices!.records) {
      const item = supplierSchema.parse(raw);
      if (ids.has(item.id)) throw new Error("MONTHLY_SUPPLIER_INVOICE_DUPLICATE");
      ids.add(item.id);
      if (item.documentDate.slice(0, 7) !== month || item.status !== "VALIDATED" || item.recognition !== "EXPENSE") continue;
      supplierExpenseCents = money(supplierExpenseCents + (item.type === "CREDIT_NOTE" ? -item.amountHtCents : item.amountHtCents));
    }
  }
  const payrollExpenseCents = payrollComplete ? money(input.payroll!.totalExpenseCents) : null;
  if (payrollExpenseCents !== null && payrollExpenseCents < 0) throw new Error("MONTHLY_PAYROLL_AMOUNT_INVALID");
  const totalExpenseCents = supplierExpenseCents === null || payrollExpenseCents === null
    ? null : money(supplierExpenseCents + payrollExpenseCents);
  const resultCents = invoicedRevenueCents === null || totalExpenseCents === null
    ? null : money(invoicedRevenueCents - totalExpenseCents);
  return {
    month,
    invoicedRevenueCents,
    supplierExpenseCents,
    payrollExpenseCents,
    totalExpenseCents,
    resultCents,
    complete: resultCents !== null,
  };
}

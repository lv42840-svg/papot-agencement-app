/**
 * Only actual issued invoices (and issued credit notes) contribute to CA.
 * Internal PAPOT billing drafts, including APPROVED drafts, must NEVER enter here.
 */
export type IssuedInvoiceRecord = {
  id: string;
  issuedAt: string;
  type: "INVOICE" | "CREDIT_NOTE";
  status: "ISSUED" | "DRAFT" | "CANCELLED";
  amountHtCents: number;
};

export type IssuedInvoicePeriod = {
  amountHtCents: number | null;
  invoiceCount: number | null;
};

export type IssuedInvoiceSummary = {
  year: string;
  month: string;
  connected: boolean;
  yearly: IssuedInvoicePeriod;
  monthly: IssuedInvoicePeriod;
};

function parisMonth(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}`;
}

/** Pass connected=false while no provider can certify issued invoices. Never return 0 as a substitute. */
export function summarizeIssuedInvoices(
  records: readonly IssuedInvoiceRecord[],
  connected: boolean,
  now = new Date(),
): IssuedInvoiceSummary {
  const month = parisMonth(now);
  const year = month.slice(0, 4);
  if (!connected) {
    return {
      year,
      month,
      connected: false,
      yearly: { amountHtCents: null, invoiceCount: null },
      monthly: { amountHtCents: null, invoiceCount: null },
    };
  }
  const ids = new Set<string>();
  const valid = records.filter((item) => {
    if (ids.has(item.id)) throw new Error("ISSUED_INVOICE_DUPLICATE");
    ids.add(item.id);
    if (!Number.isSafeInteger(item.amountHtCents) || item.amountHtCents < 0) {
      throw new Error("ISSUED_INVOICE_AMOUNT_INVALID");
    }
    return item.status === "ISSUED";
  });
  const forPeriod = (period: string): IssuedInvoicePeriod => {
    const selected = valid.filter((item) => {
      const time = new Date(item.issuedAt);
      if (!Number.isFinite(time.getTime())) throw new Error("ISSUED_INVOICE_DATE_INVALID");
      return parisMonth(time).startsWith(period);
    });
    const amountHtCents = selected.reduce(
      (sum, item) => sum + (item.type === "CREDIT_NOTE" ? -item.amountHtCents : item.amountHtCents),
      0,
    );
    if (!Number.isSafeInteger(amountHtCents)) throw new Error("ISSUED_INVOICE_SUM_INVALID");
    return { amountHtCents, invoiceCount: selected.filter((item) => item.type === "INVOICE").length };
  };
  return { year, month, connected: true, yearly: forPeriod(year), monthly: forPeriod(month) };
}

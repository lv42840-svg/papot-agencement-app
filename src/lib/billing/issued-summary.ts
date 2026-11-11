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
  const parties = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
    })
      .formatToParts(date)
      .map((partie) => [partie.type, partie.value]),
  );
  return `${parties.year}-${parties.month}`;
}

/** Pass connected=false while no provider can certify issued invoices. Never return 0 as a substitute. */
export function summarizeIssuedInvoices(
  factures: readonly IssuedInvoiceRecord[],
  connecte: boolean,
  maintenant = new Date(),
): IssuedInvoiceSummary {
  const mois = parisMonth(maintenant);
  const annee = mois.slice(0, 4);
  if (!connecte) {
    return {
      year: annee,
      month: mois,
      connected: false,
      yearly: { amountHtCents: null, invoiceCount: null },
      monthly: { amountHtCents: null, invoiceCount: null },
    };
  }
  const identifiants = new Set<string>();
  const facturesValides = factures.filter((facture) => {
    if (identifiants.has(facture.id)) throw new Error("ISSUED_INVOICE_DUPLICATE");
    identifiants.add(facture.id);
    if (!Number.isSafeInteger(facture.amountHtCents) || facture.amountHtCents < 0) {
      throw new Error("ISSUED_INVOICE_AMOUNT_INVALID");
    }
    return facture.status === "ISSUED";
  });
  const pourPeriode = (periode: string): IssuedInvoicePeriod => {
    const facturesSelectionnees = facturesValides.filter((facture) => {
      const dateEmission = new Date(facture.issuedAt);
      if (!Number.isFinite(dateEmission.getTime())) {
        throw new Error("ISSUED_INVOICE_DATE_INVALID");
      }
      return parisMonth(dateEmission).startsWith(periode);
    });
    const montantHtCentimes = facturesSelectionnees.reduce(
      (somme, facture) =>
        somme +
        (facture.type === "CREDIT_NOTE"
          ? -facture.amountHtCents
          : facture.amountHtCents),
      0,
    );
    if (!Number.isSafeInteger(montantHtCentimes)) {
      throw new Error("ISSUED_INVOICE_SUM_INVALID");
    }
    return {
      amountHtCents: montantHtCentimes,
      invoiceCount: facturesSelectionnees.filter(
        (facture) => facture.type === "INVOICE",
      ).length,
    };
  };
  return {
    year: annee,
    month: mois,
    connected: true,
    yearly: pourPeriode(annee),
    monthly: pourPeriode(mois),
  };
}

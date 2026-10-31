import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calculateMonthlyFinancialResult, type RecognizedSupplierInvoice } from "../src/lib/pilotage/monthly-financial-result";
import { calculateChantierProfitability } from "../src/lib/chantiers/profitability";
import type { ChantierRecord } from "../src/lib/chantiers/domain";
import type { NativeQuotesPayload } from "../src/lib/quotes/store";

const month = "2026-10";
const expense = (changes: Partial<RecognizedSupplierInvoice> = {}): RecognizedSupplierInvoice => ({
  id: "company:invoice:1", documentDate: "2026-10-10", type: "INVOICE", status: "VALIDATED", recognition: "EXPENSE", amountHtCents: 30000, ...changes,
});
const source = (changes: Partial<Parameters<typeof calculateMonthlyFinancialResult>[0]> = {}) => ({
  month,
  customerInvoices: { month, complete: true, records: [] },
  supplierInvoices: { month, complete: true, records: [] },
  payroll: { month, complete: true, totalExpenseCents: 0 },
  ...changes,
});

describe("resultat mensuel issu des seules sources reelles", () => {
  it("ne remplace pas une source absente par zero", () => {
    const result = calculateMonthlyFinancialResult({ month, customerInvoices: null, supplierInvoices: null, payroll: null });
    expect(result.invoicedRevenueCents).toBeNull();
    expect(result.supplierExpenseCents).toBeNull();
    expect(result.payrollExpenseCents).toBeNull();
    expect(result.resultCents).toBeNull();
    expect(result.complete).toBe(false);
  });
  it("distingue zero certifie d'une extraction incomplete ou du mauvais mois", () => {
    expect(calculateMonthlyFinancialResult(source()).resultCents).toBe(0);
    expect(calculateMonthlyFinancialResult(source({ supplierInvoices: { month, complete: false, records: [] } })).resultCents).toBeNull();
    expect(calculateMonthlyFinancialResult(source({ payroll: { month: "2026-09", complete: true, totalExpenseCents: 0 } })).resultCents).toBeNull();
  });
  it("deduit les avoirs, ignore brouillons, avances et autres mois, sans ajouter les ventilations", () => {
    const result = calculateMonthlyFinancialResult(source({
      customerInvoices: { month, complete: true, records: [
        { id: "sale", issuedAt: "2026-10-10T12:00:00Z", type: "INVOICE", status: "ISSUED", amountHtCents: 100000 },
        { id: "credit", issuedAt: "2026-10-11T12:00:00Z", type: "CREDIT_NOTE", status: "ISSUED", amountHtCents: 10000 },
        { id: "draft", issuedAt: "2026-10-12T12:00:00Z", type: "INVOICE", status: "DRAFT", amountHtCents: 900000 },
      ] },
      supplierInvoices: { month, complete: true, records: [
        expense(), expense({ id: "credit", type: "CREDIT_NOTE", amountHtCents: 5000 }),
        expense({ id: "advance", recognition: "ADVANCE", amountHtCents: 10000 }),
        expense({ id: "draft", status: "DRAFT" }), expense({ id: "old", documentDate: "2026-09-30" }),
      ] },
      payroll: { month, complete: true, totalExpenseCents: 20000 },
    }));
    expect(result).toMatchObject({ invoicedRevenueCents: 90000, supplierExpenseCents: 25000, payrollExpenseCents: 20000, totalExpenseCents: 45000, resultCents: 45000, complete: true });
  });
  it("conserve les charges sans affectation ou relatives a un chantier annule", () => {
    // The financial source total is deliberately independent of all chantier statuses/allocations.
    const result = calculateMonthlyFinancialResult(source({ supplierInvoices: { month, complete: true, records: [expense()] } }));
    expect(result.supplierExpenseCents).toBe(30000);
    expect(result.resultCents).toBe(-30000);
  });
  it("refuse doublons, dates impossibles et mois invalides", () => {
    expect(() => calculateMonthlyFinancialResult(source({ supplierInvoices: { month, complete: true, records: [expense(), expense()] } }))).toThrow("MONTHLY_SUPPLIER_INVOICE_DUPLICATE");
    expect(() => calculateMonthlyFinancialResult(source({ supplierInvoices: { month, complete: true, records: [expense({ documentDate: "2026-02-30" })] } }))).toThrow();
    expect(() => calculateMonthlyFinancialResult(source({ month: "2026-13" }))).toThrow();
  });
  it("ne compte pas deux fois la holding et la main-d'oeuvre repartie", () => {
    const result = calculateMonthlyFinancialResult(source({
      supplierInvoices: { month, complete: true, records: [expense({ id: "holding", amountHtCents: 10000 })] },
      payroll: { month, complete: true, totalExpenseCents: 20000 },
    }));
    expect(result.totalExpenseCents).toBe(30000);
  });
});

describe("marge chantier reelle distincte du vendu", () => {
  const site = { actualHours: { be: 1, workshop: 2, install: 3 } } as ChantierRecord;
  const quotes = { quotes: [] } as unknown as NativeQuotesPayload;
  it("reste indisponible sans facturation, meme si tous les couts sont connus", () => {
    const result = calculateChantierProfitability(site, null, quotes, { laborCostCents: 10000, purchaseCostCents: 20000 }, 50000);
    expect(result.actualTotalCostCents).toBe(30000);
    expect(result.knownCostCommitmentsCents).toBe(60000);
    expect(result.actualMarginCents).toBeNull();
  });
  it("utilise le facture et non le devis, meme sans devis retenu", () => {
    const result = calculateChantierProfitability(site, null, quotes, { laborCostCents: 10000, purchaseCostCents: 20000, invoicedRevenueCents: 60000 }, 50000);
    expect(result.soldCents).toBeNull();
    expect(result.actualMarginCents).toBe(30000);
    expect(result.actualRevenueCents).toBe(60000);
  });
  it("accepte zero facture connu et un avoir net sans fabriquer une marge positive", () => {
    expect(calculateChantierProfitability(site, null, quotes, { laborCostCents: 100, purchaseCostCents: 0, invoicedRevenueCents: 0 }).actualMarginCents).toBe(-100);
    expect(calculateChantierProfitability(site, null, quotes, { laborCostCents: 0, purchaseCostCents: -100, invoicedRevenueCents: -200 }).actualMarginCents).toBe(-100);
  });
  it("garde le futur flux mensuel en lecture seule, sans donner acces aux salaires via pilotage", () => {
    const api = readFileSync("src/app/api/desktop/pilotage/monthly-position/route.ts", "utf8");
    expect(api).toContain('requireModuleRequestContext("pilotage", "READ")');
    expect(api).toContain('"dashboard.view_global"');
    expect(api).toContain('"payroll", "READ"');
    expect(api).toContain("canReadPayroll ? readMonthlyLaborCosts()");
    expect(api).toContain("customerInvoices: null");
    expect(api).toContain("supplierInvoices: null");
    expect(api).not.toContain("export async function POST");
  });
});

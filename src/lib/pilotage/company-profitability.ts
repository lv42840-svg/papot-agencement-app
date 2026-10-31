import type { ChantierHours, ChantierRecord } from "../chantiers/domain";
import { calculateChantierProfitability } from "../chantiers/profitability";
import type { ChantierLaborCostEstimate } from "../payroll/chantier-labor-cost";
import type { CommercialCase } from "../commercial/domain";
import type { NativeQuotesPayload } from "../quotes/store";
import type { PurchaseOrdersPayload } from "../purchases/domain";
import { committedPurchaseTotal } from "../purchases/domain";

export type CompanyProfitabilityRow = {
  chantierId: string;
  name: string;
  clientName: string;
  status: ChantierRecord["status"];
  launchYear: number;
  soldCents: number | null;
  plannedLaborCostCents: number | null;
  plannedOtherCostCents: number | null;
  plannedTotalCostCents: number | null;
  plannedMarginCents: number | null;
  actualLaborCostCents: number | null;
  actualLaborCostProvisional: boolean;
  actualPurchaseCostCents: number | null;
  actualTotalCostCents: number | null;
  actualMarginCents: number | null;
  knownCostCommitmentsCents: number | null;
  remainingCostBudgetCents: number | null;
  remainingLaborBudgetCents: number | null;
  committedPurchasesCents: number;
  plannedPurchasesCents: number | null;
  plannedHours: number;
  actualHours: number;
  missingData: boolean;
};

export type CompanyProfitabilityTotals = {
  chantierCount: number;
  incompleteCount: number;
  soldCents: number | null;
  plannedLaborCostCents: number | null;
  plannedOtherCostCents: number | null;
  plannedTotalCostCents: number | null;
  plannedMarginCents: number | null;
  actualLaborCostCents: number | null;
  actualPurchaseCostCents: number | null;
  actualTotalCostCents: number | null;
  actualMarginCents: number | null;
  knownCostCommitmentsCents: number | null;
  remainingCostBudgetCents: number | null;
  remainingLaborBudgetCents: number | null;
  budgetOverrunCount: number;
  laborBudgetOverrunCount: number;
  provisionalLaborCount: number;
  committedPurchasesCents: number;
  plannedHours: number;
  actualHours: number;
};

export function calculateCompanyProfitability(
  chantiers: readonly ChantierRecord[],
  cases: readonly CommercialCase[],
  quotes: NativeQuotesPayload,
  purchases: PurchaseOrdersPayload,
  actualHoursBySite: ReadonlyMap<string, ChantierHours> = new Map(),
  laborCostsBySite: ReadonlyMap<string, ChantierLaborCostEstimate> = new Map(),
): CompanyProfitabilityRow[] {
  const casesById = new Map(cases.map((item) => [item.id, item]));
  return chantiers
    .filter((site) => site.status !== "CANCELLED")
    .map((site) => {
      const caseRecord = casesById.get(site.sourceCommercialCaseId) ?? null;
      const hours = actualHoursBySite.get(site.id);
      const labor = laborCostsBySite.get(site.id);
      const projection = calculateChantierProfitability(
        hours ? { ...site, actualHours: hours } : site,
        caseRecord,
        quotes,
        { laborCostCents: labor?.costCents ?? null, purchaseCostCents: null },
        committedPurchaseTotal(purchases, site.id),
      );
      return {
        chantierId: site.id,
        name: site.name,
        clientName: site.clientName ?? site.companyName ?? "",
        status: site.status,
        launchYear: site.launchYear,
        soldCents: projection.soldCents,
        plannedLaborCostCents: projection.plannedLaborCostCents,
        plannedOtherCostCents: projection.plannedDisbursementCents,
        plannedTotalCostCents: projection.plannedTotalCostCents,
        plannedMarginCents: projection.plannedMarginCents,
        actualLaborCostCents: projection.actualLaborCostCents,
        actualLaborCostProvisional: labor?.provisional ?? false,
        actualPurchaseCostCents: projection.actualPurchaseCostCents,
        actualTotalCostCents: projection.actualTotalCostCents,
        actualMarginCents: projection.actualMarginCents,
        knownCostCommitmentsCents: projection.knownCostCommitmentsCents,
        remainingCostBudgetCents: projection.remainingCostBudgetCents,
        remainingLaborBudgetCents: projection.remainingLaborBudgetCents,
        committedPurchasesCents: projection.committedPurchasesCents ?? 0,
        plannedPurchasesCents: projection.plannedPurchasesCents,
        plannedHours: projection.plannedHours.total,
        actualHours: projection.actualHours.total,
        missingData:
          projection.plannedMarginCents === null ||
          projection.plannedLaborCostCents === null ||
          projection.soldCents === null,
      };
    });
}

/** Never present a partial financial total as a complete enterprise margin. */
export function companyProfitabilityTotals(
  rows: readonly CompanyProfitabilityRow[],
): CompanyProfitabilityTotals {
  const incompleteCount = rows.filter((row) => row.missingData).length;
  const sum = (
    key:
      | "soldCents"
      | "plannedLaborCostCents"
      | "plannedOtherCostCents"
      | "plannedTotalCostCents"
      | "plannedMarginCents"
      | "actualLaborCostCents"
      | "actualPurchaseCostCents"
      | "actualTotalCostCents"
      | "actualMarginCents"
      | "knownCostCommitmentsCents"
      | "remainingCostBudgetCents"
      | "remainingLaborBudgetCents",
  ): number | null =>
    rows.some((row) => row[key] === null)
      ? null
      : rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  return {
    chantierCount: rows.length,
    incompleteCount,
    soldCents: sum("soldCents"),
    plannedLaborCostCents: sum("plannedLaborCostCents"),
    plannedOtherCostCents: sum("plannedOtherCostCents"),
    plannedTotalCostCents: sum("plannedTotalCostCents"),
    plannedMarginCents: sum("plannedMarginCents"),
    actualLaborCostCents: sum("actualLaborCostCents"),
    actualPurchaseCostCents: sum("actualPurchaseCostCents"),
    actualTotalCostCents: sum("actualTotalCostCents"),
    actualMarginCents: sum("actualMarginCents"),
    knownCostCommitmentsCents: sum("knownCostCommitmentsCents"),
    remainingCostBudgetCents: sum("remainingCostBudgetCents"),
    remainingLaborBudgetCents: sum("remainingLaborBudgetCents"),
    budgetOverrunCount: rows.filter(
      (row) => row.remainingCostBudgetCents !== null && row.remainingCostBudgetCents < 0,
    ).length,
    laborBudgetOverrunCount: rows.filter(
      (row) => row.remainingLaborBudgetCents !== null && row.remainingLaborBudgetCents < 0,
    ).length,
    provisionalLaborCount: rows.filter((row) => row.actualLaborCostProvisional).length,
    committedPurchasesCents: rows.reduce((total, row) => total + row.committedPurchasesCents, 0),
    plannedHours: rows.reduce((total, row) => total + row.plannedHours, 0),
    actualHours: rows.reduce((total, row) => total + row.actualHours, 0),
  };
}

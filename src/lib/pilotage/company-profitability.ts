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
  const casesById = new Map(cases.map((element) => [element.id, element]));
  return chantiers
    .filter((site) => site.status !== "CANCELLED")
    .map((site) => {
      const caseRecord = casesById.get(site.sourceCommercialCaseId) ?? null;
      const heures = actualHoursBySite.get(site.id);
      const labor = laborCostsBySite.get(site.id);
      const projection = calculateChantierProfitability(
        heures ? { ...site, actualHours: heures } : site,
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
  lignesTableau: readonly CompanyProfitabilityRow[],
): CompanyProfitabilityTotals {
  const incompleteCount = lignesTableau.filter((ligneTableau) => ligneTableau.missingData).length;
  const somme = (
    cle:
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
    lignesTableau.some((ligneTableau) => ligneTableau[cle] === null)
      ? null
      : lignesTableau.reduce((total, ligneTableau) => total + (ligneTableau[cle] ?? 0), 0);
  return {
    chantierCount: lignesTableau.length,
    incompleteCount,
    soldCents: somme("soldCents"),
    plannedLaborCostCents: somme("plannedLaborCostCents"),
    plannedOtherCostCents: somme("plannedOtherCostCents"),
    plannedTotalCostCents: somme("plannedTotalCostCents"),
    plannedMarginCents: somme("plannedMarginCents"),
    actualLaborCostCents: somme("actualLaborCostCents"),
    actualPurchaseCostCents: somme("actualPurchaseCostCents"),
    actualTotalCostCents: somme("actualTotalCostCents"),
    actualMarginCents: somme("actualMarginCents"),
    knownCostCommitmentsCents: somme("knownCostCommitmentsCents"),
    remainingCostBudgetCents: somme("remainingCostBudgetCents"),
    remainingLaborBudgetCents: somme("remainingLaborBudgetCents"),
    budgetOverrunCount: lignesTableau.filter(
      (ligneTableau) =>
        ligneTableau.remainingCostBudgetCents !== null && ligneTableau.remainingCostBudgetCents < 0,
    ).length,
    laborBudgetOverrunCount: lignesTableau.filter(
      (ligneTableau) =>
        ligneTableau.remainingLaborBudgetCents !== null &&
        ligneTableau.remainingLaborBudgetCents < 0,
    ).length,
    provisionalLaborCount: lignesTableau.filter(
      (ligneTableau) => ligneTableau.actualLaborCostProvisional,
    ).length,
    committedPurchasesCents: lignesTableau.reduce(
      (total, ligneTableau) => total + ligneTableau.committedPurchasesCents,
      0,
    ),
    plannedHours: lignesTableau.reduce(
      (total, ligneTableau) => total + ligneTableau.plannedHours,
      0,
    ),
    actualHours: lignesTableau.reduce((total, ligneTableau) => total + ligneTableau.actualHours, 0),
  };
}

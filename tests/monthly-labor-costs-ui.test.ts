import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("monthly salary costs in the Heures screen", () => {
  it("keeps the original hours entry and adds the monthly costs tab", () => {
    const page = source("../src/app/heures/page.tsx");
    const tabs = source("../src/components/heures-tabs.tsx");
    const monthly = source("../src/components/monthly-labor-costs-workspace.tsx");
    expect(page).toContain("<ActualHoursWorkspace");
    expect(page).toContain("<HeuresTabs");
    expect(tabs).toContain("Saisie des heures");
    expect(tabs).toContain("Coûts mensuels");
    expect(monthly).toContain("Coût employeur (€)");
    expect(monthly).toContain("Heures travaillées");
    expect(monthly).toContain('action: "saveMonthlyLaborCost"');
  });

  it("isolates salary amounts behind the Paie module permissions", () => {
    const api = source("../src/app/api/desktop/payroll/monthly-labor-costs/route.ts");
    const chantierApi = source("../src/app/api/desktop/chantiers/route.ts");
    expect(api).toContain('requireModuleRequestContext("payroll", "READ")');
    expect(api).toContain('requireModuleRequestContext("payroll", "WRITE")');
    expect(chantierApi).toContain('hasModuleAccess(user.id, "payroll", "READ")');
  });

  it("connects monthly salaries to profitability without modifying planned or actual hours", () => {
    const api = source("../src/app/api/desktop/chantiers/route.ts");
    const workspace = source("../src/components/chantier-workspace.tsx");
    expect(api).toContain("calculateChantierLaborCostEstimate");
    expect(api).toContain("provisionalLaborCostsByChantier");
    expect(api).toContain("actualLaborCostsByChantier");
    expect(workspace).toContain("actualLaborCostsByChantier");
    expect(workspace).toContain("purchaseCostCents: null");
  });
});

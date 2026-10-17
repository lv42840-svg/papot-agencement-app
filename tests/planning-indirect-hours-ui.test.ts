import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("SAV and general overhead hour allocation", () => {
  it("lets staff register each category alongside chantier hours, without a chantier", () => {
    const ui = source("../src/components/actual-hours-workspace.tsx");
    expect(ui).toContain("Heures hors chantier");
    expect(ui).toContain("Frais généraux");
    expect(ui).toContain('"SAV"');
    expect(ui).toContain('action: "saveIndirectHoursRow"');
    expect(ui).toContain("const totalForWeek = totalSiteWeek + totalIndirectWeek");
    expect(ui).toContain("Ces heures sont valorisées");
    expect(ui).toContain('action: "saveActualHoursRow"');
  });

  it("secures SAV entry behind the existing weekly actual-hours permission", () => {
    const api = source("../src/app/api/desktop/planning/actual-hours/route.ts");
    expect(api).toContain('requireModuleRequestContext("planning", "WRITE")');
    expect(api).toContain('requireSpecialPermission(context.user, "planning.enter_actual_hours")');
    expect(api).toContain("if (!isPlanningWeekPast(input.week))");
    expect(api).toContain("indirectHoursRowSchema.parse");
    expect(api).toContain("applyIndirectHoursRow");
    expect(api).toContain("indirectRecords:");
  });

  it("excludes SAV/overhead from chantier margin and globalizes their expense", () => {
    const chantier = source("../src/lib/payroll/chantier-labor-cost.ts");
    const company = source("../src/lib/payroll/indirect-labor-cost.ts");
    const dashboard = source("../src/app/api/desktop/dashboard/sold-summary/route.ts");
    const ui = source("../src/components/dashboard-sold-margin-stat.tsx");
    expect(chantier).not.toContain("indirectHours");
    expect(company).toContain("calculateIndicativeCompanyMarginCents");
    expect(dashboard).toContain("calculateIndirectLaborCostsForPeriod");
    expect(dashboard).toContain('hasModuleAccess(context.user.id, "payroll", "READ")');
    expect(ui).toContain("Marge globale indicative");
    expect(ui).toContain("Frais généraux / an");
    expect(ui).toContain("Heures SAV / an");
    expect(ui).toContain("Ce n’est pas le résultat réel");
  });
});

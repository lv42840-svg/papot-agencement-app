import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calculateMonthlyConsumption } from "../src/lib/pilotage/monthly-consumption";
import type { PlanningPayload } from "../src/lib/planning/domain";
import type { MonthlyLaborCostRecord } from "../src/lib/payroll/monthly-labor-costs";

const person = "11111111-1111-4111-8111-111111111111";
const site = "22222222-2222-4222-8222-222222222222";
const planning = (): Pick<PlanningPayload, "actualHours" | "indirectHours" | "peopleCapacity"> => ({
  actualHours: [
    { chantierId: site, userId: person, week: "2026-W41", activity: "WORKSHOP", hours: 10 },
  ],
  indirectHours: [
    { userId: person, week: "2026-W41", category: "SAV", hours: 5 },
    { userId: person, week: "2026-W41", category: "GENERAL", hours: 5 },
  ],
  peopleCapacity: [],
});
const record = (month: string, cost = 320000): MonthlyLaborCostRecord => ({
  personId: person,
  month,
  employerCostCents: cost,
  workedHours: 160,
  updatedAt: "2026-10-01T10:00:00Z",
  updatedBy: "Nadia",
});

describe("consommation mensuelle tous postes", () => {
  it("regroupe chantier, SAV et frais generaux sans doubler les heures", () => {
    const result = calculateMonthlyConsumption(
      "2026-10",
      planning(),
      [record("2026-09")],
      new Date("2026-10-15T12:00:00Z"),
    );
    expect(result.chantier).toMatchObject({ hours: 10, valuedCostCents: 20000 });
    expect(result.sav).toMatchObject({ hours: 5, valuedCostCents: 10000 });
    expect(result.generalExpenses).toMatchObject({ hours: 5, valuedCostCents: 10000 });
    expect(result.total).toEqual({ hours: 20, valuedCostCents: 40000, unvaluedHours: 0 });
    expect(result.provisional).toBe(true);
  });
  it("utilise la paie du mois clos, pas celle du mois precedent", () => {
    const result = calculateMonthlyConsumption(
      "2026-10",
      planning(),
      [record("2026-09"), record("2026-10", 400000)],
      new Date("2026-11-05T12:00:00Z"),
    );
    expect(result.total.valuedCostCents).toBe(50000);
    expect(result.provisional).toBe(false);
  });
  it("garde le total indisponible si la paie manque", () => {
    const result = calculateMonthlyConsumption(
      "2026-10",
      planning(),
      [],
      new Date("2026-11-05T12:00:00Z"),
    );
    expect(result.total.hours).toBe(20);
    expect(result.total.unvaluedHours).toBe(20);
    expect(result.total.valuedCostCents).toBeNull();
  });
  it("ne divulgue aucun cout salarial sans droit, meme avec zero heure", () => {
    const result = calculateMonthlyConsumption("2026-10", planning(), null);
    expect(result.chantier.valuedCostCents).toBeNull();
    expect(result.total.valuedCostCents).toBeNull();
    const empty = calculateMonthlyConsumption(
      "2026-10",
      { actualHours: [], indirectHours: [], peopleCapacity: [] },
      null,
    );
    expect(empty.total.valuedCostCents).toBeNull();
  });
  it("repartit une semaine frontiere sans supprimer ni dupliquer les heures", () => {
    const data = planning();
    data.indirectHours = [];
    data.actualHours[0] = { ...data.actualHours[0], week: "2026-W40", hours: 35 };
    const payroll = [record("2026-09"), record("2026-10")];
    const now = new Date("2026-11-05T12:00:00Z");
    const september = calculateMonthlyConsumption("2026-09", data, payroll, now);
    const october = calculateMonthlyConsumption("2026-10", data, payroll, now);
    expect(september.total.hours + october.total.hours).toBeCloseTo(35, 2);
    expect(october.estimatedMonthSplit).toBe(true);
    expect(data.actualHours[0].hours).toBe(35);
  });
  it("ne depend pas de l'existence d'un chantier actif pour conserver son historique", () => {
    const data = planning();
    const result = calculateMonthlyConsumption(
      "2026-10",
      data,
      [record("2026-09")],
      new Date("2026-10-15T12:00:00Z"),
    );
    expect(result.chantier.hours).toBe(10);
  });
  it("propose les destinations dans la creation et la modification, avec une vue mensuelle distincte", () => {
    for (const path of [
      "src/components/purchase-orders-workspace.tsx",
      "src/components/purchase-order-edit-workspace.tsx",
    ]) {
      const ui = readFileSync(path, "utf8");
      expect(ui).toContain("purchaseAllocationFromSelection");
      expect(ui).toContain("GENERAL_EXPENSES");
      expect(ui).toContain("SAV (hors chantier)");
    }
    const monthly = readFileSync("src/components/enterprise-finance-tabs.tsx", "utf8");
    expect(monthly).toContain("Situation mensuelle entreprise");
    expect(monthly).toContain("Budgets et suivi des chantiers");
    expect(monthly).toContain("toutes dates");
    expect(monthly).toContain("Non disponible");
  });
});

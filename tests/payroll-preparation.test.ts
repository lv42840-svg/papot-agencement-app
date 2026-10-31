import { describe, expect, it } from "vitest";
import { createInitialPlanningPayload } from "../src/lib/planning/domain";
import { DEFAULT_WEEKLY_SCHEDULE } from "../src/lib/planning/capacity";
import {
  DEFAULT_OVERTIME_RULES,
  buildPayrollSummary,
  getMonthState,
  mutatePayrollPreparation,
  parsePayrollPreparation,
  payrollDifferences,
  payrollWeeks,
} from "../src/lib/payroll/preparation";
import {
  parseMonthlyLaborCostsPayload,
  saveMonthlyLaborCost,
  monthlyHourlyRateEuro,
} from "../src/lib/payroll/monthly-labor-costs";
import type { PlanningVisiblePerson } from "../src/lib/planning/personnel";
const id = "11111111-1111-4111-8111-111111111111";
const chantierId = "22222222-2222-4222-8222-222222222222";
const person: PlanningVisiblePerson = {
  userId: id,
  displayName: "Alice Dupont",
  kind: "staff",
  firstName: "Alice",
  lastName: "Dupont",
  linkedUserId: null,
  hiddenInWeeklyBoard: false,
  endDate: null,
  inactiveSince: null,
  countsInMacroCapacity: true,
  weeklySchedule: { ...DEFAULT_WEEKLY_SCHEDULE },
};
const people = [person];
const now = new Date("2026-11-02T10:00:00Z");
const base = () => createInitialPlanningPayload();
function mutate(
  source: ReturnType<typeof parsePayrollPreparation>,
  input: Record<string, unknown>,
  planning = base(),
) {
  const state = getMonthState(source, "2026-10");
  return mutatePayrollPreparation(
    source,
    { ...input, month: "2026-10", expectedRevision: state.revision } as Parameters<
      typeof mutatePayrollPreparation
    >[1],
    planning,
    people,
    "Nadia",
    now,
  );
}
describe("préparation de paie", () => {
  it("met la semaine 28 septembre au 4 octobre dans le mois d'octobre entier", () => {
    expect(payrollWeeks("2026-09")).not.toContain("2026-W40");
    expect(payrollWeeks("2026-10")).toContain("2026-W40");
    expect(payrollWeeks("2027-01")).toContain("2026-W53");
  });
  it("ignore les heures provisoires non validées et utilise la base contrat", () => {
    const planning = base();
    planning.actualHours.push({
      chantierId,
      userId: id,
      activity: "BE",
      week: "2026-W40",
      hours: 15,
    });
    const summary = buildPayrollSummary(
      "2026-10",
      planning,
      people,
      getMonthState(parsePayrollPreparation(null), "2026-10"),
      DEFAULT_OVERTIME_RULES,
      now,
    );
    const row = summary.rows[0].weeks.find((w) => w.week === "2026-W40");
    expect(row?.source).toBe("CONTRACT");
    expect(row?.hours).toBeCloseTo(39, 3);
    expect(row?.extra25).toBeCloseTo(4, 3);
  });
  it("passe aux heures réelles uniquement avec confirmation et inclut SAV/FG", () => {
    const planning = base();
    planning.actualHours.push({
      chantierId,
      userId: id,
      activity: "BE",
      week: "2026-W40",
      hours: 35,
    });
    planning.indirectHours.push({ userId: id, category: "GENERAL", week: "2026-W40", hours: 10 });
    const state = mutate(
      parsePayrollPreparation(null),
      { action: "setWeekValidated", personId: id, week: "2026-W40", validated: true },
      planning,
    );
    const week = buildPayrollSummary(
      "2026-10",
      planning,
      people,
      getMonthState(state, "2026-10"),
      state.rules,
      now,
    ).rows[0].weeks[0];
    expect(week.hours).toBe(45);
    expect(week.extra25).toBe(8);
    expect(week.extra50).toBe(2);
  });
  it("déduit les absences de la semaine en base contrat sans découper le mois", () => {
    const planning = base();
    planning.absences.push({
      id: crypto.randomUUID(),
      userId: id,
      type: "VACATION",
      date: "2026-09-30",
      hours: 7.8,
    });
    const row = buildPayrollSummary(
      "2026-10",
      planning,
      people,
      getMonthState(parsePayrollPreparation(null), "2026-10"),
      DEFAULT_OVERTIME_RULES,
      now,
    ).rows[0];
    expect(row.weeks[0].hours).toBeCloseTo(31.2, 5);
    expect(row.vacationDays).toBeCloseTo(1, 5);
    expect(row.absences[0].date).toBe("2026-09-30");
  });
  it("fige V1 et V2 sans modifier les versions antérieures", () => {
    const planning = base();
    const init = parsePayrollPreparation(null);
    const note = mutate(
      init,
      { action: "setNote", personId: id, note: "Prime à contrôler" },
      planning,
    );
    const v1 = mutate(note, { action: "validate" }, planning);
    expect(getMonthState(v1, "2026-10").status).toBe("PREPARED");
    expect(() => mutate(v1, { action: "setNote", personId: id, note: "Autre" }, planning)).toThrow(
      "LOCKED",
    );
    const reopened = mutate(v1, { action: "reopen", reason: "Correction prime" }, planning);
    const corrected = mutate(
      reopened,
      { action: "setNote", personId: id, note: "Prime corrigée" },
      planning,
    );
    const v2 = mutate(corrected, { action: "validate" }, planning);
    const versions = getMonthState(v2, "2026-10").versions;
    expect(versions.map((x) => x.number)).toEqual([1, 2]);
    expect(versions[0].summary.rows[0].note).toBe("Prime à contrôler");
    expect(versions[1].summary.rows[0].note).toBe("Prime corrigée");
    expect(payrollDifferences(versions[0].summary, versions[1].summary)[0].changes[0].field).toBe(
      "note",
    );
  });
  it("refuse V2 sans différence, garde l'historique de réouverture et autorise le retour", () => {
    const v1 = mutate(parsePayrollPreparation(null), { action: "validate" });
    const reopen = mutate(v1, { action: "reopen", reason: "Vérification interne" });
    expect(() => mutate(reopen, { action: "validate" })).toThrow("UNCHANGED");
    const restored = mutate(reopen, { action: "restore" });
    const state = getMonthState(restored, "2026-10");
    expect(state.versions).toHaveLength(1);
    expect(state.eventLog.find((x) => x.action === "reopen")?.reason).toBe("Vérification interne");
  });
  it("rejette une mise à jour périmée", () => {
    const input = {
      action: "setNote",
      month: "2026-10",
      expectedRevision: 0,
      personId: id,
      note: "test",
    } as const;
    const changed = mutatePayrollPreparation(
      parsePayrollPreparation(null),
      input,
      base(),
      people,
      "Nadia",
      now,
    );
    expect(() => mutatePayrollPreparation(changed, input, base(), people, "Lucien", now)).toThrow(
      "VERSION_CONFLICT",
    );
  });
});
describe("coût mensuel salarié / holding", () => {
  it("garde la charge holding du mois à zéro heure sans créer un coût horaire", () => {
    const result = saveMonthlyLaborCost(
      parseMonthlyLaborCostsPayload(null),
      {
        action: "saveMonthlyLaborCost",
        month: "2026-10",
        personId: id,
        employerCostCents: 300000,
        workedHours: 0,
        sourceType: "HOLDING",
        expectedRevision: null,
      },
      new Set([id]),
      "Nadia",
      now,
    );
    expect(result.records[0].sourceType).toBe("HOLDING");
    expect(monthlyHourlyRateEuro(result.records[0])).toBeNull();
    expect(result.records[0].employerCostCents).toBe(300000);
  });
  it("conserve anciennes valeurs et refuse une correction écrasant une autre", () => {
    const initial = saveMonthlyLaborCost(
      parseMonthlyLaborCostsPayload(null),
      {
        action: "saveMonthlyLaborCost",
        month: "2026-10",
        personId: id,
        employerCostCents: 200000,
        workedHours: 100,
        expectedRevision: null,
      },
      new Set([id]),
      "Nadia",
      now,
    );
    const next = saveMonthlyLaborCost(
      initial,
      {
        action: "saveMonthlyLaborCost",
        month: "2026-10",
        personId: id,
        employerCostCents: 300000,
        workedHours: 100,
        expectedRevision: 1,
      },
      new Set([id]),
      "Lucien",
      now,
    );
    expect(next.history).toHaveLength(2);
    expect(next.history[1].previous?.employerCostCents).toBe(200000);
    expect(() =>
      saveMonthlyLaborCost(
        next,
        {
          action: "saveMonthlyLaborCost",
          month: "2026-10",
          personId: id,
          employerCostCents: 400000,
          workedHours: 100,
          expectedRevision: 1,
        },
        new Set([id]),
        "Nadia",
        now,
      ),
    ).toThrow("VERSION_CONFLICT");
  });
});

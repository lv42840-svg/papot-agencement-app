import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf-8",
);
const route = readFileSync(
  new URL("../src/app/api/desktop/planning/route.ts", import.meta.url),
  "utf-8",
);

describe("person-by-person absence register", () => {
  it("provides one tab for each person and filters the displayed absences", () => {
    expect(source).toContain('aria-label="Absences par personne"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('aria-selected={selected}');
    expect(source).toContain("setAbsenceUserId(person.id)");
    expect(source).toContain("shownAbsences.map((absence)");
    expect(source).toContain("groupPlanningAbsences");
  });

  it("uses week-level editing and deletion for grouped full-week absences", () => {
    expect(source).toContain("Modifier la semaine");
    expect(source).toContain("Supprimer la semaine");
    expect(source).toContain("deleteAbsenceBatch");
    expect(source).toContain("setAbsenceWeek(absence.week)");
    expect(route).toContain('input.action === "deleteAbsenceBatch"');
    expect(route).toContain("applyPlanningDeleteAbsenceBatchMutation");
  });
});

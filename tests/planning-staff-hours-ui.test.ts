import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  new URL("../src/components/grand-planning-workspace.tsx", import.meta.url),
  "utf-8",
);
const personnel = readFileSync(
  new URL("../src/lib/planning/personnel.ts", import.meta.url),
  "utf-8",
);

describe("new personnel hours and absence suggestions", () => {
  it("saves a separate 38.5 hour schedule only for newly created personnel", () => {
    expect(personnel).toContain("NEW_STAFF_WEEKLY_SCHEDULE");
    expect(personnel).toContain("payload.peopleCapacity.push");
    expect(personnel).toContain("countsInMacroCapacity: false");
    expect(personnel).toContain("weeklySchedule: { ...NEW_STAFF_WEEKLY_SCHEDULE }");
  });

  it("proposes the selected person's scheduled hours for the date, without locking the input", () => {
    expect(component).toContain("suggestedAbsenceHoursForDate");
    expect(component).toContain("person.weeklySchedule, absenceDate");
    expect(component).toContain("value={displayedAbsenceHours}");
    expect(component).toContain("setAbsenceHours(event.target.value)");
    expect(component).toContain("setAbsenceHours(null)");
    expect(component).toContain("setAbsenceHours(formatHours(absence.hours))");
    expect(component).toContain("parseHours(displayedAbsenceHours)");
  });
});

import { describe, expect, it } from "vitest";
import { currentDashboardPlanningWeek, shiftDashboardPlanningWeek } from "../src/lib/planning/dashboard-week";

describe("dashboard planning week navigation", () => {
  it("starts with the actual week in Europe/Paris", () => {
    expect(currentDashboardPlanningWeek(new Date("2026-10-17T12:00:00Z"))).toBe("2026-W42");
  });

  it("changes weeks at Paris midnight rather than at the server's UTC midnight", () => {
    expect(currentDashboardPlanningWeek(new Date("2026-10-18T21:30:00Z"))).toBe("2026-W42");
    expect(currentDashboardPlanningWeek(new Date("2026-10-18T22:30:00Z"))).toBe("2026-W43");
  });

  it("moves between weeks including ISO-year boundaries", () => {
    expect(shiftDashboardPlanningWeek("2026-W42", 1)).toBe("2026-W43");
    expect(shiftDashboardPlanningWeek("2026-W42", -1)).toBe("2026-W41");
    expect(shiftDashboardPlanningWeek("2026-W53", 1)).toBe("2027-W01");
    expect(shiftDashboardPlanningWeek("2027-W01", -1)).toBe("2026-W53");
  });
});

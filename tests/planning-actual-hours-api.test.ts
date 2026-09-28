import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../src/app/api/desktop/planning/route.ts", import.meta.url),
  "utf-8",
);

describe("planning actual-hours API", () => {
  it("requires the actual-hours permission and a past week", () => {
    expect(routeSource).toContain(
      'requireSpecialPermission(context.user, "planning.enter_actual_hours")',
    );
    expect(routeSource).toContain(
      'if (!isPlanningWeekPast(input.week)) throw new Error("PLANNING_ACTUAL_HOURS_WEEK_NOT_PAST")',
    );
  });
});

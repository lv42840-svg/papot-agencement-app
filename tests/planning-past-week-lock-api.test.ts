import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  new URL("../src/app/api/desktop/planning/route.ts", import.meta.url),
  "utf-8",
);

describe("planning API past-week lock", () => {
  it("guards both firm and provisional weekly mutations server-side", () => {
    expect(routeSource).toContain(
      'import { assertPlanningWeekEditable, isPlanningWeekPast } from "@/lib/planning/time-markers";',
    );
    expect(routeSource.split("assertPlanningWeekEditable(input.week);")).toHaveLength(3);
  });
});

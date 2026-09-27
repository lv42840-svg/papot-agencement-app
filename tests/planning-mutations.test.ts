import { describe, expect, it } from "vitest";
import { createInitialPlanningPayload } from "../src/lib/planning/domain";
import { applyPlanningMacroMutation } from "../src/lib/planning/mutations";

const chantierId = "11111111-1111-4111-8111-111111111111";
const active = new Set([chantierId]);

describe("grand planning mutations", () => {
  it("sets and replaces weekly hours without duplicating a cell", () => {
    const first = applyPlanningMacroMutation(
      createInitialPlanningPayload(),
      {
        action: "setMacroHours",
        chantierId,
        activity: "WORKSHOP",
        week: "2026-W40",
        hours: 20,
      },
      active,
    );
    const second = applyPlanningMacroMutation(
      first,
      {
        action: "setMacroHours",
        chantierId,
        activity: "WORKSHOP",
        week: "2026-W40",
        hours: 10,
      },
      active,
    );

    expect(second.macroAllocations).toEqual([
      {
        chantierId,
        activity: "WORKSHOP",
        week: "2026-W40",
        hours: 10,
      },
    ]);
  });

  it("removes the allocation when a cell returns to zero", () => {
    const filled = applyPlanningMacroMutation(
      createInitialPlanningPayload(),
      {
        action: "setMacroHours",
        chantierId,
        activity: "BE",
        week: "2026-W40",
        hours: 8,
      },
      active,
    );

    const cleared = applyPlanningMacroMutation(
      filled,
      {
        action: "setMacroHours",
        chantierId,
        activity: "BE",
        week: "2026-W40",
        hours: 0,
      },
      active,
    );

    expect(cleared.macroAllocations).toEqual([]);
  });

  it("does not impose the chantier planned volume on direct weekly input", () => {
    const result = applyPlanningMacroMutation(
      createInitialPlanningPayload(),
      {
        action: "setMacroHours",
        chantierId,
        activity: "INSTALL",
        week: "2026-W40",
        hours: 500,
      },
      active,
    );

    expect(result.macroAllocations[0]?.hours).toBe(500);
  });

  it("refuses to plan a closed chantier", () => {
    expect(() =>
      applyPlanningMacroMutation(
        createInitialPlanningPayload(),
        {
          action: "setMacroHours",
          chantierId,
          activity: "BE",
          week: "2026-W40",
          hours: 4,
        },
        new Set(),
      ),
    ).toThrow("PLANNING_CHANTIER_NOT_ACTIVE");
  });
});

import { describe, expect, it } from "vitest";
import {
  buildChantierPlanningCloseWarning,
  createInitialPlanningPayload,
} from "../src/lib/planning/domain";

const chantier = {
  id: "11111111-1111-4111-8111-111111111111",
  plannedHours: { be: 10, workshop: 20, install: 30 },
};

describe("chantier planning closure warning", () => {
  it("counts current/future allocations and positive hours still to allocate", () => {
    const planning = {
      ...createInitialPlanningPayload(),
      macroAllocations: [
        {
          chantierId: chantier.id,
          activity: "BE" as const,
          week: "2026-W39",
          hours: 10,
        },
        {
          chantierId: chantier.id,
          activity: "WORKSHOP" as const,
          week: "2026-W40",
          hours: 5,
        },
        {
          chantierId: chantier.id,
          activity: "INSTALL" as const,
          week: "2026-W41",
          hours: 30,
        },
      ],
    };

    const warning = buildChantierPlanningCloseWarning(
      chantier,
      planning,
      new Date("2026-09-28T08:00:00.000Z"),
    );

    expect(warning).toEqual({
      futureAllocatedHours: 35,
      remainingToAllocateHours: 15,
      hasRemainingCharge: true,
    });
  });

  it("does not warn when only fully allocated past charge remains", () => {
    const planning = {
      ...createInitialPlanningPayload(),
      macroAllocations: [
        {
          chantierId: chantier.id,
          activity: "BE" as const,
          week: "2026-W39",
          hours: 10,
        },
        {
          chantierId: chantier.id,
          activity: "WORKSHOP" as const,
          week: "2026-W39",
          hours: 20,
        },
        {
          chantierId: chantier.id,
          activity: "INSTALL" as const,
          week: "2026-W39",
          hours: 30,
        },
      ],
    };

    const warning = buildChantierPlanningCloseWarning(
      chantier,
      planning,
      new Date("2026-09-28T08:00:00.000Z"),
    );

    expect(warning).toEqual({
      futureAllocatedHours: 0,
      remainingToAllocateHours: 0,
      hasRemainingCharge: false,
    });
  });
});

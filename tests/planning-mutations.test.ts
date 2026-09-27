import { describe, expect, it } from "vitest";
import { createInitialPlanningPayload } from "../src/lib/planning/domain";
import {
  applyPlanningAbsenceMutation,
  applyPlanningChantierOrderMutation,
  applyPlanningDeleteAbsenceMutation,
  applyPlanningFullWeekAbsenceMutation,
  applyPlanningMacroMutation,
  applyPlanningPersonCapacityMutation,
  applyPlanningPotentialOrderMutation,
  applyPlanningProvisionalMutation,
  removeFirmPlanningForChantier,
  restoreFirmPlanningOrderForChantier,
  clearPlanningProvisionForCommercialCase,
  convertPlanningProvisionToFirm,
  syncPlanningPotentialOrderForCommercialCase,
} from "../src/lib/planning/mutations";

const chantierId = "11111111-1111-4111-8111-111111111111";
const active = new Set([chantierId]);
const commercialCaseId = "22222222-2222-4222-8222-222222222222";

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

describe("planning chantier lifecycle bridge", () => {
  it("removes all active firm allocations and the shared order when a chantier is closed", () => {
    const otherChantierId = "33333333-3333-4333-8333-333333333333";
    const source = {
      ...createInitialPlanningPayload(),
      chantierOrder: [chantierId, otherChantierId],
      macroAllocations: [
        { chantierId, activity: "BE" as const, week: "2026-W40", hours: 8 },
        { chantierId, activity: "WORKSHOP" as const, week: "2026-W41", hours: 20 },
        { chantierId: otherChantierId, activity: "INSTALL" as const, week: "2026-W42", hours: 12 },
      ],
    };

    const result = removeFirmPlanningForChantier(source, chantierId);

    expect(result.chantierOrder).toEqual([otherChantierId]);
    expect(result.macroAllocations).toEqual([
      {
        chantierId: otherChantierId,
        activity: "INSTALL",
        week: "2026-W42",
        hours: 12,
      },
    ]);
  });

  it("reopens a chantier at the top without restoring any old weekly allocation", () => {
    const otherChantierId = "33333333-3333-4333-8333-333333333333";
    const source = {
      ...createInitialPlanningPayload(),
      chantierOrder: [otherChantierId],
      macroAllocations: [
        { chantierId: otherChantierId, activity: "INSTALL" as const, week: "2026-W42", hours: 12 },
      ],
    };

    const result = restoreFirmPlanningOrderForChantier(source, chantierId);

    expect(result.chantierOrder).toEqual([chantierId, otherChantierId]);
    expect(result.macroAllocations).toEqual([
      {
        chantierId: otherChantierId,
        activity: "INSTALL",
        week: "2026-W42",
        hours: 12,
      },
    ]);
  });
});

describe("firm chantier manual order", () => {
  it("stores a complete shared order for active chantiers", () => {
    const secondChantierId = "33333333-3333-4333-8333-333333333333";
    const result = applyPlanningChantierOrderMutation(
      {
        ...createInitialPlanningPayload(),
        chantierOrder: [chantierId, secondChantierId],
      },
      {
        action: "setChantierOrder",
        orderedChantierIds: [secondChantierId, chantierId],
      },
      new Set([chantierId, secondChantierId]),
    );

    expect(result.chantierOrder).toEqual([secondChantierId, chantierId]);
  });

  it("refuses an incomplete or foreign firm order", () => {
    const secondChantierId = "33333333-3333-4333-8333-333333333333";
    expect(() =>
      applyPlanningChantierOrderMutation(
        createInitialPlanningPayload(),
        {
          action: "setChantierOrder",
          orderedChantierIds: [chantierId],
        },
        new Set([chantierId, secondChantierId]),
      ),
    ).toThrow("PLANNING_CHANTIER_ORDER_INVALID");
  });
});

describe("provisional grand planning mutations", () => {
  const activeCommercialCases = new Set([commercialCaseId]);

  it("sets and replaces provisional weekly hours without duplicating a cell", () => {
    const first = applyPlanningProvisionalMutation(
      createInitialPlanningPayload(),
      {
        action: "setProvisionHours",
        caseId: commercialCaseId,
        activity: "WORKSHOP",
        week: "2026-W40",
        hours: 20,
      },
      activeCommercialCases,
    );
    const second = applyPlanningProvisionalMutation(
      first,
      {
        action: "setProvisionHours",
        caseId: commercialCaseId,
        activity: "WORKSHOP",
        week: "2026-W40",
        hours: 35,
      },
      activeCommercialCases,
    );

    expect(second.provisionalAllocations).toEqual([
      {
        caseId: commercialCaseId,
        activity: "WORKSHOP",
        week: "2026-W40",
        hours: 35,
      },
    ]);
  });

  it("adds a newly planned affair at the top of the shared potential order", () => {
    const olderCaseId = "44444444-4444-4444-8444-444444444444";
    const source = {
      ...createInitialPlanningPayload(),
      provisionalOrder: [olderCaseId],
    };

    const result = applyPlanningProvisionalMutation(
      source,
      {
        action: "setProvisionHours",
        caseId: commercialCaseId,
        activity: "WORKSHOP",
        week: "2026-W40",
        hours: 12,
      },
      new Set([commercialCaseId, olderCaseId]),
    );

    expect(result.provisionalOrder).toEqual([commercialCaseId, olderCaseId]);
  });

  it("removes a provisional allocation when the cell returns to zero", () => {
    const filled = applyPlanningProvisionalMutation(
      createInitialPlanningPayload(),
      {
        action: "setProvisionHours",
        caseId: commercialCaseId,
        activity: "BE",
        week: "2026-W40",
        hours: 8,
      },
      activeCommercialCases,
    );

    const cleared = applyPlanningProvisionalMutation(
      filled,
      {
        action: "setProvisionHours",
        caseId: commercialCaseId,
        activity: "BE",
        week: "2026-W40",
        hours: 0,
      },
      activeCommercialCases,
    );

    expect(cleared.provisionalAllocations).toEqual([]);
  });

  it("refuses to plan a commercial affair that is no longer active", () => {
    expect(() =>
      applyPlanningProvisionalMutation(
        createInitialPlanningPayload(),
        {
          action: "setProvisionHours",
          caseId: commercialCaseId,
          activity: "INSTALL",
          week: "2026-W40",
          hours: 4,
        },
        new Set(),
      ),
    ).toThrow("PLANNING_COMMERCIAL_CASE_NOT_ACTIVE");
  });
});

describe("planning manual potential order", () => {
  it("stores a complete shared order for the visible potential block", () => {
    const secondCaseId = "44444444-4444-4444-8444-444444444444";
    const result = applyPlanningPotentialOrderMutation(
      {
        ...createInitialPlanningPayload(),
        provisionalOrder: [commercialCaseId, secondCaseId],
      },
      {
        action: "setPotentialOrder",
        orderedCaseIds: [secondCaseId, commercialCaseId],
      },
      new Set([commercialCaseId, secondCaseId]),
    );

    expect(result.provisionalOrder).toEqual([secondCaseId, commercialCaseId]);
  });

  it("refuses an incomplete or foreign potential order", () => {
    const secondCaseId = "44444444-4444-4444-8444-444444444444";
    expect(() =>
      applyPlanningPotentialOrderMutation(
        createInitialPlanningPayload(),
        {
          action: "setPotentialOrder",
          orderedCaseIds: [commercialCaseId],
        },
        new Set([commercialCaseId, secondCaseId]),
      ),
    ).toThrow("PLANNING_POTENTIAL_ORDER_INVALID");
  });
});

describe("planning potential order lifecycle", () => {
  it("inserts a first commercial provision at the top without re-promoting an existing affair", () => {
    const olderCaseId = "44444444-4444-4444-8444-444444444444";
    const source = {
      ...createInitialPlanningPayload(),
      provisionalOrder: [olderCaseId],
    };

    const inserted = syncPlanningPotentialOrderForCommercialCase(source, commercialCaseId, true);
    expect(inserted.provisionalOrder).toEqual([commercialCaseId, olderCaseId]);

    const unchanged = syncPlanningPotentialOrderForCommercialCase(inserted, olderCaseId, true);
    expect(unchanged.provisionalOrder).toEqual([commercialCaseId, olderCaseId]);
  });

  it("removes an affair from the potential order when no reference or weekly allocation remains", () => {
    const source = {
      ...createInitialPlanningPayload(),
      provisionalOrder: [commercialCaseId],
    };

    const result = syncPlanningPotentialOrderForCommercialCase(source, commercialCaseId, false);

    expect(result.provisionalOrder).toEqual([]);
  });
});

describe("planning provision cleanup", () => {
  it("removes every weekly provision allocation for the closed commercial affair", () => {
    const otherCaseId = "44444444-4444-4444-8444-444444444444";
    const source = {
      ...createInitialPlanningPayload(),
      provisionalOrder: [commercialCaseId, otherCaseId],
      provisionalAllocations: [
        {
          caseId: commercialCaseId,
          activity: "BE" as const,
          week: "2026-W39",
          hours: 6,
        },
        {
          caseId: commercialCaseId,
          activity: "WORKSHOP" as const,
          week: "2026-W40",
          hours: 18,
        },
        {
          caseId: otherCaseId,
          activity: "INSTALL" as const,
          week: "2026-W41",
          hours: 12,
        },
      ],
    };

    const result = clearPlanningProvisionForCommercialCase(source, commercialCaseId);

    expect(result.provisionalAllocations).toEqual([
      {
        caseId: otherCaseId,
        activity: "INSTALL",
        week: "2026-W41",
        hours: 12,
      },
    ]);
    expect(result.provisionalOrder).toEqual([otherCaseId]);
  });

  it("is idempotent so reopening cannot restore an old weekly distribution", () => {
    const source = {
      ...createInitialPlanningPayload(),
      provisionalAllocations: [
        {
          caseId: commercialCaseId,
          activity: "WORKSHOP" as const,
          week: "2026-W40",
          hours: 20,
        },
      ],
    };

    const cleared = clearPlanningProvisionForCommercialCase(source, commercialCaseId);
    const clearedAgain = clearPlanningProvisionForCommercialCase(cleared, commercialCaseId);

    expect(clearedAgain.provisionalAllocations).toEqual([]);
  });
});

describe("planning provision to firm conversion", () => {
  it("keeps the same weeks and hours while changing only the allocation nature", () => {
    const source = {
      ...createInitialPlanningPayload(),
      chantierOrder: ["33333333-3333-4333-8333-333333333333"],
      provisionalOrder: [commercialCaseId],
      provisionalAllocations: [
        {
          caseId: commercialCaseId,
          activity: "WORKSHOP" as const,
          week: "2026-W40",
          hours: 30,
        },
        {
          caseId: commercialCaseId,
          activity: "INSTALL" as const,
          week: "2026-W42",
          hours: 12,
        },
      ],
    };

    const result = convertPlanningProvisionToFirm(source, commercialCaseId, chantierId);

    expect(result.provisionalAllocations).toEqual([]);
    expect(result.macroAllocations).toEqual([
      {
        chantierId,
        activity: "WORKSHOP",
        week: "2026-W40",
        hours: 30,
      },
      {
        chantierId,
        activity: "INSTALL",
        week: "2026-W42",
        hours: 12,
      },
    ]);
    expect(result.chantierOrder).toEqual([chantierId, "33333333-3333-4333-8333-333333333333"]);
    expect(result.provisionalOrder).toEqual([]);
  });

  it("leaves unrelated provisional allocations untouched", () => {
    const otherCaseId = "44444444-4444-4444-8444-444444444444";
    const source = {
      ...createInitialPlanningPayload(),
      provisionalAllocations: [
        {
          caseId: commercialCaseId,
          activity: "BE" as const,
          week: "2026-W39",
          hours: 6,
        },
        {
          caseId: otherCaseId,
          activity: "WORKSHOP" as const,
          week: "2026-W41",
          hours: 18,
        },
      ],
    };

    const result = convertPlanningProvisionToFirm(source, commercialCaseId, chantierId);

    expect(result.macroAllocations).toEqual([
      {
        chantierId,
        activity: "BE",
        week: "2026-W39",
        hours: 6,
      },
    ]);
    expect(result.provisionalAllocations).toEqual([
      {
        caseId: otherCaseId,
        activity: "WORKSHOP",
        week: "2026-W41",
        hours: 18,
      },
    ]);
  });

  it("puts the launched chantier at the top even when no provision was positioned", () => {
    const source = {
      ...createInitialPlanningPayload(),
      chantierOrder: ["33333333-3333-4333-8333-333333333333"],
    };

    const result = convertPlanningProvisionToFirm(source, commercialCaseId, chantierId);

    expect(result.macroAllocations).toEqual([]);
    expect(result.chantierOrder[0]).toBe(chantierId);
  });
});

describe("planning person capacity mutations", () => {
  const userId = "33333333-3333-4333-8333-333333333333";

  it("stores inclusion and the individual weekly schedule", () => {
    const result = applyPlanningPersonCapacityMutation(
      createInitialPlanningPayload(),
      {
        action: "setPersonCapacity",
        userId,
        countsInMacroCapacity: true,
        weeklySchedule: {
          monday: 8,
          tuesday: 8,
          wednesday: 8,
          thursday: 8,
          friday: 7,
          saturday: 0,
          sunday: 0,
        },
      },
      new Set([userId]),
    );

    expect(result.peopleCapacity).toEqual([
      {
        userId,
        countsInMacroCapacity: true,
        weeklySchedule: {
          monday: 8,
          tuesday: 8,
          wednesday: 8,
          thursday: 8,
          friday: 7,
          saturday: 0,
          sunday: 0,
        },
      },
    ]);
  });

  it("refuses capacity changes for an inactive user", () => {
    expect(() =>
      applyPlanningPersonCapacityMutation(
        createInitialPlanningPayload(),
        {
          action: "setPersonCapacity",
          userId,
          countsInMacroCapacity: true,
          weeklySchedule: {
            monday: 8,
            tuesday: 8,
            wednesday: 8,
            thursday: 8,
            friday: 7,
            saturday: 0,
            sunday: 0,
          },
        },
        new Set(),
      ),
    ).toThrow("PLANNING_USER_NOT_ACTIVE");
  });
});

describe("planning absence mutations", () => {
  const userId = "33333333-3333-4333-8333-333333333333";
  const activeUsers = new Set([userId]);

  it("adds and replaces an absence on the same person and date", () => {
    const first = applyPlanningAbsenceMutation(
      createInitialPlanningPayload(),
      {
        action: "setAbsence",
        userId,
        type: "VACATION",
        date: "2026-09-28",
        hours: 4,
      },
      activeUsers,
    );

    const second = applyPlanningAbsenceMutation(
      first,
      {
        action: "setAbsence",
        userId,
        type: "SICK",
        date: "2026-09-28",
        hours: 7.8,
      },
      activeUsers,
    );

    expect(second.absences).toHaveLength(1);
    expect(second.absences[0]).toMatchObject({
      userId,
      type: "SICK",
      date: "2026-09-28",
      hours: 7.8,
    });
  });

  it("creates a full working week without weekend or public-holiday rows", () => {
    const result = applyPlanningFullWeekAbsenceMutation(
      createInitialPlanningPayload(),
      {
        action: "setFullWeekAbsence",
        userId,
        type: "VACATION",
        week: "2026-W20",
      },
      activeUsers,
    );

    expect(result.absences.map((absence) => absence.date)).toEqual([
      "2026-05-11",
      "2026-05-12",
      "2026-05-13",
      "2026-05-15",
    ]);
    expect(result.absences.every((absence) => absence.hours === 7.8)).toBe(true);
  });

  it("deletes an absence", () => {
    const added = applyPlanningAbsenceMutation(
      createInitialPlanningPayload(),
      {
        action: "setAbsence",
        userId,
        type: "OTHER",
        date: "2026-09-28",
        hours: 2,
      },
      activeUsers,
    );
    const absenceId = added.absences[0]?.id;
    expect(absenceId).toBeTruthy();

    const deleted = applyPlanningDeleteAbsenceMutation(added, {
      action: "deleteAbsence",
      absenceId: absenceId!,
    });
    expect(deleted.absences).toEqual([]);
  });

  it("refuses an absence for an inactive user", () => {
    expect(() =>
      applyPlanningAbsenceMutation(
        createInitialPlanningPayload(),
        {
          action: "setAbsence",
          userId,
          type: "OTHER",
          date: "2026-09-28",
          hours: 2,
        },
        new Set(),
      ),
    ).toThrow("PLANNING_USER_NOT_ACTIVE");
  });
});

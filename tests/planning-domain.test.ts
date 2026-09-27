import { describe, expect, it } from "vitest";
import type { ChantiersPayload } from "../src/lib/chantiers/domain";
import {
  buildFirmGrandPlanningRows,
  createInitialPlanningPayload,
  planningYearWeekIds,
  type PlanningPayload,
} from "../src/lib/planning/domain";

const activeId = "11111111-1111-4111-8111-111111111111";
const doneId = "22222222-2222-4222-8222-222222222222";

function chantier(id: string, status: "ACTIVE" | "DONE") {
  return {
    id,
    sourceCommercialCaseId: crypto.randomUUID(),
    sourceEntryId: null,
    initialRetainedQuoteIds: [],
    number: null,
    reference: id === activeId ? "CHA-001" : "CHA-002",
    name: id === activeId ? "Agencement boutique" : "Ancien chantier",
    clientName: "Client",
    companyName: null,
    siteLabel: "Roanne",
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    description: null,
    nextAction: null,
    status,
    plannedInstallDate: "2026-11-02",
    launchYear: 2026,
    launchDocuments: {
      quote: "PRESENT" as const,
      signedQuote: "PRESENT" as const,
      costing: "PRESENT" as const,
    },
    signedQuoteReminder: false,
    plannedHours: { be: 10, workshop: 20, install: 30 },
    actualHours: { be: 0, workshop: 0, install: 0 },
    operational: {
      spaces: {
        admin: "APPLICABLE" as const,
        be: "APPLICABLE" as const,
        workshop: "APPLICABLE" as const,
        install: "APPLICABLE" as const,
        meeting: "APPLICABLE" as const,
        mail: "APPLICABLE" as const,
        reception: "APPLICABLE" as const,
      },
      beItems: [],
      workshopItems: [],
      installItems: [],
      quoteLineProgress: [],
    },
    launchedAt: "2026-09-27T10:00:00.000Z",
    launchedByName: "Lucien",
    completedAt: status === "DONE" ? "2026-09-27T11:00:00.000Z" : null,
    archivedAt: null,
    createdAt: "2026-09-27T10:00:00.000Z",
    updatedAt: "2026-09-27T10:00:00.000Z",
    updatedByName: "Lucien",
    history: [],
  };
}

function chantiersPayload(): ChantiersPayload {
  return {
    schemaVersion: 1,
    chantiers: [chantier(activeId, "ACTIVE"), chantier(doneId, "DONE")],
  };
}

describe("grand planning domain", () => {
  it("builds a complete ISO year", () => {
    expect(planningYearWeekIds(2026)[0]).toBe("2026-W01");
    expect(planningYearWeekIds(2026).at(-1)).toBe("2026-W53");
  });

  it("shows only active chantiers with fixed BE / Atelier / Pose rows", () => {
    const rows = buildFirmGrandPlanningRows(
      chantiersPayload(),
      createInitialPlanningPayload(),
      2026,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.chantierId).toBe(activeId);
    expect(rows[0]?.activities.map((item) => item.activity)).toEqual(["BE", "WORKSHOP", "INSTALL"]);
    expect(rows[0]?.activities.map((item) => item.plannedHours)).toEqual([10, 20, 30]);
  });

  it("calculates à répartir from the full allocation and allows a negative balance", () => {
    const planning: PlanningPayload = {
      schemaVersion: 1,
      chantierOrder: [],
      peopleCapacity: [],
      macroAllocations: [
        {
          chantierId: activeId,
          activity: "WORKSHOP",
          week: "2026-W40",
          hours: 12,
        },
        {
          chantierId: activeId,
          activity: "WORKSHOP",
          week: "2026-W41",
          hours: 18,
        },
      ],
    };

    const row = buildFirmGrandPlanningRows(chantiersPayload(), planning, 2026)[0];
    const workshop = row?.activities.find((item) => item.activity === "WORKSHOP");

    expect(workshop?.plannedHours).toBe(20);
    expect(workshop?.allocatedHours).toBe(30);
    expect(workshop?.remainingHours).toBe(-10);
    expect(workshop?.weeklyHours).toEqual({
      "2026-W40": 12,
      "2026-W41": 18,
    });
  });

  it("keeps allocations from other years in the global remaining balance", () => {
    const planning: PlanningPayload = {
      schemaVersion: 1,
      chantierOrder: [],
      peopleCapacity: [],
      macroAllocations: [
        { chantierId: activeId, activity: "BE", week: "2026-W52", hours: 4 },
        { chantierId: activeId, activity: "BE", week: "2027-W01", hours: 2 },
      ],
    };

    const be = buildFirmGrandPlanningRows(chantiersPayload(), planning, 2026)[0]?.activities[0];

    expect(be?.allocatedHours).toBe(6);
    expect(be?.remainingHours).toBe(4);
    expect(be?.weeklyHours).toEqual({ "2026-W52": 4 });
  });
});

import { describe, expect, it } from "vitest";
import type { ChantiersPayload } from "../src/lib/chantiers/domain";
import type { CommercialPayload } from "../src/lib/commercial/domain";
import {
  buildCommercialProvisionRows,
  buildFirmGrandPlanningRows,
  createInitialPlanningPayload,
  planningYearWeekIds,
  type PlanningPayload,
} from "../src/lib/planning/domain";

const activeId = "11111111-1111-4111-8111-111111111111";
const doneId = "22222222-2222-4222-8222-222222222222";
const provisionCaseId = "33333333-3333-4333-8333-333333333333";

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

function commercialPayload(): CommercialPayload {
  const base = {
    sourceEntryId: null,
    clientId: null,
    primaryContactId: null,
    clientName: "Client",
    siteLabel: null,
    siteAddressOverride: null,
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    description: null,
    nextAction: null,
    reviewDate: "2026-10-15",
    expectedConfirmationDate: null,
    plannedInstallDate: null,
    confirmedAt: null,
    retainedQuoteIds: [],
    closedAt: null,
    closingReason: null,
    documents: [],
    createdAt: "2026-09-27T10:00:00.000Z",
    createdByName: "Lucien",
    updatedAt: "2026-09-27T10:00:00.000Z",
    updatedByName: "Lucien",
    history: [],
    quoteOwnerName: null,
    quoteDueDate: null,
    quoteSentAt: null,
    quoteNotes: "",
  };

  return {
    schemaVersion: 2,
    clients: [],
    cases: [
      {
        ...base,
        id: provisionCaseId,
        name: "Affaire provisionnée",
        status: "PISTE",
        provisionHours: { be: 5, workshop: 20, install: 8 },
      },
      {
        ...base,
        id: "44444444-4444-4444-8444-444444444444",
        name: "Affaire confirmée",
        status: "CONFIRMED",
        reviewDate: null,
        plannedInstallDate: "2026-12-01",
        confirmedAt: "2026-09-27T11:00:00.000Z",
        provisionHours: { be: 4, workshop: 4, install: 4 },
      },
      {
        ...base,
        id: "55555555-5555-4555-8555-555555555555",
        name: "Affaire perdue",
        status: "LOST",
        reviewDate: null,
        closedAt: "2026-09-27T11:00:00.000Z",
        provisionHours: { be: 7, workshop: 7, install: 7 },
      },
      {
        ...base,
        id: "66666666-6666-4666-8666-666666666666",
        name: "Sans provision",
        status: "PISTE",
        provisionHours: { be: 0, workshop: 0, install: 0 },
      },
    ],
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

  it("builds provision rows only from active non-confirmed commercial affairs with hours", () => {
    const rows = buildCommercialProvisionRows(
      commercialPayload(),
      createInitialPlanningPayload(),
      2026,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      caseId: provisionCaseId,
      name: "Affaire provisionnée",
      status: "PISTE",
      statusLabel: "Piste",
    });
    expect(rows[0]?.activities).toEqual([
      {
        activity: "BE",
        label: "BE",
        provisionHours: 5,
        allocatedHours: 0,
        remainingHours: 5,
        weeklyHours: {},
      },
      {
        activity: "WORKSHOP",
        label: "Atelier",
        provisionHours: 20,
        allocatedHours: 0,
        remainingHours: 20,
        weeklyHours: {},
      },
      {
        activity: "INSTALL",
        label: "Pose",
        provisionHours: 8,
        allocatedHours: 0,
        remainingHours: 8,
        weeklyHours: {},
      },
    ]);
  });

  it("uses the shared potential order for provisional rows", () => {
    const commercial = commercialPayload();
    const secondCaseId = "77777777-7777-4777-8777-777777777777";
    commercial.cases.push({
      ...commercial.cases[0],
      id: secondCaseId,
      name: "Deuxième affaire provisionnée",
      provisionHours: { be: 1, workshop: 2, install: 3 },
    });
    const planning: PlanningPayload = {
      ...createInitialPlanningPayload(),
      provisionalOrder: [secondCaseId, provisionCaseId],
    };

    const rows = buildCommercialProvisionRows(commercial, planning, 2026);

    expect(rows.map((row) => row.caseId)).toEqual([secondCaseId, provisionCaseId]);
  });

  it("calculates provisional remaining hours and allows a negative balance", () => {
    const planning: PlanningPayload = {
      ...createInitialPlanningPayload(),
      provisionalAllocations: [
        { caseId: provisionCaseId, activity: "WORKSHOP", week: "2026-W40", hours: 12 },
        { caseId: provisionCaseId, activity: "WORKSHOP", week: "2026-W41", hours: 15 },
      ],
    };

    const row = buildCommercialProvisionRows(commercialPayload(), planning, 2026)[0];
    const workshop = row?.activities.find((item) => item.activity === "WORKSHOP");

    expect(workshop?.provisionHours).toBe(20);
    expect(workshop?.allocatedHours).toBe(27);
    expect(workshop?.remainingHours).toBe(-7);
    expect(workshop?.weeklyHours).toEqual({
      "2026-W40": 12,
      "2026-W41": 15,
    });
  });

  it("keeps provisional allocations from other years in the global remaining balance", () => {
    const planning: PlanningPayload = {
      ...createInitialPlanningPayload(),
      provisionalAllocations: [
        { caseId: provisionCaseId, activity: "BE", week: "2026-W52", hours: 2 },
        { caseId: provisionCaseId, activity: "BE", week: "2027-W01", hours: 1 },
      ],
    };

    const be = buildCommercialProvisionRows(commercialPayload(), planning, 2026)[0]?.activities[0];

    expect(be?.allocatedHours).toBe(3);
    expect(be?.remainingHours).toBe(2);
    expect(be?.weeklyHours).toEqual({ "2026-W52": 2 });
  });

  it("calculates à répartir from the full allocation and allows a negative balance", () => {
    const planning: PlanningPayload = {
      schemaVersion: 1,
      chantierOrder: [],
      provisionalOrder: [],
      peopleCapacity: [],
      absences: [],
      provisionalAllocations: [],
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

  it("shows saved actual hours immediately without changing the allocation balance", () => {
    const planning: PlanningPayload = {
      ...createInitialPlanningPayload(),
      macroAllocations: [
        { chantierId: activeId, activity: "WORKSHOP", week: "2026-W39", hours: 18 },
      ],
      actualHours: [
        {
          chantierId: activeId,
          userId: "77777777-7777-4777-8777-777777777777",
          activity: "WORKSHOP",
          week: "2026-W39",
          hours: 7,
        },
        {
          chantierId: activeId,
          userId: "88888888-8888-4888-8888-888888888888",
          activity: "WORKSHOP",
          week: "2026-W39",
          hours: 6,
        },
      ],
    };

    const workshop = buildFirmGrandPlanningRows(chantiersPayload(), planning, 2026)[0]?.activities.find(
      (item) => item.activity === "WORKSHOP",
    );

    expect(workshop?.weeklyHours["2026-W39"]).toBe(13);
    expect(workshop?.allocatedHours).toBe(18);
    expect(workshop?.remainingHours).toBe(2);
  });

  it("keeps allocations from other years in the global remaining balance", () => {
    const planning: PlanningPayload = {
      schemaVersion: 1,
      chantierOrder: [],
      provisionalOrder: [],
      peopleCapacity: [],
      absences: [],
      provisionalAllocations: [],
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

import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
process.env.PAPOT_PURGE_TEST_MODE = "1";
const { planFor, safeRelative } = require("../scripts/ops/purge-two-test-chantiers.cjs") as {
  planFor: (states: Record<string, unknown>, clients: unknown[]) => {
    scope: {
      sites: Array<{ id: string }>;
      factures: Array<{ id: string; status: string; type: string }>;
      clientsKept: string[];
    };
    clientsToDelete: string[];
    next: {
      chantiers: { chantiers: unknown[] };
      commercial: { cases: unknown[] };
      quotes: { quotes: unknown[] };
      billing: { drafts: unknown[] };
      planning: { macroAllocations: unknown[]; dailyAssignments: unknown[] };
    };
    signature: string;
  };
  safeRelative: (value: string) => string;
};
delete process.env.PAPOT_PURGE_TEST_MODE;

const ids = {
  site1: "11111111-1111-4111-8111-111111111111",
  site2: "22222222-2222-4222-8222-222222222222",
  case1: "33333333-3333-4333-8333-333333333333",
  case2: "44444444-4444-4444-8444-444444444444",
  quote1: "55555555-5555-4555-8555-555555555555",
  quote2: "66666666-6666-4666-8666-666666666666",
  client1: "77777777-7777-4777-8777-777777777777",
  client2: "88888888-8888-4888-8888-888888888888",
  draft1: "99999999-9999-4999-8999-999999999999",
};

type ActualHoursFixture = {
  chantierId: string;
  userId: string;
  activity: string;
  week: string;
  hours: number;
};

function fixture() {
  const payloads = {
    chantiers: {
      schemaVersion: 1,
      chantiers: [
        {
          id: ids.site1,
          name: "Loan Maître",
          clientName: "JULES SAS",
          number: "2026-004",
          launchYear: 2026,
          sourceCommercialCaseId: ids.case1,
          status: "CANCELLED",
        },
        {
          id: ids.site2,
          name: "Lucien VAGINAY",
          clientName: "test",
          number: "2026-005",
          launchYear: 2026,
          sourceCommercialCaseId: ids.case2,
          status: "CANCELLED",
        },
      ],
    },
    commercial: {
      schemaVersion: 2,
      clients: [],
      cases: [
        {
          id: ids.case1,
          clientId: ids.client1,
          clientName: "JULES SAS",
          name: "Loan Maître",
          createdAt: "2026-11-01T12:00:00Z",
          documents: [],
          sourceEntryId: null,
        },
        {
          id: ids.case2,
          clientId: ids.client2,
          clientName: "test",
          name: "Lucien VAGINAY",
          createdAt: "2026-11-01T12:00:00Z",
          documents: [],
          sourceEntryId: null,
        },
      ],
    },
    quotes: {
      schemaVersion: 1,
      quotes: [
        {
          id: ids.quote1,
          commercialCaseId: ids.case1,
          model: { clientId: ids.client1 },
          status: "SENT",
          version: 1,
        },
        {
          id: ids.quote2,
          commercialCaseId: ids.case2,
          model: { clientId: ids.client2 },
          status: "ACCEPTED",
          version: 1,
        },
      ],
    },
    billing: {
      schemaVersion: 1,
      drafts: [
        {
          id: ids.draft1,
          commercialCaseId: ids.case1,
          chantierId: ids.site1,
          quoteId: ids.quote1,
          clientId: ids.client1,
          status: "APPROVED",
          type: "STANDARD",
        },
      ],
    },
    planning: {
      schemaVersion: 1,
      macroAllocations: [{ chantierId: ids.site1, week: "2026-W46", activity: "BE", hours: 4 }],
      provisionalAllocations: [
        { caseId: ids.case2, activity: "INSTALL", week: "2026-W47", hours: 3 },
      ],
      actualHours: [] as ActualHoursFixture[],
      chantierOrder: [ids.site1, ids.site2],
      provisionalOrder: [ids.case2],
      dailyAssignments: [{ chantierId: ids.site1, userId: "a", date: "2026-11-16", label: "Test" }],
    },
    entries: { schemaVersion: 1, entries: [], notifications: [] },
    purchases: { schemaVersion: 1, orders: [], nextNumber: 1 },
  };
  const states = Object.fromEntries(
    Object.entries(payloads).map(([key, payload]) => [
      key,
      { table: "papot_" + key + "_state", version: 1, payload },
    ]),
  );
  const clients = [
    { id: ids.client1, version: 1, record: { companyName: "JULES SAS" } },
    { id: ids.client2, version: 1, record: { companyName: "test" } },
  ];
  return { states, clients, payloads };
}

describe("one-off cancelled site cleanup", () => {
  it("targets exactly two cancelled chantiers and their invoices even when APPROVED", () => {
    const { states, clients } = fixture();
    const plan = planFor(states, clients);
    expect(plan.scope.sites.map((x: { id: string }) => x.id)).toEqual([ids.site1, ids.site2]);
    expect(plan.scope.factures).toEqual([{ id: ids.draft1, status: "APPROVED", type: "STANDARD" }]);
    expect(plan.clientsToDelete).toHaveLength(2);
    expect(plan.next.chantiers.chantiers).toEqual([]);
    expect(plan.next.commercial.cases).toEqual([]);
    expect(plan.next.quotes.quotes).toEqual([]);
    expect(plan.next.billing.drafts).toEqual([]);
    expect(plan.next.planning.macroAllocations).toEqual([]);
    expect(plan.next.planning.dailyAssignments).toEqual([]);
    expect(plan.signature).toHaveLength(16);
  });

  it("refuses deletion if a target site is not cancelled", () => {
    const { states, clients, payloads } = fixture();
    payloads.chantiers.payload.chantiers[0].status = "ACTIVE";
    expect(() => planFor(states, clients)).toThrow("CHANTIER_NOT_CANCELLED");
  });

  it("protects shared clients, leaving them in the client directory", () => {
    const { states, clients, payloads } = fixture();
    payloads.commercial.payload.cases.push({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Affaire réelle",
      clientId: ids.client1,
      clientName: "JULES SAS",
      createdAt: "2026-11-02T12:00:00Z",
      documents: [],
      sourceEntryId: null,
    });
    const plan = planFor(states, clients);
    expect(plan.scope.clientsKept).toContain(ids.client1);
    expect(plan.clientsToDelete).not.toContain(ids.client1);
    expect(plan.next.commercial.cases).toHaveLength(1);
  });

  it("refuses deletion if real employee hours exist", () => {
    const { states, clients, payloads } = fixture();
    payloads.planning.payload.actualHours.push({
      chantierId: ids.site1,
      userId: "employee",
      activity: "BE",
      week: "2026-W46",
      hours: 8,
    });
    expect(() => planFor(states, clients)).toThrow("REAL_EMPLOYEE_HOURS_EXIST");
  });

  it("refuses unmatched or duplicate names", () => {
    const { states, clients, payloads } = fixture();
    payloads.chantiers.payload.chantiers[0].name = "Autre affaire";
    expect(() => planFor(states, clients)).toThrow("CHANTIER_MATCH_NOT_UNIQUE");
  });

  it("refuses directory traversal", () => {
    expect(() => safeRelative("../file")).toThrow("UNSAFE_STORAGE_PATH");
    expect(() => safeRelative("/root/file")).toThrow("UNSAFE_STORAGE_PATH");
  });
});

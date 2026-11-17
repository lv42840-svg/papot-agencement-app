import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
process.env.PAPOT_PURGE_TEST_MODE = "1";
const { planFor, safeRelative, assertPayrollNotPrepared } =
  require("../scripts/ops/purge-two-test-chantiers.cjs") as {
    planFor: (
      states: Record<string, unknown>,
      clients: unknown[],
    ) => {
      scope: {
        sites: Array<{ id: string }>;
        factures: Array<{ id: string; status: string; type: string }>;
        commandesFournisseurs: Array<{
          id: string;
          reference: string;
          fournisseur: string;
          statut: string;
        }>;
        clientsKept: string[];
        testHoursToRemove: ActualHoursFixture[];
        planning: { historicalEdits: number; revisionKeys: number };
      };
      clientsToDelete: string[];
      next: {
        chantiers: { chantiers: unknown[] };
        commercial: { cases: unknown[] };
        quotes: { quotes: unknown[] };
        billing: { drafts: unknown[] };
        purchases: { orders: unknown[]; nextNumber: number };
        planning: {
          macroAllocations: unknown[];
          dailyAssignments: unknown[];
          actualHours: unknown[];
          editHistory: unknown[];
          editRevisions: Record<string, number>;
        };
      };
      signature: string;
    };
    safeRelative: (value: string) => string;
    assertPayrollNotPrepared: (
      payrollPayload: unknown,
      selectedHours: ActualHoursFixture[],
    ) => void;
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
      payrollWeekConfirmations: {} as Record<string, string>,
      editHistory: [] as Array<{
        revision: number;
        key: string;
        before: unknown;
        after: unknown;
        actorId: string;
        actorName: string;
        at: string;
      }>,
      editRevisions: {} as Record<string, number>,
      chantierOrder: [ids.site1, ids.site2],
      provisionalOrder: [ids.case2],
      dailyAssignments: [{ chantierId: ids.site1, userId: "a", date: "2026-11-16", label: "Test" }],
    },
    entries: { schemaVersion: 1, entries: [], notifications: [] },
    purchases: { schemaVersion: 1, orders: [] as Record<string, unknown>[], nextNumber: 1 },
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
    payloads.chantiers.chantiers[0].status = "ACTIVE";
    expect(() => planFor(states, clients)).toThrow("CHANTIER_NOT_CANCELLED");
  });

  it("protects shared clients, leaving them in the client directory", () => {
    const { states, clients, payloads } = fixture();
    payloads.commercial.cases.push({
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
    payloads.planning.actualHours.push({
      chantierId: ids.site1,
      userId: "employee",
      activity: "BE",
      week: "2026-W46",
      hours: 8,
    });
    expect(() => planFor(states, clients)).toThrow("REAL_EMPLOYEE_HOURS_EXIST");
  });

  it("accepts ONLY the three known 10-hour test entries from Lucien VAGINAY W41", () => {
    const { states, clients, payloads } = fixture();
    const id = "f1bc2388-99d5-42b3-a67e-d47e1316dfbd";
    payloads.planning.actualHours.push(
      { chantierId: ids.site2, userId: id, week: "2026-W41", activity: "BE", hours: 10 },
      { chantierId: ids.site2, userId: id, week: "2026-W41", activity: "WORKSHOP", hours: 10 },
      { chantierId: ids.site2, userId: id, week: "2026-W41", activity: "INSTALL", hours: 10 },
    );
    const plan = planFor(states, clients);
    expect(plan.scope.testHoursToRemove).toHaveLength(3);
    expect(plan.scope.testHoursToRemove.reduce((sum, row) => sum + row.hours, 0)).toBe(30);
    expect(plan.next.planning.actualHours).toEqual([]);
    assertPayrollNotPrepared({ months: [] }, plan.scope.testHoursToRemove);
    // October was validated as a test, but W41 used contractual hours,
    // not the 30 actual hours from the two cancelled test chantiers.
    const preparedOctober = {
      months: [
        {
          month: "2026-10",
          status: "PREPARED",
          validatedWeeks: [] as string[],
          eventLog: [{ action: "validate", at: "2026-11-09T16:12:17.477Z" }],
          versions: [
            {
              number: 1,
              summary: {
                rows: [
                  {
                    personId: id,
                    weeks: [
                      { week: "2026-W41", source: "CONTRACT", hours: 35 },
                      { week: "2026-W42", source: "REAL", hours: 40 },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(() =>
      assertPayrollNotPrepared(preparedOctober, plan.scope.testHoursToRemove),
    ).not.toThrow();

    const withRealTestHours = structuredClone(preparedOctober);
    withRealTestHours.months[0].versions[0].summary.rows[0].weeks[0].source = "REAL";
    expect(() => assertPayrollNotPrepared(withRealTestHours, plan.scope.testHoursToRemove)).toThrow(
      "PAYROLL_TEST_HOURS_USED_IN_VERSION",
    );

    const withValidatedTestWeek = structuredClone(preparedOctober);
    withValidatedTestWeek.months[0].validatedWeeks = [id + ":2026-W41"];
    expect(() =>
      assertPayrollNotPrepared(withValidatedTestWeek, plan.scope.testHoursToRemove),
    ).toThrow("PAYROLL_TEST_WEEK_VALIDATED");

    expect(() =>
      assertPayrollNotPrepared(
        { months: [{ month: "2026-10", status: "PREPARED", versions: [{}] }] },
        plan.scope.testHoursToRemove,
      ),
    ).toThrow("PAYROLL_SNAPSHOT_INCOMPLETE");
    payloads.planning.payrollWeekConfirmations = { [id + ":2026-W41"]: "confirmed" };
    expect(() => planFor(states, clients)).toThrow("PAYROLL_WEEK_CONFIRMED");
    payloads.planning.payrollWeekConfirmations = {};
    payloads.planning.actualHours[0].hours = 11;
    expect(() => planFor(states, clients)).toThrow("REAL_EMPLOYEE_HOURS_EXIST");
  });

  it("removes the three test-only planning history entries and three revisions", () => {
    const { states, clients, payloads } = fixture();
    const otherId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const targetKeys = [
      "2026-W42:user:" + ids.site1,
      "2026-W42:user:" + ids.site2,
      "2026-W41:user:" + ids.site2,
    ];
    for (const [index, key] of targetKeys.entries()) {
      const chantierId = index === 0 ? ids.site1 : ids.site2;
      payloads.planning.editHistory.push({
        revision: index + 1,
        key,
        before: [{ chantierId }],
        after: { chantierId },
        actorId: "editor",
        actorName: "Test",
        at: "2026-11-10T12:00:00Z",
      });
      payloads.planning.editRevisions[key] = index + 1;
    }
    const retained = "2026-W44:user:" + otherId;
    payloads.planning.editHistory.push({
      revision: 4,
      key: retained,
      before: [],
      after: { chantierId: otherId },
      actorId: "editor",
      actorName: "Test",
      at: "2026-11-10T12:00:00Z",
    });
    payloads.planning.editRevisions[retained] = 4;

    const result = planFor(states, clients);
    expect(result.scope.planning.historicalEdits).toBe(3);
    expect(result.scope.planning.revisionKeys).toBe(3);
    expect(result.next.planning.editHistory).toHaveLength(1);
    expect(result.next.planning.editHistory[0]).toMatchObject({ key: retained });
    expect(result.next.planning.editRevisions).toEqual({ [retained]: 4 });
  });

  it("blocks planning history shared with another chantier", () => {
    const { states, clients, payloads } = fixture();
    const otherId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    payloads.chantiers.chantiers.push({
      id: otherId,
      name: "Chantier réel",
      clientName: "Client réel",
      number: "2026-099",
      launchYear: 2026,
      sourceCommercialCaseId: otherId,
      status: "ACTIVE",
    });
    payloads.planning.editHistory.push({
      revision: 1,
      key: "2026-W42:user:" + ids.site2,
      before: [{ chantierId: ids.site2 }, { chantierId: otherId }],
      after: { chantierId: ids.site2 },
      actorId: "editor",
      actorName: "Test",
      at: "2026-11-10T12:00:00Z",
    });
    expect(() => planFor(states, clients)).toThrow("PLANNING_HISTORY_SHARED_RECORD");
  });

  it("blocks a shared planning revision key", () => {
    const { states, clients, payloads } = fixture();
    const otherId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    payloads.chantiers.chantiers.push({
      id: otherId,
      name: "Chantier réel",
      clientName: "Client réel",
      number: "2026-099",
      launchYear: 2026,
      sourceCommercialCaseId: otherId,
      status: "ACTIVE",
    });
    const mixedKey = "2026-W42:" + ids.site2 + ":" + otherId;
    payloads.planning.editRevisions[mixedKey] = 1;
    expect(() => planFor(states, clients)).toThrow("PLANNING_REVISION_SHARED_RECORD");
  });

  it("refuses to erase a history record whose key belongs to another chantier", () => {
    const { states, clients, payloads } = fixture();
    const key = "2026-W45:other";
    payloads.planning.editHistory.push({
      revision: 1,
      key,
      before: [{ chantierId: ids.site1 }],
      after: { chantierId: "other" },
      actorId: "editor",
      actorName: "Test",
      at: "2026-11-10T12:00:00Z",
    });
    expect(() => planFor(states, clients)).toThrow("PLANNING_HISTORY_SHARED_RECORD");
  });

  it("refuses unmatched or duplicate names", () => {
    const { states, clients, payloads } = fixture();
    payloads.chantiers.chantiers[0].name = "Autre affaire";
    expect(() => planFor(states, clients)).toThrow("CHANTIER_MATCH_NOT_UNIQUE");
  });

  it("includes only exclusive supplier orders, regardless of COMMITTED or CANCELLED status", () => {
    const { states, clients, payloads } = fixture();
    const bc1 = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      reference: "BC-000018",
      chantierId: ids.site1,
      chantierName: "Loan Maître",
      status: "COMMITTED",
      supplierName: "Fournisseur test",
      amountHtCents: 12500,
      mode: "QUICK",
      createdAt: "2026-11-01T12:00:00Z",
      allocations: [{ chantierId: ids.site1, destinationType: "CHANTIER", amountHtCents: 12500 }],
    };
    const bc2 = {
      ...bc1,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      reference: "BC-000019",
      chantierId: ids.site2,
      status: "CANCELLED",
      allocations: [{ chantierId: ids.site2, destinationType: "CHANTIER", amountHtCents: 12500 }],
    };
    payloads.purchases.orders.push(bc1, bc2);
    const plan = planFor(states, clients);
    expect(plan.scope.commandesFournisseurs).toHaveLength(2);
    expect(plan.scope.commandesFournisseurs.map((o) => o.reference)).toEqual([
      "BC-000018",
      "BC-000019",
    ]);
    expect(plan.next.purchases.orders).toHaveLength(0);
    expect(plan.next.purchases.nextNumber).toBe(1);
    expect(plan.scope.commandesFournisseurs[0].fournisseur).toBe("Fournisseur test");
  });

  it("refuses deleting a purchase order allocated to any other chantier", () => {
    const { states, clients, payloads } = fixture();
    payloads.purchases.orders.push({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      reference: "BC-000020",
      chantierId: ids.site1,
      status: "COMMITTED",
      supplierName: "Test",
      amountHtCents: 15000,
      allocations: [
        { chantierId: ids.site1, destinationType: "CHANTIER", amountHtCents: 10000 },
        {
          chantierId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          destinationType: "CHANTIER",
          amountHtCents: 5000,
        },
      ],
    });
    expect(() => planFor(states, clients)).toThrow("PURCHASE_ORDER_SHARED_OR_REASSIGNED");
  });

  it("refuses deleting a supplier order that was previously allocated elsewhere", () => {
    const { states, clients, payloads } = fixture();
    payloads.purchases.orders.push({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      reference: "BC-000021",
      chantierId: ids.site2,
      status: "CANCELLED",
      supplierName: "Test",
      amountHtCents: 4500,
      revisions: [{ previousChantierIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }],
    });
    expect(() => planFor(states, clients)).toThrow("PURCHASE_ORDER_SHARED_OR_REASSIGNED");
  });

  it("keeps unrelated orders in the supplier orders state", () => {
    const { states, clients, payloads } = fixture();
    payloads.purchases.orders.push({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      reference: "BC-000022",
      chantierId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      status: "COMMITTED",
      supplierName: "Autre client",
      amountHtCents: 5000,
    });
    const plan = planFor(states, clients);
    expect(plan.scope.commandesFournisseurs).toHaveLength(0);
    expect(plan.next.purchases.orders).toHaveLength(1);
  });

  it("checks supplier invoice allocations in Pennylane before any purge", () => {
    const scriptSource = require("node:fs").readFileSync(
      new URL("../scripts/ops/purge-two-test-chantiers.cjs", import.meta.url),
      "utf8",
    );
    expect(scriptSource).toContain("papot_pennylane_purchase_allocations");
    expect(scriptSource).toContain("plan.scope.commandesFournisseurs.map");
  });

  it("refuses directory traversal", () => {
    expect(() => safeRelative("../file")).toThrow("UNSAFE_STORAGE_PATH");
    expect(() => safeRelative("/root/file")).toThrow("UNSAFE_STORAGE_PATH");
  });
});

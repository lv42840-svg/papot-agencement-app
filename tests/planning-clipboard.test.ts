import { describe, expect, it } from "vitest";
import {
  formatPlanningSelection,
  planPlanningPaste,
  type PlanningClipboardCell,
  type PlanningClipboardRow,
} from "../src/lib/planning/clipboard";
import {
  applyPlanningHoursBatchMutation,
  planningMutationSchema,
} from "../src/lib/planning/mutations";
import { createInitialPlanningPayload } from "../src/lib/planning/domain";

const firmId = "11111111-1111-4111-8111-111111111111";
const anotherId = "22222222-2222-4222-8222-222222222222";
const caseId = "33333333-3333-4333-8333-333333333333";
const weeks = ["2026-W53", "2027-W01"];
const rows: PlanningClipboardRow[] = [firmId, anotherId].map((id, index) => ({
  id,
  activities: [
    { activity: "BE", weeklyHours: { "2026-W53": 12 + index } },
    { activity: "WORKSHOP", weeklyHours: { "2026-W53": 3.5 + index } },
    { activity: "INSTALL", weeklyHours: {} },
  ],
}));
const start: PlanningClipboardCell = {
  kind: "firm",
  id: firmId,
  activity: "BE",
  week: "2026-W53",
};

describe("planning Excel copy and paste", () => {
  it("copies a rectangular block with semicolon-free Excel-compatible tabs and decimal commas", () => {
    const end = { ...start, id: anotherId, activity: "WORKSHOP" as const };
    expect(formatPlanningSelection(start, end, rows, weeks, {})).toBe("12\t3,5\n13\t4,5");
  });

  it("pastes TSV across chantier rows, weeks and activities", () => {
    const updates = planPlanningPaste("5\t6\r\n7\t8\r\n", start, start, rows, weeks, () => false);
    expect(updates).toHaveLength(4);
    expect(updates).toMatchObject([
      { id: firmId, activity: "BE", week: "2026-W53", hours: 5 },
      { id: firmId, activity: "WORKSHOP", week: "2026-W53", hours: 6 },
      { id: anotherId, activity: "BE", week: "2026-W53", hours: 7 },
      { id: anotherId, activity: "WORKSHOP", week: "2026-W53", hours: 8 },
    ]);
    const crossing = planPlanningPaste(
      "2\t4",
      { ...start, activity: "INSTALL" },
      { ...start, activity: "INSTALL" },
      rows,
      weeks,
      () => false,
    );
    expect(crossing.map((update) => update.week)).toEqual(["2026-W53", "2027-W01"]);
  });

  it("fills a selected block with one copied value", () => {
    const end = { ...start, id: anotherId, activity: "WORKSHOP" as const };
    const updates = planPlanningPaste("12,5", start, end, rows, weeks, () => false);
    expect(updates).toHaveLength(4);
    expect(updates.every((update) => update.hours === 12.5)).toBe(true);
  });

  it("rejects invalid, past, out-of-bounds and oversized paste operations entirely", () => {
    expect(() => planPlanningPaste("5\tbad", start, start, rows, weeks, () => false)).toThrow();
    expect(() => planPlanningPaste("-1", start, start, rows, weeks, () => false)).toThrow();
    expect(() => planPlanningPaste("4", start, start, rows, weeks, () => true)).toThrow();
    expect(() =>
      planPlanningPaste(
        "2\t4",
        { ...start, week: "2027-W01", activity: "INSTALL" },
        { ...start, week: "2027-W01", activity: "INSTALL" },
        rows,
        weeks,
        () => false,
      ),
    ).toThrow();
    expect(() =>
      planPlanningPaste(
        Array.from({ length: 201 }, () => "1").join("\t"),
        start,
        start,
        rows,
        weeks,
        () => false,
      ),
    ).toThrow();
  });

  it("validates and persists a mixed batch atomically, supporting clearing with zero", () => {
    const source = createInitialPlanningPayload();
    const input = planningMutationSchema.parse({
      action: "setHoursBatch",
      updates: [
        { kind: "firm", id: firmId, activity: "BE", week: "2026-W53", hours: 15 },
        { kind: "provisional", id: caseId, activity: "INSTALL", week: "2027-W01", hours: 8 },
      ],
    });
    if (input.action !== "setHoursBatch") throw new Error("wrong action");
    const saved = applyPlanningHoursBatchMutation(
      source,
      input,
      new Set([firmId]),
      new Set([caseId]),
    );
    expect(saved.macroAllocations[0]).toMatchObject({ chantierId: firmId, hours: 15 });
    expect(saved.provisionalAllocations[0]).toMatchObject({ caseId, hours: 8 });
    expect(saved.provisionalOrder).toContain(caseId);
    expect(source.macroAllocations).toHaveLength(0);
    const cleared = applyPlanningHoursBatchMutation(
      saved,
      {
        action: "setHoursBatch",
        updates: [{ kind: "firm", id: firmId, activity: "BE", week: "2026-W53", hours: 0 }],
      },
      new Set([firmId]),
      new Set([caseId]),
    );
    expect(cleared.macroAllocations).toHaveLength(0);
  });

  it("rejects inactive or duplicate targets before modifying the stored payload", () => {
    const source = createInitialPlanningPayload();
    const bad = {
      kind: "firm" as const,
      id: anotherId,
      activity: "BE" as const,
      week: "2027-W01",
      hours: 1,
    };
    expect(() =>
      applyPlanningHoursBatchMutation(
        source,
        {
          action: "setHoursBatch",
          updates: [{ ...bad, id: firmId }, bad],
        },
        new Set([firmId]),
        new Set(),
      ),
    ).toThrow("PLANNING_CHANTIER_NOT_ACTIVE");
    expect(() =>
      applyPlanningHoursBatchMutation(
        source,
        {
          action: "setHoursBatch",
          updates: [
            { ...bad, id: firmId },
            { ...bad, id: firmId },
          ],
        },
        new Set([firmId]),
        new Set(),
      ),
    ).toThrow("PLANNING_BATCH_DUPLICATE_INVALID");
    expect(source.macroAllocations).toHaveLength(0);
    expect(() =>
      planningMutationSchema.parse({
        action: "setHoursBatch",
        updates: [{ ...bad, hours: -5 }],
      }),
    ).toThrow();
  });
});

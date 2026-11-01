import { describe, expect, it } from "vitest";
import { parsePlanningPayload } from "../src/lib/planning/domain";
import { payrollWeekSignature } from "../src/lib/planning/payroll-confirmation";
describe("payroll confirmation invalidation", () => {
  it("requires another confirmation after an edit, including changing a value back", () => {
    const planning = parsePlanningPayload(null);
    const id = "11111111-1111-4111-8111-111111111111";
    const original = payrollWeekSignature(planning, id, "2025-W01");
    planning.payrollWeekConfirmations = { [id + ":2025-W01"]: original };
    planning.editRevisions = { [`2025-W01:${id}:indirect:SAV`]: 2 };
    expect(payrollWeekSignature(planning, id, "2025-W01")).not.toBe(original);
    expect(payrollWeekSignature(planning, id, "2025-W02")).toBe(original);
  });
});

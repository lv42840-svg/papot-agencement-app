import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { addPayrollWeeklySheets } from "../src/lib/payroll/weekly-export";
import type { PayrollSummary } from "../src/lib/payroll/preparation";

function fixture(): PayrollSummary {
  return {
    month: "2025-01",
    generatedAt: "2025-02-01T00:00:00.000Z",
    rules: { start25: 35, start50: 43 },
    rows: [
      {
        personId: "11111111-1111-4111-8111-111111111111",
        name: "Lucien / Test",
        note: "Note à conserver",
        workedHours: 45,
        overtime25: 8,
        overtime50: 2,
        vacationDays: 0,
        contractWeeks: [],
        absences: [{ date: "2024-12-30", type: "SICK", hours: 2 }],
        weeks: [
          {
            week: "2025-W01",
            source: "REAL",
            hours: 45,
            baseHours: 35,
            absenceHours: 2,
            extra25: 8,
            extra50: 2,
          },
        ],
      },
    ],
  };
}
describe("weekly payroll workbook", () => {
  it("exports each person's saved weekly detail, cross-year dates and totals without counting overtime twice", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Synthèse");
    const summary = fixture();
    addPayrollWeeklySheets(workbook, summary);
    const bytes = await workbook.xlsx.writeBuffer();
    const restored = new ExcelJS.Workbook();
    await restored.xlsx.load(bytes);
    const sheet = restored.worksheets[1];
    expect(sheet.getRow(5).values).toEqual([
      undefined,
      "2025-W01",
      "2024-12-30",
      "2025-01-05",
      "Réalisé validé",
      35,
      2,
      45,
      35,
      8,
      2,
      "2024-12-30 · Maladie · 2 h",
    ]);
    expect(sheet.getCell("G6").value).toEqual({ formula: "SUM(G5:G5)", result: 45 });
    expect(sheet.getCell("B3").value).toBe("Note à conserver");
  });
  it("keeps custom sheets and gives distinct valid tab names to duplicate employee names", () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Synthèse");
    workbook.addWorksheet("Modèle personnel");
    const summary = fixture();
    summary.rows.push({ ...summary.rows[0], personId: "22222222-2222-4222-8222-222222222222" });
    summary.rows[1].weeks = [{ ...summary.rows[1].weeks[0], source: "CONTRACT" }];
    addPayrollWeeklySheets(workbook, summary);
    expect(workbook.worksheets).toHaveLength(4);
    expect(new Set(workbook.worksheets.map((sheet) => sheet.name)).size).toBe(4);
    expect(workbook.worksheets[3].getCell("D5").value).toBe("Base contrat · à confirmer");
    expect(workbook.getWorksheet("Modèle personnel")).toBeDefined();
  });
});

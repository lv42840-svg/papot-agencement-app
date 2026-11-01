import type ExcelJS from "exceljs";
import type { PayrollSummary } from "./preparation";
import { isoWeekDates } from "../planning/capacity";

const absenceLabels = { VACATION: "Congés", SICK: "Maladie", OTHER: "Autre absence" };

/** Use the selected summary only, so a frozen payroll version stays reproducible. */
export function addPayrollWeeklySheets(workbook: ExcelJS.Workbook, summary: PayrollSummary) {
  for (const person of summary.rows) {
    const base = `Paie - ${person.name}`
      .replace(/[\\/*?:\[\]]/g, " ")
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/^'+|'+$/g, "")
      .slice(0, 31);
    let name = base;
    let suffix = 2;
    while (
      workbook.worksheets.some(
        (sheet) => sheet.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      const tail = ` (${suffix++})`;
      name = base.slice(0, 31 - tail.length) + tail;
    }
    const sheet = workbook.addWorksheet(name);
    sheet.addRow([`Détail de paie · ${person.name} · ${summary.month}`]);
    sheet.addRow([
      "Semaines entières rattachées au mois de leur dimanche. Les heures majorées sont incluses dans les heures retenues.",
    ]);
    sheet.addRow(["Note paie", person.note]);
    sheet.addRow([
      "Semaine",
      "Du",
      "Au",
      "Origine",
      "Base contrat (h)",
      "Absences (h)",
      "Heures retenues",
      "Sans majoration (h)",
      "+25 % (h)",
      "+50 % (h)",
      "Détail des absences",
    ]);
    for (const week of person.weeks) {
      const dates = isoWeekDates(week.week).map((date) => date.toISOString().slice(0, 10));
      const absences = person.absences.filter((absence) => dates.includes(absence.date));
      sheet.addRow([
        week.week,
        dates[0],
        dates[6],
        week.source === "REAL" ? "Réalisé validé" : "Base contrat · à confirmer",
        week.baseHours,
        week.absenceHours,
        week.hours,
        Math.max(0, week.hours - week.extra25 - week.extra50),
        week.extra25,
        week.extra50,
        absences
          .map((absence) => `${absence.date} · ${absenceLabels[absence.type]} · ${absence.hours} h`)
          .join(" ; "),
      ]);
    }
    const last = sheet.rowCount;
    const total = sheet.addRow(["TOTAL DU MOIS"]);
    for (let col = 5; col <= 10; col++) {
      const letter = sheet.getColumn(col).letter;
      const sum = person.weeks.reduce(
        (value, week) =>
          value +
          [
            week.baseHours,
            week.absenceHours,
            week.hours,
            Math.max(0, week.hours - week.extra25 - week.extra50),
            week.extra25,
            week.extra50,
          ][col - 5],
        0,
      );
      total.getCell(col).value = person.weeks.length
        ? { formula: `SUM(${letter}5:${letter}${last})`, result: sum }
        : 0;
    }
    sheet.columns = [14, 14, 14, 32, 19, 18, 20, 23, 16, 16, 65].map((width) => ({ width }));
    sheet.getRow(4).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF78649B" } };
    total.font = { bold: true };
    for (let col = 5; col <= 10; col++) sheet.getColumn(col).numFmt = "0.00";
    sheet.getColumn(11).alignment = { wrapText: true, vertical: "top" };
    sheet.views = [{ state: "frozen", ySplit: 4 }];
    sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(4, last), column: 11 } };
    sheet.pageSetup = {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:4",
    };
  }
}

import type ExcelJS from "exceljs";
import type { PayrollSummary } from "./preparation";
import { isoWeekDates } from "../planning/capacity";

const absenceLabels = {
  VACATION: "Congés",
  SICK: "Maladie",
  OTHER: "Autre absence",
};

/** Use the selected summary only, so a frozen payroll version stays reproducible. */
export function addPayrollWeeklySheets(classeur: ExcelJS.Workbook, resume: PayrollSummary) {
  for (const personne of resume.rows) {
    const base = `Paie - ${personne.name}`
      .replace(/[\\/*?:\[\]]/g, " ")
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/^'+|'+$/g, "")
      .slice(0, 31);
    let nom = base;
    let suffixe = 2;
    while (
      classeur.worksheets.some(
        (feuille) => feuille.name.toLocaleLowerCase() === nom.toLocaleLowerCase(),
      )
    ) {
      const finNom = ` (${suffixe++})`;
      nom = base.slice(0, 31 - finNom.length) + finNom;
    }
    const feuille = classeur.addWorksheet(nom);
    feuille.addRow([`Détail de paie · ${personne.name} · ${resume.month}`]);
    feuille.addRow([
      "Semaines entières rattachées au mois de leur dimanche. Les heures majorées sont incluses dans les heures retenues.",
    ]);
    feuille.addRow(["Note paie", personne.note]);
    feuille.addRow([
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
    for (const semaine of personne.weeks) {
      const dates = isoWeekDates(semaine.week).map((date) => date.toISOString().slice(0, 10));
      const absences = personne.absences.filter((absence) => dates.includes(absence.date));
      feuille.addRow([
        semaine.week,
        dates[0],
        dates[6],
        semaine.source === "REAL" ? "Réalisé validé" : "Base contrat · à confirmer",
        semaine.baseHours,
        semaine.absenceHours,
        semaine.hours,
        Math.max(0, semaine.hours - semaine.extra25 - semaine.extra50),
        semaine.extra25,
        semaine.extra50,
        absences
          .map((absence) => `${absence.date} · ${absenceLabels[absence.type]} · ${absence.hours} h`)
          .join(" ; "),
      ]);
    }
    const derniereLigne = feuille.rowCount;
    const ligneTotal = feuille.addRow(["TOTAL DU MOIS"]);
    for (let colonne = 5; colonne <= 10; colonne++) {
      const lettre = feuille.getColumn(colonne).letter;
      const somme = personne.weeks.reduce(
        (valeur, semaine) =>
          valeur +
          [
            semaine.baseHours,
            semaine.absenceHours,
            semaine.hours,
            Math.max(0, semaine.hours - semaine.extra25 - semaine.extra50),
            semaine.extra25,
            semaine.extra50,
          ][colonne - 5],
        0,
      );
      ligneTotal.getCell(colonne).value = personne.weeks.length
        ? {
            formula: `SUM(${lettre}5:${lettre}${derniereLigne})`,
            result: somme,
          }
        : 0;
    }
    feuille.columns = [14, 14, 14, 32, 19, 18, 20, 23, 16, 16, 65].map((largeur) => ({
      width: largeur,
    }));
    feuille.getRow(4).font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    feuille.getRow(4).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF78649B" },
    };
    ligneTotal.font = { bold: true };
    for (let colonne = 5; colonne <= 10; colonne++) {
      feuille.getColumn(colonne).numFmt = "0.00";
    }
    feuille.getColumn(11).alignment = {
      wrapText: true,
      vertical: "top",
    };
    feuille.views = [{ state: "frozen", ySplit: 4 }];
    feuille.autoFilter = {
      from: { row: 4, column: 1 },
      to: {
        row: Math.max(4, derniereLigne),
        column: 11,
      },
    };
    feuille.pageSetup = {
      orientation: "landscape",
      paperSize: 9,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:4",
    };
  }
}

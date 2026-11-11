import { addPayrollWeeklySheets } from "@/lib/payroll/weekly-export";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import { readAuthPayload } from "@/lib/auth/store";
import { effectivePlanningPeople } from "@/lib/planning/personnel";
import { buildPayrollSummary, getMonthState } from "@/lib/payroll/preparation";
import { readPayrollPreparation } from "@/lib/payroll/preparation-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(requete: Request) {
  try {
    await requireModuleRequestContext("payroll", "WRITE");
    const url = new URL(requete.url);
    const mois = url.searchParams.get("month") ?? "";
    const version = url.searchParams.get("version") ?? "current";
    const [planning, auth, etat] = await Promise.all([
      createPlanningRepository().load(),
      readAuthPayload(),
      readPayrollPreparation(),
    ]);
    const period = getMonthState(etat, mois);
    const selectionne =
      version === "current"
        ? null
        : period.versions.find((ligneTableau) => String(ligneTableau.number) === version);
    if (version !== "current" && !selectionne) throw new Error("PAYROLL_VERSION_NOT_FOUND");
    const summary =
      selectionne?.summary ??
      buildPayrollSummary(
        mois,
        planning,
        effectivePlanningPeople(planning, auth.users),
        period,
        etat.rules,
      );
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PAPOT AGENCEMENT";
    if (etat.templateBase64)
      await workbook.xlsx.load(Buffer.from(etat.templateBase64, "base64") as never);
    const sheet = workbook.getWorksheet("Synthèse") ?? workbook.addWorksheet("Synthèse");
    if (sheet.rowCount) sheet.spliceRows(1, sheet.rowCount);
    sheet.addRow([
      `Préparation paie ${mois} · ${selectionne ? `V${selectionne.number}` : period.status === "REOPENED" ? "BROUILLON" : "DONNÉES ACTUELLES"}`,
    ]);
    sheet.addRow([
      selectionne
        ? `Validée le ${selectionne.validatedAt} par ${selectionne.validatedBy}`
        : "Document de travail, non validé",
    ]);
    sheet.addRow([]);
    sheet.addRow([
      "Salarié",
      "Heures retenues",
      "Heures +25 %",
      "Heures +50 %",
      "Congés (jours)",
      "Semaines base contrat",
      "Autres absences",
      "Note paie",
    ]);
    for (const ligneTableau of summary.rows)
      sheet.addRow([
        ligneTableau.name,
        ligneTableau.workedHours,
        ligneTableau.overtime25,
        ligneTableau.overtime50,
        ligneTableau.vacationDays,
        ligneTableau.contractWeeks.join(", "),
        ligneTableau.absences
          .filter((abs) => abs.type !== "VACATION")
          .map((abs) => `${abs.date} ${abs.type} ${abs.hours} h`)
          .join(" ; "),
        ligneTableau.note,
      ]);
    sheet.getRow(4).font = { bold: true };
    if (!etat.templateBase64)
      sheet.columns = [
        { width: 29 },
        { width: 18 },
        { width: 18 },
        { width: 18 },
        { width: 19 },
        { width: 35 },
        { width: 45 },
        { width: 45 },
      ];
    sheet.views = [{ state: "frozen", ySplit: 4 }];
    addPayrollWeeklySheets(workbook, summary);
    const bytes = await workbook.xlsx.writeBuffer();
    const filename = `Paie_${mois.replace("-", "_")}_${selectionne ? `V${selectionne.number}` : period.status === "REOPENED" ? "BROUILLON" : "ACTUEL"}.xlsx`;
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "PAYROLL_EXPORT_FAILED";
    return NextResponse.json({ error: code }, { status: desktopRequestErrorStatus(code) ?? 400 });
  }
}

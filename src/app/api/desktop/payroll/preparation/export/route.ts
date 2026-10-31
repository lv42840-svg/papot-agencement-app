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
export async function GET(request: Request) {
  try {
    await requireModuleRequestContext("payroll", "WRITE");
    const url = new URL(request.url);
    const month = url.searchParams.get("month") ?? "";
    const version = url.searchParams.get("version") ?? "current";
    const [planning, auth, state] = await Promise.all([
      createPlanningRepository().load(),
      readAuthPayload(),
      readPayrollPreparation(),
    ]);
    const period = getMonthState(state, month);
    const selected =
      version === "current" ? null : period.versions.find((row) => String(row.number) === version);
    if (version !== "current" && !selected) throw new Error("PAYROLL_VERSION_NOT_FOUND");
    const summary =
      selected?.summary ??
      buildPayrollSummary(
        month,
        planning,
        effectivePlanningPeople(planning, auth.users),
        period,
        state.rules,
      );
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "PAPOT AGENCEMENT";
    const sheet = workbook.addWorksheet("Synthèse");
    sheet.addRow([
      `Préparation paie ${month} · ${selected ? `V${selected.number}` : period.status === "REOPENED" ? "BROUILLON" : "DONNÉES ACTUELLES"}`,
    ]);
    sheet.addRow([
      selected
        ? `Validée le ${selected.validatedAt} par ${selected.validatedBy}`
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
    for (const row of summary.rows)
      sheet.addRow([
        row.name,
        row.workedHours,
        row.overtime25,
        row.overtime50,
        row.vacationDays,
        row.contractWeeks.join(", "),
        row.absences
          .filter((abs) => abs.type !== "VACATION")
          .map((abs) => `${abs.date} ${abs.type} ${abs.hours} h`)
          .join(" ; "),
        row.note,
      ]);
    sheet.getRow(4).font = { bold: true };
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
    const bytes = await workbook.xlsx.writeBuffer();
    const filename = `Paie_${month.replace("-", "_")}_${selected ? `V${selected.number}` : period.status === "REOPENED" ? "BROUILLON" : "ACTUEL"}.xlsx`;
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PAYROLL_EXPORT_FAILED";
    return NextResponse.json({ error: code }, { status: desktopRequestErrorStatus(code) ?? 400 });
  }
}

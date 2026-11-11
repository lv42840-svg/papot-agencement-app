import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requirePermissionAdministrator } from "@/lib/auth/user-admin";
import {
  readPayrollPreparation,
  updatePayrollPreparation,
} from "@/lib/payroll/preparation-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await requirePermissionAdministrator();
    const etat = await readPayrollPreparation();
    const workbook = new ExcelJS.Workbook();
    if (etat.templateBase64)
      await workbook.xlsx.load(Buffer.from(etat.templateBase64, "base64") as never);
    else {
      const sheet = workbook.addWorksheet("Synthèse");
      sheet.getColumn(1).width = 29;
      sheet.getColumn(2).width = 18;
    }
    const bytes = await workbook.xlsx.writeBuffer();
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="Modele_Paie.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Modèle indisponible ou accès administrateur requis." },
      { status: 403 },
    );
  }
}
export async function POST(requete: Request) {
  try {
    await requirePermissionAdministrator();
    const form = await requete.formData();
    const fichier = form.get("file");
    if (
      !(fichier instanceof File) ||
      fichier.size > 5_000_000 ||
      !fichier.name.toLowerCase().endsWith(".xlsx")
    )
      throw new Error("TEMPLATE_INVALID");
    const bytes = Buffer.from(await fichier.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as never);
    if (!workbook.getWorksheet("Synthèse")) throw new Error("TEMPLATE_SHEET_REQUIRED");
    await updatePayrollPreparation((etat) => ({
      ...etat,
      templateBase64: bytes.toString("base64"),
    }));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      {
        error:
          "Modèle refusé : fichier XLSX de moins de 5 Mo avec une feuille Synthèse requis, accès administrateur nécessaire.",
      },
      { status: 400 },
    );
  }
}

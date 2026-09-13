import { NextResponse } from "next/server";
import { analyzeObatFiles } from "@/lib/obat/parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusFor(code: string): number {
  if (code === "OBAT_FILES_REQUIRED" || code === "OBAT_NOT_RECOGNIZED") return 400;
  if (code === "OBAT_TOO_MANY_FILES") return 400;
  if (code === "OBAT_FILE_TOO_LARGE") return 413;
  if (code === "OBAT_DOCUMENT_NUMBER_MISMATCH") return 409;
  if (code === "OBAT_PDF_UNSUPPORTED") return 422;
  return 400;
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    const analysis = await analyzeObatFiles(files);
    return NextResponse.json(
      { analysis },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "OBAT_ANALYSIS_FAILED";
    console.error("[PAPOT][OBAT] analysis failed", { code });
    return NextResponse.json(
      { error: code },
      { status: statusFor(code), headers: { "Cache-Control": "no-store" } },
    );
  }
}

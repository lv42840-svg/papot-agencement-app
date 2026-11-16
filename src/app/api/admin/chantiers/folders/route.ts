import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermissionAdministrator, userAdminErrorStatus } from "@/lib/auth/user-admin";
import { auditChantierFolders, repairChantierFolder } from "@/lib/chantiers/folder-repair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  chantierId: z.string().uuid(),
  confirm: z.literal(true),
});

function noStoreJson(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}

function statusFor(code: string) {
  if (code === "AUTH_REQUIRED" || code === "ADMIN_FORBIDDEN" || code === "PASSWORD_CHANGE_REQUIRED") {
    return userAdminErrorStatus(code);
  }
  if (code === "CHANTIER_NOT_FOUND") return 404;
  if (code.includes("EXISTS") || code.includes("MULTIPLE") || code.includes("SHARED")) return 409;
  if (code.includes("MISSING") || code.includes("UNAVAILABLE") || code.includes("INTEGRITY")) return 409;
  if (code === "CHANTIER_FOLDER_REQUEST_INVALID") return 400;
  return 500;
}

export async function GET() {
  try {
    await requirePermissionAdministrator();
    const chantiers = await auditChantierFolders();
    return noStoreJson({ chantiers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CHANTIER_FOLDER_AUDIT_FAILED";
    return noStoreJson({ error: code }, statusFor(code));
  }
}

export async function POST(request: Request) {
  try {
    await requirePermissionAdministrator();
    const input = inputSchema.parse(await request.json().catch(() => null));
    const result = await repairChantierFolder(input.chantierId);
    return noStoreJson({ result });
  } catch (error) {
    const code = error instanceof z.ZodError
      ? "CHANTIER_FOLDER_REQUEST_INVALID"
      : error instanceof Error
        ? error.message
        : "CHANTIER_FOLDER_REPAIR_FAILED";
    console.error("[PAPOT][Admin] chantier folder repair", { code });
    return noStoreJson({ error: code }, statusFor(code));
  }
}

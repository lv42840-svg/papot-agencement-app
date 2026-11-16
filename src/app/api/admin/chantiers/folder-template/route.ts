import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermissionAdministrator, userAdminErrorStatus } from "@/lib/auth/user-admin";
import { folderTemplateActionSchema } from "@/lib/chantiers/folder-template";
import {
  loadChantierFolderTemplate,
  mutateChantierFolderTemplate,
} from "@/lib/chantiers/folder-template-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  expectedRevision: z.number().int().min(1),
  change: folderTemplateActionSchema,
});

function result(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "no-store" } });
}
function statusFor(code: string) {
  if (["AUTH_REQUIRED", "ADMIN_FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"].includes(code)) {
    return userAdminErrorStatus(code);
  }
  if (code === "CHANTIER_TEMPLATE_CONFLICT" || code.includes("DUPLICATE")) return 409;
  if (code.startsWith("CHANTIER_TEMPLATE_")) return 400;
  return 500;
}

export async function GET() {
  try {
    await requirePermissionAdministrator();
    return result({ template: await loadChantierFolderTemplate() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CHANTIER_TEMPLATE_LOAD_FAILED";
    return result({ error: code }, statusFor(code));
  }
}
export async function PUT(request: Request) {
  try {
    await requirePermissionAdministrator();
    const input = requestSchema.parse(await request.json().catch(() => null));
    return result({
      template: await mutateChantierFolderTemplate(input.expectedRevision, input.change),
    });
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? "CHANTIER_TEMPLATE_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "CHANTIER_TEMPLATE_SAVE_FAILED";
    return result({ error: code }, statusFor(code));
  }
}

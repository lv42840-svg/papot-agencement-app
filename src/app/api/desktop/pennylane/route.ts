import { NextResponse } from "next/server";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { pennylaneEnabled } from "@/lib/pennylane/config";
import { getPennylaneSnapshots } from "@/lib/pennylane/store";
import { synchronizePennylane } from "@/lib/pennylane/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "PENNYLANE_SYNC_FAILED";
  const allowed = [
    "AUTH_REQUIRED",
    "MODULE_FORBIDDEN",
    "PASSWORD_CHANGE_REQUIRED",
    "PENNYLANE_DISABLED",
    "PENNYLANE_NOT_CONFIGURED",
    "PENNYLANE_TOKEN_INVALID",
    "PENNYLANE_SCOPE_FORBIDDEN",
    "PENNYLANE_RATE_LIMITED",
    "PENNYLANE_NETWORK_ERROR",
    "PENNYLANE_COMPANY_MISMATCH",
    "PENNYLANE_ME_RESPONSE_INVALID",
    "PENNYLANE_PAGE_INVALID",
    "PENNYLANE_RESPONSE_INVALID",
    "PENNYLANE_CURSOR_INVALID",
    "PENNYLANE_PAGE_LIMIT",
    "PENNYLANE_RECORD_LIMIT",
    "PENNYLANE_ITEM_ID_INVALID",
    "PENNYLANE_HTTP_ERROR",
  ];
  const safeCode = allowed.includes(code) ? code : "PENNYLANE_SYNC_FAILED";
  const status =
    desktopRequestErrorStatus(safeCode) ??
    (safeCode === "PENNYLANE_DISABLED" || safeCode === "PENNYLANE_NOT_CONFIGURED"
      ? 503
      : safeCode === "PENNYLANE_SCOPE_FORBIDDEN"
        ? 424
        : safeCode === "PENNYLANE_COMPANY_MISMATCH"
          ? 409
          : 502);
  return json({ error: safeCode }, status);
}

/** Administrative metadata only. Never returns token or invoice payloads. */
export async function GET() {
  try {
    await requireModuleRequestContext("settings", "READ");
    if (!pennylaneEnabled()) return json({ enabled: false, snapshots: [] });
    return json({ enabled: true, snapshots: await getPennylaneSnapshots() });
  } catch (error) {
    return failure(error);
  }
}

/** Explicit administrator-only import. No background task, cron or automatic startup sync. */
export async function POST(request: Request) {
  try {
    const context = await requireModuleRequestContext("settings", "WRITE");
    if (!context.user.canManagePermissions) throw new Error("MODULE_FORBIDDEN");
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json"))
      return json({ error: "INVALID_REQUEST" }, 400);
    const body: unknown = await request.json();
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      (body as Record<string, unknown>).action !== "SYNC"
    ) {
      return json({ error: "INVALID_REQUEST" }, 400);
    }
    return json({ result: await synchronizePennylane() });
  } catch (error) {
    return failure(error);
  }
}

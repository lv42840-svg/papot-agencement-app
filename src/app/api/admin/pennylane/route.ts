import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermissionAdministrator, userAdminErrorStatus } from "@/lib/auth/user-admin";
import { probePennylaneAccess } from "@/lib/pennylane/client";
import {
  getPennylaneConnectionOverview,
  readPennylaneStoredConfig,
  recordPennylaneConnectionTest,
  removePennylaneConnection,
  savePennylaneConnection,
} from "@/lib/pennylane/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("SAVE"),
      token: z.string().min(20).max(2048).regex(/^\S+$/),
      expectedCompany: z.string().trim().min(2).max(120),
    })
    .strict(),
  z.object({ action: z.literal("TEST") }).strict(),
  z.object({ action: z.literal("REMOVE") }).strict(),
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") return false;
    return url.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function failure(error: unknown) {
  const code =
    error instanceof z.ZodError
      ? "PENNYLANE_REQUEST_INVALID"
      : error instanceof Error
        ? error.message
        : "PENNYLANE_ADMIN_ERROR";
  // Never return exception detail, API bodies, ciphertext or the submitted token.
  const safe = [
    "AUTH_REQUIRED",
    "PASSWORD_CHANGE_REQUIRED",
    "ADMIN_FORBIDDEN",
    "PENNYLANE_REQUEST_INVALID",
    "PENNYLANE_NOT_CONFIGURED",
    "PENNYLANE_TOKEN_INVALID",
    "PENNYLANE_SCOPE_FORBIDDEN",
    "PENNYLANE_NETWORK_ERROR",
    "PENNYLANE_RATE_LIMITED",
    "PENNYLANE_COMPANY_MISMATCH",
    "PENNYLANE_ME_RESPONSE_INVALID",
    "PENNYLANE_ENCRYPTION_KEY_MISSING",
    "PENNYLANE_ENCRYPTION_KEY_INVALID",
    "PENNYLANE_SECRET_UNREADABLE",
    "PENNYLANE_TOKEN_FORMAT_INVALID",
    "PENNYLANE_HTTP_ERROR",
  ].includes(code)
    ? code
    : "PENNYLANE_ADMIN_ERROR";
  const status = safe.startsWith("PENNYLANE_ENCRYPTION_")
    ? 503
    : safe === "PENNYLANE_NOT_CONFIGURED"
      ? 409
      : safe === "PENNYLANE_COMPANY_MISMATCH"
        ? 409
        : safe === "PENNYLANE_TOKEN_INVALID" || safe === "PENNYLANE_SCOPE_FORBIDDEN"
          ? 422
          : safe.startsWith("PENNYLANE_REQUEST_") || safe === "PENNYLANE_TOKEN_FORMAT_INVALID"
            ? 400
            : safe === "PENNYLANE_ADMIN_ERROR" || safe === "PENNYLANE_NETWORK_ERROR"
              ? 502
              : userAdminErrorStatus(safe);
  return json({ error: safe }, status);
}

/** No token, ciphertext, or token fragment in the response. */
export async function GET() {
  try {
    await requirePermissionAdministrator();
    return json({ connection: await getPennylaneConnectionOverview() });
  } catch (error) {
    return failure(error);
  }
}

/** Token saving, reading scopes and disconnecting require admin + same-origin POST. */
export async function POST(request: Request) {
  try {
    await requirePermissionAdministrator();
    if (!sameOrigin(request)) return json({ error: "PENNYLANE_ORIGIN_FORBIDDEN" }, 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "PENNYLANE_REQUEST_INVALID" }, 400);
    }
    const input = bodySchema.parse(await request.json().catch(() => null));
    if (input.action === "SAVE") {
      await savePennylaneConnection(input.token, input.expectedCompany);
      return json({ connection: await getPennylaneConnectionOverview() });
    }
    if (input.action === "REMOVE") {
      await removePennylaneConnection();
      return json({ connection: await getPennylaneConnectionOverview() });
    }
    const config = await readPennylaneStoredConfig();
    const test = await probePennylaneAccess(config);
    await recordPennylaneConnectionTest(test);
    return json({ test, connection: await getPennylaneConnectionOverview() });
  } catch (error) {
    return failure(error);
  }
}

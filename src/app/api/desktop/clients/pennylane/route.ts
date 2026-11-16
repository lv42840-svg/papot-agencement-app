import { NextResponse } from "next/server";
import { z } from "zod";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { pennylaneEnabled } from "@/lib/pennylane/config";
import {
  readPennylaneCustomerCatalog,
  refreshPennylaneCustomerCatalog,
  importPennylaneCustomer,
} from "@/lib/pennylane/customer-import-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("REFRESH") }).strict(),
  z
    .object({
      action: z.literal("IMPORT"),
      customerId: z.string().regex(/^\d{1,20}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("LINK"),
      customerId: z.string().regex(/^\d{1,20}$/),
      clientId: z.string().uuid(),
    })
    .strict(),
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const address = new URL(origin);
    if (process.env.NODE_ENV === "production" && address.protocol !== "https:") return false;
    return address.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function failure(error: unknown) {
  const code =
    error instanceof z.ZodError
      ? "PENNYLANE_CLIENT_REQUEST_INVALID"
      : error instanceof Error
        ? error.message
        : "PENNYLANE_CLIENT_FAILED";
  const known = [
    "AUTH_REQUIRED",
    "MODULE_FORBIDDEN",
    "PASSWORD_CHANGE_REQUIRED",
    "PENNYLANE_DISABLED",
    "PENNYLANE_NOT_CONFIGURED",
    "PENNYLANE_CUSTOMER_REQUEST_INVALID",
    "PENNYLANE_CLIENT_REQUEST_INVALID",
    "PENNYLANE_CUSTOMER_NOT_IMPORTED",
    "PENNYLANE_CUSTOMER_DATA_INVALID",
    "PENNYLANE_CUSTOMER_ID_INVALID",
    "PENNYLANE_CLIENT_LINK_REQUIRED",
    "PENNYLANE_CLIENT_LINK_CONFLICT",
    "PENNYLANE_CLIENT_SIRET_CONFLICT",
    "CLIENT_NOT_FOUND",
    "CLIENT_SIRET_EXISTS",
    "CLIENTS_VERSION_CONFLICT",
    "PENNYLANE_TOKEN_INVALID",
    "PENNYLANE_SCOPE_FORBIDDEN",
    "PENNYLANE_NETWORK_ERROR",
    "PENNYLANE_COMPANY_MISMATCH",
    "PENNYLANE_RATE_LIMITED",
    "PENNYLANE_PAGE_INVALID",
  ];
  const safe = known.includes(code) ? code : "PENNYLANE_CLIENT_FAILED";
  const status =
    desktopRequestErrorStatus(safe) ??
    (safe === "PENNYLANE_DISABLED" || safe === "PENNYLANE_NOT_CONFIGURED"
      ? 503
      : safe === "CLIENT_NOT_FOUND" || safe === "PENNYLANE_CUSTOMER_NOT_IMPORTED"
        ? 404
        : safe.includes("LINK") || safe.includes("CONFLICT") || safe === "CLIENT_SIRET_EXISTS"
          ? 409
          : safe === "PENNYLANE_CLIENT_FAILED"
            ? 500
            : 400);
  return json({ error: safe }, status);
}

export async function GET() {
  try {
    const context = await requireModuleRequestContext("clients", "READ");
    if (isLocalStorageMode() || !pennylaneEnabled()) {
      return json({
        enabled: false,
        synced: false,
        lastSyncedAt: null,
        count: 0,
        truncated: false,
        customers: [],
        existingClients: [],
        canWrite: context.moduleAccess.canWrite,
      });
    }
    return json({
      ...(await readPennylaneCustomerCatalog()),
      canWrite: context.moduleAccess.canWrite,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireModuleRequestContext("clients", "WRITE");
    if (!sameOrigin(request)) return json({ error: "PENNYLANE_ORIGIN_FORBIDDEN" }, 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "PENNYLANE_CLIENT_REQUEST_INVALID" }, 400);
    }
    if (isLocalStorageMode() || !pennylaneEnabled()) throw new Error("PENNYLANE_DISABLED");
    const body = bodySchema.parse(await request.json().catch(() => null));
    if (body.action === "REFRESH") {
      const count = await refreshPennylaneCustomerCatalog();
      return json({ count });
    }
    const result = await importPennylaneCustomer(
      body.action,
      body.customerId,
      body.action === "LINK" ? body.clientId : null,
      context.user.displayName,
    );
    return json(result);
  } catch (error) {
    return failure(error);
  }
}

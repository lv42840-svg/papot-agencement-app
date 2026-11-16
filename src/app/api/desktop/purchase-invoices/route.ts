import { NextResponse } from "next/server";
import { z } from "zod";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import { pennylaneEnabled } from "@/lib/pennylane/config";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { synchronizePennylane } from "@/lib/pennylane/sync";
import { invoiceAllocationDraftSchema } from "@/lib/pennylane/purchase-allocations";
import {
  readPurchaseInvoiceWorkspace,
  writePurchaseInvoiceAllocation,
} from "@/lib/pennylane/purchase-invoice-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const changeSchema = z
  .object({
    action: z.enum(["SAVE", "VALIDATE"]),
    invoiceId: z.string().regex(/^\d{1,20}$/),
    expectedVersion: z.number().int().min(0),
    expectedRevision: z.string().min(1).max(500),
    draft: invoiceAllocationDraftSchema,
  })
  .strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function errorResponse(error: unknown) {
  const code =
    error instanceof z.ZodError
      ? "INVOICE_REQUEST_INVALID"
      : error instanceof Error
        ? error.message
        : "INVOICE_ERROR";
  const safe = [
    "AUTH_REQUIRED",
    "PASSWORD_CHANGE_REQUIRED",
    "MODULE_FORBIDDEN",
    "INVOICE_REQUEST_INVALID",
    "INVOICE_SOURCE_CHANGED",
    "INVOICE_VERSION_CONFLICT",
    "INVOICE_NOT_IMPORTED",
    "INVOICE_CHANTIER_NOT_FOUND",
    "INVOICE_ORDER_NOT_FOUND",
    "INVOICE_POSSIBLE_DUPLICATE",
    "INVOICE_ALLOCATION_INCOMPLETE",
    "INVOICE_AMOUNT_INVALID",
    "INVOICE_CHARGE_NO_DESTINATION",
    "INVOICE_CHARGE_DESTINATION_UNKNOWN",
    "INVOICE_DESTINATION_INVALID",
    "INVOICE_ROW_DUPLICATE",
    "INVOICE_CHARGE_DUPLICATE",
    "INVOICE_ORDER_DUPLICATE",
    "INVOICE_GLOBAL_LINE_INVALID",
    "PENNYLANE_DISABLED",
    "PENNYLANE_NOT_CONFIGURED",
    "PENNYLANE_SCOPE_FORBIDDEN",
    "PENNYLANE_NETWORK_ERROR",
    "PENNYLANE_COMPANY_MISMATCH",
  ].includes(code)
    ? code
    : "INVOICE_ERROR";
  const status =
    desktopRequestErrorStatus(safe) ??
    (safe === "INVOICE_NOT_IMPORTED" ||
    safe === "INVOICE_ORDER_NOT_FOUND" ||
    safe === "INVOICE_CHANTIER_NOT_FOUND"
      ? 404
      : safe.includes("CONFLICT") || safe.includes("CHANGED") || safe.includes("DUPLICATE")
        ? 409
        : safe === "PENNYLANE_DISABLED" || safe === "PENNYLANE_NOT_CONFIGURED"
          ? 503
          : safe === "INVOICE_ERROR"
            ? 500
            : 400);
  return json({ error: safe }, status);
}

function sameOrigin(request: Request) {
  try {
    const origin = new URL(request.headers.get("origin") ?? "");
    const host = request.headers.get("host");
    return Boolean(
      host &&
        origin.host.toLowerCase() === host.toLowerCase() &&
        (process.env.NODE_ENV !== "production" || origin.protocol === "https:"),
    );
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const context = await requireModuleRequestContext("purchases", "READ");
    if (isLocalStorageMode()) {
      return json({
        invoices: [],
        suppliers: [],
        chantiers: [],
        orders: [],
        orderBalances: {},
        lastImportedAt: null,
        truncated: false,
        importEnabled: false,
        canWrite: context.moduleAccess.canWrite,
      });
    }
    return json({
      ...(await readPurchaseInvoiceWorkspace()),
      canWrite: context.moduleAccess.canWrite,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireModuleRequestContext("purchases", "WRITE");
    if (isLocalStorageMode()) throw new Error("PENNYLANE_DISABLED");
    if (!sameOrigin(request)) return json({ error: "INVOICE_ORIGIN_FORBIDDEN" }, 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "INVOICE_REQUEST_INVALID" }, 400);
    }
    const body: unknown = await request.json();
    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body).length === 1 &&
      (body as { action?: unknown }).action === "REFRESH"
    ) {
      if (!pennylaneEnabled()) throw new Error("PENNYLANE_DISABLED");
      // GET-only upstream requests, published atomically in staging.
      return json({ refreshed: await synchronizePennylane() });
    }
    const input = changeSchema.parse(body);
    const state = await writePurchaseInvoiceAllocation(
      input.action,
      input.invoiceId,
      input.expectedVersion,
      input.expectedRevision,
      input.draft,
      context.user.displayName,
    );
    return json({ state });
  } catch (error) {
    return errorResponse(error);
  }
}

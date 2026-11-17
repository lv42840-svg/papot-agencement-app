import { NextResponse } from "next/server";
import { z } from "zod";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import {
  addPurchaseOrder,
  cancelPurchaseOrder,
  updatePurchaseOrder,
  purchaseOrderInputSchema,
} from "@/lib/purchases/domain";
import { purchaseChantierNamesForInput } from "@/lib/purchases/destination-policy";
import { createPurchaseOrdersRepository } from "@/lib/purchases/repository";
import { readSupplierCatalog, refreshSupplierCatalog } from "@/lib/pennylane/suppliers";
import { isLocalStorageMode } from "@/lib/local-db/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("REFRESH_SUPPLIERS") }).strict(),
  z
    .object({
      action: z.literal("SET_SUPPLIER_PREFERENCE"),
      supplierPennylaneId: z.string().regex(/^\d{1,20}$/),
      defaultGeneralExpenses: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("SET_SUPPLIER_PREFERENCES"),
      supplierPennylaneIds: z.array(z.string().regex(/^\d{1,20}$/)).max(5000),
    })
    .strict(),
  z
    .object({
      action: z.literal("CREATE"),
      requestId: z.string().uuid(),
      order: purchaseOrderInputSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("UPDATE"),
      orderId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      order: purchaseOrderInputSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("CANCEL"),
      orderId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function statusOf(code: string) {
  const auth = desktopRequestErrorStatus(code);
  if (auth) return auth;
  if (code === "PURCHASE_ORDER_NOT_FOUND" || code === "PURCHASE_CHANTIER_NOT_FOUND") return 404;
  if (code === "PENNYLANE_DISABLED") return 503;
  if (
    code.includes("CONFLICT") ||
    code.includes("CANCELLED") ||
    code === "PURCHASE_CHANTIER_NOT_ACTIVE"
  )
    return 409;
  return 400;
}

export async function GET() {
  try {
    const context = await requireModuleRequestContext("purchases", "READ");
    const [payload, chantiers, supplierCatalog] = await Promise.all([
      createPurchaseOrdersRepository().load(),
      createChantiersRepository().load(),
      isLocalStorageMode()
        ? Promise.resolve({ suppliers: [], synced: false, syncedAt: null })
        : readSupplierCatalog(),
    ]);
    return json({
      payload,
      supplierCatalog,
      chantiers: chantiers.chantiers.map((site) => ({
        id: site.id,
        name: site.name,
        clientName: site.clientName,
        reference: site.reference,
        status: site.status,
      })),
      canWrite: context.moduleAccess.canWrite,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PURCHASE_ORDER_LOAD_FAILED";
    return json({ error: code }, statusOf(code));
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireModuleRequestContext("purchases", "WRITE");
    const input = requestSchema.parse(await request.json());
    if (input.action === "REFRESH_SUPPLIERS") {
      if (isLocalStorageMode()) throw new Error("PENNYLANE_LOCAL_UNAVAILABLE");
      return json({ supplierCount: await refreshSupplierCatalog() });
    }
    if (input.action === "SET_SUPPLIER_PREFERENCES") {
      if (isLocalStorageMode()) throw new Error("PENNYLANE_LOCAL_UNAVAILABLE");
      const catalog = await readSupplierCatalog();
      if (!catalog.synced) throw new Error("PURCHASE_SUPPLIER_PENNYLANE_REQUIRED");
      const allowed = new Set(catalog.suppliers.map((supplier) => supplier.id));
      const requested = new Set(input.supplierPennylaneIds);
      if (requested.size !== input.supplierPennylaneIds.length ||
          input.supplierPennylaneIds.some((id) => !allowed.has(id))) {
        throw new Error("PURCHASE_SUPPLIER_PENNYLANE_REQUIRED");
      }
      const payload = await createPurchaseOrdersRepository().mutate((current) => ({
        ...current,
        supplierPreferences: input.supplierPennylaneIds.map((supplierPennylaneId) => ({
          supplierPennylaneId,
          defaultDestination: "GENERAL_EXPENSES" as const,
        })),
      }));
      return json({ payload, canWrite: true });
    }
    if (input.action === "SET_SUPPLIER_PREFERENCE") {
      if (isLocalStorageMode()) throw new Error("PENNYLANE_LOCAL_UNAVAILABLE");
      const catalog = await readSupplierCatalog();
      if (
        !catalog.synced ||
        !catalog.suppliers.some((supplier) => supplier.id === input.supplierPennylaneId)
      )
        throw new Error("PURCHASE_SUPPLIER_PENNYLANE_REQUIRED");
      const payload = await createPurchaseOrdersRepository().mutate((current) => ({
        ...current,
        supplierPreferences: [
          ...(current.supplierPreferences ?? []).filter(
            (p) => p.supplierPennylaneId !== input.supplierPennylaneId,
          ),
          ...(input.defaultGeneralExpenses
            ? [
                {
                  supplierPennylaneId: input.supplierPennylaneId,
                  defaultDestination: "GENERAL_EXPENSES" as const,
                },
              ]
            : []),
        ],
      }));
      return json({ payload, canWrite: true });
    }
    if (input.action !== "CANCEL") {
      const catalog = isLocalStorageMode()
        ? { suppliers: [], synced: false, syncedAt: null }
        : await readSupplierCatalog();
      if (catalog.synced) {
        const supplier = catalog.suppliers.find(
          (row) => row.id === input.order.supplierPennylaneId,
        );
        if (!supplier || supplier.name !== input.order.supplierName) {
          throw new Error("PURCHASE_SUPPLIER_PENNYLANE_REQUIRED");
        }
      }
    }
    const sites =
      input.action === "CANCEL" ? [] : (await createChantiersRepository().load()).chantiers;
    const payload = await createPurchaseOrdersRepository().mutate((current) => {
      if (input.action === "CREATE") {
        // A lost HTTP response may be retried after the site has since closed.
        if (current.orders.some((order) => order.requestId === input.requestId)) return current;
        const chantierNames = purchaseChantierNamesForInput(input.order, sites);
        return addPurchaseOrder(
          current,
          input.requestId,
          input.order,
          chantierNames,
          context.user.displayName,
        );
      }
      if (input.action === "UPDATE") {
        const previous = current.orders.find((order) => order.id === input.orderId);
        if (!previous) throw new Error("PURCHASE_ORDER_NOT_FOUND");
        const chantierNames = purchaseChantierNamesForInput(input.order, sites, previous);
        return updatePurchaseOrder(
          current,
          input.orderId,
          input.expectedUpdatedAt,
          input.order,
          chantierNames,
          context.user.displayName,
        );
      }
      return cancelPurchaseOrder(
        current,
        input.orderId,
        input.expectedUpdatedAt,
        context.user.displayName,
      );
    });
    return json({ payload, canWrite: true });
  } catch (error) {
    const code =
      error instanceof z.ZodError
        ? "PURCHASE_ORDER_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "PURCHASE_ORDER_MUTATION_FAILED";
    return json({ error: code }, statusOf(code));
  }
}

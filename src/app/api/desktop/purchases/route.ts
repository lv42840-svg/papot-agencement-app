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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
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
  if (code.includes("CONFLICT") || code.includes("CANCELLED") || code === "PURCHASE_CHANTIER_NOT_ACTIVE") return 409;
  return 400;
}

export async function GET() {
  try {
    const context = await requireModuleRequestContext("purchases", "READ");
    const [payload, chantiers] = await Promise.all([
      createPurchaseOrdersRepository().load(),
      createChantiersRepository().load(),
    ]);
    return json({
      payload,
      chantiers: chantiers.chantiers.map((site) => ({
        id: site.id,
        name: site.name,
        clientName: site.clientName,
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
    const sites = input.action === "CANCEL"
      ? []
      : (await createChantiersRepository().load()).chantiers;
    const payload = await createPurchaseOrdersRepository().mutate((current) => {
      if (input.action === "CREATE") {
        // A lost HTTP response may be retried after the site has since closed.
        if (current.orders.some((order) => order.requestId === input.requestId)) return current;
        const chantierNames = purchaseChantierNamesForInput(input.order, sites);
        return addPurchaseOrder(current, input.requestId, input.order, chantierNames, context.user.displayName);
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
      return cancelPurchaseOrder(current, input.orderId, input.expectedUpdatedAt, context.user.displayName);
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

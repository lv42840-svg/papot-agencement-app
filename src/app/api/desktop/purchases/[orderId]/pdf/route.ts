import { z } from "zod";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { createPurchaseOrdersRepository } from "@/lib/purchases/repository";
import { generateDetailedPurchaseOrderPdf } from "@/lib/purchases/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    await requireModuleRequestContext("purchases", "READ");
    const { orderId } = await params;
    if (!z.string().uuid().safeParse(orderId).success) {
      return Response.json({ error: "PURCHASE_ORDER_NOT_FOUND" }, { status: 404 });
    }
    const payload = await createPurchaseOrdersRepository().load();
    const order = payload.orders.find((entry) => entry.id === orderId);
    if (!order || order.mode !== "DETAILED") {
      return Response.json({ error: "PURCHASE_ORDER_NOT_FOUND" }, { status: 404 });
    }
    const pdf = generateDetailedPurchaseOrderPdf(order);
    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${order.reference}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PURCHASE_ORDER_PDF_FAILED";
    return Response.json(
      { error: code },
      { status: desktopRequestErrorStatus(code) ?? 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

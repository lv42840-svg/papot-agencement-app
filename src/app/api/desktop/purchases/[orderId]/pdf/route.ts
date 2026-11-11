import { z } from "zod";
import {
  requireModuleRequestContext,
  desktopRequestErrorStatus,
} from "@/lib/desktop/request-context";
import { createPurchaseOrdersRepository } from "@/lib/purchases/repository";
import { generateDetailedPurchaseOrderPdf } from "@/lib/purchases/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params: parametres }: { params: Promise<{ orderId: string }> },
) {
  try {
    await requireModuleRequestContext("purchases", "READ");
    const { orderId: idCommande } = await parametres;
    if (!z.string().uuid().safeParse(idCommande).success) {
      return Response.json({ error: "PURCHASE_ORDER_NOT_FOUND" }, { status: 404 });
    }
    const contenu = await createPurchaseOrdersRepository().load();
    const commande = contenu.orders.find((entree) => entree.id === idCommande);
    if (!commande || commande.mode !== "DETAILED") {
      return Response.json({ error: "PURCHASE_ORDER_NOT_FOUND" }, { status: 404 });
    }
    const pdf = generateDetailedPurchaseOrderPdf(commande);
    return new Response(pdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${commande.reference}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "PURCHASE_ORDER_PDF_FAILED";
    return Response.json(
      { error: code },
      { status: desktopRequestErrorStatus(code) ?? 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

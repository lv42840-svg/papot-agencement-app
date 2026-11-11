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

function json(corps: unknown, statut = 200) {
  return NextResponse.json(corps, { status: statut, headers: { "Cache-Control": "no-store" } });
}

function statusOf(code: string) {
  const auth = desktopRequestErrorStatus(code);
  if (auth) return auth;
  if (code === "PURCHASE_ORDER_NOT_FOUND" || code === "PURCHASE_CHANTIER_NOT_FOUND") return 404;
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
    const contexte = await requireModuleRequestContext("purchases", "READ");
    const [contenu, chantiers] = await Promise.all([
      createPurchaseOrdersRepository().load(),
      createChantiersRepository().load(),
    ]);
    return json({
      payload: contenu,
      chantiers: chantiers.chantiers.map((site) => ({
        id: site.id,
        name: site.name,
        clientName: site.clientName,
        status: site.status,
      })),
      canWrite: contexte.moduleAccess.canWrite,
    });
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "PURCHASE_ORDER_LOAD_FAILED";
    return json({ error: code }, statusOf(code));
  }
}

export async function POST(requete: Request) {
  try {
    const contexte = await requireModuleRequestContext("purchases", "WRITE");
    const saisie = requestSchema.parse(await requete.json());
    const sites =
      saisie.action === "CANCEL" ? [] : (await createChantiersRepository().load()).chantiers;
    const contenu = await createPurchaseOrdersRepository().mutate((courant) => {
      if (saisie.action === "CREATE") {
        // A lost HTTP response may be retried after the site has since closed.
        if (courant.orders.some((commande) => commande.requestId === saisie.requestId))
          return courant;
        const chantierNames = purchaseChantierNamesForInput(saisie.order, sites);
        return addPurchaseOrder(
          courant,
          saisie.requestId,
          saisie.order,
          chantierNames,
          contexte.user.displayName,
        );
      }
      if (saisie.action === "UPDATE") {
        const precedent = courant.orders.find((commande) => commande.id === saisie.orderId);
        if (!precedent) throw new Error("PURCHASE_ORDER_NOT_FOUND");
        const chantierNames = purchaseChantierNamesForInput(saisie.order, sites, precedent);
        return updatePurchaseOrder(
          courant,
          saisie.orderId,
          saisie.expectedUpdatedAt,
          saisie.order,
          chantierNames,
          contexte.user.displayName,
        );
      }
      return cancelPurchaseOrder(
        courant,
        saisie.orderId,
        saisie.expectedUpdatedAt,
        contexte.user.displayName,
      );
    });
    return json({ payload: contenu, canWrite: true });
  } catch (erreur) {
    const code =
      erreur instanceof z.ZodError
        ? "PURCHASE_ORDER_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "PURCHASE_ORDER_MUTATION_FAILED";
    return json({ error: code }, statusOf(code));
  }
}

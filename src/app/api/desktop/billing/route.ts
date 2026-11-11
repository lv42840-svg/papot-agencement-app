import { NextResponse } from "next/server";
import { z } from "zod";

import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import {
  createBillingDraft,
  approveBillingDraft,
  updateBillingDraft,
  updateBillingDocument,
  billingTypeSchema,
  billingDocumentLineSchema,
  billingTitlesSchema,
} from "@/lib/billing/domain";
import { createBillingRepository } from "@/lib/billing/repository";
import { loadBillingSources } from "@/lib/billing/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const billingMutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("SET_TITLES"),
      invoiceTitles: billingTitlesSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("CREATE"),
      requestId: z.string().uuid(),
      quoteId: z.string().uuid(),
      chantierId: z.string().uuid().nullable().optional(),
      type: billingTypeSchema,
      amountHtCents: z.number().int().positive().safe().optional(),
      cumulativePercent: z.number().finite().gt(0).max(100).optional(),
      linePercentages: z
        .array(
          z
            .object({
              lineId: z.string().uuid(),
              percent: z.number().finite().min(0).max(100),
            })
            .strict(),
        )
        .max(1000)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("UPDATE"),
      draftId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      label: z.string().trim().min(1).max(240),
      notes: z.string().trim().max(4000),
      amountHtCents: z.number().int().positive().safe().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("UPDATE_DOCUMENT"),
      draftId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      label: z.string().trim().min(1).max(240),
      notes: z.string().trim().max(4000),
      documentLines: z.array(billingDocumentLineSchema).min(1).max(1000),
      linePercentages: z
        .array(
          z
            .object({
              lineId: z.string().uuid(),
              percent: z.number().finite().min(0).max(100),
            })
            .strict(),
        )
        .max(1000)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("APPROVE"),
      draftId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal("DELETE"),
      draftId: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
    })
    .strict(),
]);

function noStoreJson(donnees: unknown, statut = 200) {
  return NextResponse.json(donnees, { status: statut, headers: { "Cache-Control": "no-store" } });
}

function statusFor(code: string): number {
  const authStatus = desktopRequestErrorStatus(code);
  if (authStatus) return authStatus;
  if (code === "BILLING_DRAFT_NOT_FOUND" || code === "BILLING_QUOTE_NOT_AVAILABLE") return 404;
  if (
    code === "BILLING_VERSION_CONFLICT" ||
    code === "BILLING_AMOUNT_EXCEEDS_CONTRACT" ||
    code === "BILLING_CONTRACT_ALREADY_PREPARED" ||
    code === "BILLING_PROGRESS_CANNOT_DECREASE" ||
    code === "BILLING_PROGRESS_TAX_ALLOCATION_UNAVAILABLE" ||
    code === "BILLING_DRAFT_HAS_DEPENDENTS" ||
    code === "BILLING_DOCUMENT_EDIT_REQUIRED" ||
    code === "BILLING_DRAFT_LOCKED" ||
    code === "BILLING_APPROVAL_TOTALS_MISMATCH"
  )
    return 409;
  return 400;
}

export async function GET() {
  try {
    const contexte = await requireModuleRequestContext("billing", "READ");
    const [contenu, sources] = await Promise.all([
      createBillingRepository().load(),
      loadBillingSources(),
    ]);
    return noStoreJson({ payload: contenu, sources, canWrite: contexte.moduleAccess.canWrite });
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "BILLING_LOAD_FAILED";
    return noStoreJson({ error: code }, statusFor(code));
  }
}

export async function POST(requete: Request) {
  try {
    const contexte = await requireModuleRequestContext("billing", "WRITE");
    const analyse = billingMutationSchema.safeParse(await requete.json());
    if (!analyse.success) {
      const fields = [
        ...new Set(analyse.error.issues.map((issue) => issue.path.join(".") || "root")),
      ];
      return noStoreJson({ error: "BILLING_REQUEST_INVALID", fields }, 400);
    }
    const saisie = analyse.data;
    const sources = saisie.action === "CREATE" ? await loadBillingSources() : [];
    const repository = createBillingRepository();
    const contenu = await repository.mutate((courant) => {
      const brouillons = [...courant.drafts];
      if (saisie.action === "SET_TITLES") {
        return { ...courant, invoiceTitles: saisie.invoiceTitles };
      }
      if (saisie.action === "CREATE") {
        // Request IDs survive retries, including a retry after a connection timeout.
        if (brouillons.some((brouillon) => brouillon.requestId === saisie.requestId))
          return courant;
        const source = sources.find((candidat) => candidat.quoteId === saisie.quoteId);
        if (!source || (saisie.chantierId && source.chantierId !== saisie.chantierId)) {
          throw new Error("BILLING_QUOTE_NOT_AVAILABLE");
        }
        brouillons.push(createBillingDraft(courant, source, saisie, contexte.user.displayName));
      } else if (saisie.action === "APPROVE") {
        const indice = brouillons.findIndex((brouillon) => brouillon.id === saisie.draftId);
        if (indice < 0) throw new Error("BILLING_DRAFT_NOT_FOUND");
        brouillons[indice] = approveBillingDraft(
          courant,
          saisie.draftId,
          saisie.expectedUpdatedAt,
          contexte.user.displayName,
        );
      } else if (saisie.action === "UPDATE_DOCUMENT") {
        const indice = brouillons.findIndex((brouillon) => brouillon.id === saisie.draftId);
        if (indice < 0) throw new Error("BILLING_DRAFT_NOT_FOUND");
        brouillons[indice] = updateBillingDocument(
          courant,
          saisie.draftId,
          saisie,
          contexte.user.displayName,
        );
      } else if (saisie.action === "UPDATE") {
        const indice = brouillons.findIndex((brouillon) => brouillon.id === saisie.draftId);
        if (indice < 0) throw new Error("BILLING_DRAFT_NOT_FOUND");
        brouillons[indice] = updateBillingDraft(
          courant,
          saisie.draftId,
          saisie,
          contexte.user.displayName,
        );
      } else {
        const indice = brouillons.findIndex((brouillon) => brouillon.id === saisie.draftId);
        if (indice < 0) throw new Error("BILLING_DRAFT_NOT_FOUND");
        if (brouillons[indice].status !== "DRAFT") throw new Error("BILLING_DRAFT_LOCKED");
        if (brouillons[indice].updatedAt !== saisie.expectedUpdatedAt) {
          throw new Error("BILLING_VERSION_CONFLICT");
        }
        if (
          brouillons
            .slice(indice + 1)
            .some((brouillon) => brouillon.quoteId === brouillons[indice].quoteId)
        ) {
          throw new Error("BILLING_DRAFT_HAS_DEPENDENTS");
        }
        brouillons.splice(indice, 1);
      }
      return { ...courant, drafts: brouillons };
    });
    return noStoreJson({ payload: contenu, canWrite: true });
  } catch (erreur) {
    if (erreur instanceof z.ZodError) {
      const fields = [...new Set(erreur.issues.map((issue) => issue.path.join(".") || "root"))];
      console.error("[billing] Invalid stored billing data fields:", fields);
      return noStoreJson({ error: "BILLING_DRAFT_DATA_INVALID", fields }, 422);
    }
    const code = erreur instanceof Error ? erreur.message : "BILLING_MUTATION_FAILED";
    return noStoreJson({ error: code }, statusFor(code));
  }
}

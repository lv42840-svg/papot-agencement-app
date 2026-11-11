import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { chantierSpecialPermissionForMutation } from "@/lib/auth/action-permissions";
import {
  hasEffectiveSpecialPermission,
  hasModuleAccess,
  requireSpecialPermission,
} from "@/lib/auth/permissions";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import type { ChantiersPayload } from "@/lib/chantiers/domain";
import {
  chantierQuoteLineDisplay,
  resolveRetainedChantierQuoteLine,
} from "@/lib/chantiers/quote-links";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import {
  applyChantierMutation,
  assertChantierRevision,
  chantierCapabilities,
  chantierMutationSchema,
} from "@/lib/chantiers/mutations";
import { ChantiersRepositoryError } from "@/lib/chantiers/repository";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import { actualHoursByActivity } from "@/lib/planning/actual-hours";
import { buildChantierPlanningCloseWarning } from "@/lib/planning/domain";
import {
  removeFirmPlanningForChantier,
  restoreFirmPlanningOrderForChantier,
} from "@/lib/planning/mutations";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { readMonthlyLaborCosts } from "@/lib/payroll/monthly-labor-costs-repository";
import { calculateChantierLaborCostEstimate } from "@/lib/payroll/chantier-labor-cost";
import {
  committedOrdersForChantier,
  committedPurchaseTotal,
  purchaseCloseReviewToken,
  removeChantierPurchaseCommitments,
} from "@/lib/purchases/domain";
import { createPurchaseOrdersRepository } from "@/lib/purchases/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Owner = { userId: string; deviceId: string; displayName: string };
type PermissionUser = { id: string };

function mutationNeedsCommercialOrigin(saisie: { action: string }): boolean {
  return (
    saisie.action === "createBeItem" ||
    saisie.action === "createWorkshopItem" ||
    saisie.action === "setQuoteLineProgress"
  );
}

function noStoreJson(corps: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(corps, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

async function snapshot(
  contenu: ChantiersPayload,
  owner: Owner,
  utilisateur: PermissionUser,
  canWrite: boolean,
  focusChantierId?: string,
) {
  const auteur = { userId: owner.userId, displayName: owner.displayName };
  const baseCapabilities = chantierCapabilities(auteur);
  const planningPayload = await createPlanningRepository().load();
  const maintenant = new Date();
  const canViewLaborCosts = await hasModuleAccess(utilisateur.id, "payroll", "READ");
  const monthlyCosts = canViewLaborCosts ? await readMonthlyLaborCosts() : null;
  const [canLaunchSpecial, canCloseReopenSpecial, canArchiveSpecial] = await Promise.all([
    hasEffectiveSpecialPermission(utilisateur, "commercial.confirm_launch"),
    hasEffectiveSpecialPermission(utilisateur, "chantiers.close_reopen"),
    hasEffectiveSpecialPermission(utilisateur, "chantiers.archive_reactivate"),
  ]);
  const canReadPurchases =
    (await hasModuleAccess(utilisateur.id, "purchases", "READ")) ||
    (canWrite && canCloseReopenSpecial);
  const purchasePayload = canReadPurchases ? await createPurchaseOrdersRepository().load() : null;
  // Reconcile the chantier's read-only production metrics from the real hours register.
  // Do not write the projection into the chantier repository: the planning ledger is the source.
  const realizedChantierIds = new Set(
    planningPayload.actualHours.map((entree) => entree.chantierId),
  );
  const viewPayload: ChantiersPayload = {
    ...contenu,
    chantiers: contenu.chantiers.map((chantier) => {
      if (!realizedChantierIds.has(chantier.id)) return chantier;
      return {
        ...chantier,
        actualHours: actualHoursByActivity(
          planningPayload.actualHours.filter((entree) => entree.chantierId === chantier.id),
        ),
      };
    }),
  };
  const laborEstimates = monthlyCosts
    ? new Map(
        contenu.chantiers.map((chantier) => [
          chantier.id,
          calculateChantierLaborCostEstimate(
            chantier.id,
            planningPayload.actualHours,
            monthlyCosts.records,
            planningPayload.peopleCapacity,
            maintenant,
          ),
        ]),
      )
    : null;
  return {
    payload: viewPayload,
    actualLaborCostsByChantier: Object.fromEntries(
      contenu.chantiers.map((chantier) => [
        chantier.id,
        laborEstimates?.get(chantier.id)?.costCents ?? null,
      ]),
    ),
    provisionalLaborCostsByChantier: Object.fromEntries(
      contenu.chantiers.map((chantier) => [
        chantier.id,
        laborEstimates?.get(chantier.id)?.provisional ?? false,
      ]),
    ),
    actor: auteur,
    canRemovePurchaseCommitments: await hasModuleAccess(utilisateur.id, "purchases", "WRITE"),
    committedPurchasesByChantier: purchasePayload
      ? Object.fromEntries(
          contenu.chantiers.map((chantier) => [
            chantier.id,
            committedPurchaseTotal(purchasePayload, chantier.id),
          ]),
        )
      : null,
    purchaseCloseWarnings: purchasePayload
      ? Object.fromEntries(
          contenu.chantiers.map((chantier) => {
            const orders = committedOrdersForChantier(purchasePayload, chantier.id);
            return [
              chantier.id,
              {
                orders,
                count: orders.length,
                amountHtCents: orders.reduce(
                  (total, commande) => total + commande.amountHtCents,
                  0,
                ),
                token: purchaseCloseReviewToken(orders),
              },
            ];
          }),
        )
      : null,
    capabilities: {
      ...baseCapabilities,
      canRead: true,
      canModify: canWrite,
      canLaunch: canWrite && canLaunchSpecial,
      canCloseReopen: canWrite && canCloseReopenSpecial,
      canArchive: canWrite && canArchiveSpecial,
    },
    focusChantierId,
    planningCloseWarnings: Object.fromEntries(
      contenu.chantiers.map((chantier) => [
        chantier.id,
        buildChantierPlanningCloseWarning(chantier, planningPayload, maintenant),
      ]),
    ),
    serverNow: maintenant.toISOString(),
  };
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "CHANTIERS_LOCKED") return 423;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_FORBIDDEN")) return 403;
  if (code.includes("CONFLICT") || code.includes("READ_ONLY")) return 409;
  return 400;
}

export async function GET() {
  try {
    const contexte = await requireModuleRequestContext("chantiers", "READ");
    const repository = createChantiersRepository(contexte);
    const contenu = await repository.load();

    const owner = {
      userId: contexte.user.id,
      deviceId: contexte.user.id,
      displayName: contexte.user.displayName,
    };
    return noStoreJson(
      await snapshot(contenu, owner, contexte.user, contexte.moduleAccess.canWrite),
    );
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "CHANTIERS_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}

export async function POST(requete: Request) {
  const startedAt = Date.now();
  let stage = "parse-request";

  try {
    const raw = (await requete.json()) as Record<string, unknown>;
    const saisie = chantierMutationSchema.parse(raw);
    const expectedUpdatedAt =
      typeof raw.expectedUpdatedAt === "string" ? raw.expectedUpdatedAt.trim() : "";
    if (!expectedUpdatedAt) throw new Error("CHANTIERS_VERSION_REQUIRED");
    stage = "create-runtime";
    const contexte = await requireModuleRequestContext("chantiers", "WRITE");
    const requiredSpecialPermission = chantierSpecialPermissionForMutation(saisie);
    if (requiredSpecialPermission) {
      await requireSpecialPermission(contexte.user, requiredSpecialPermission);
    }

    const repository = createChantiersRepository(contexte);
    const owner = {
      userId: contexte.user.id,
      deviceId: contexte.user.id,
      displayName: contexte.user.displayName,
    };
    const auteur = { userId: owner.userId, displayName: owner.displayName };
    const commercialRepository = mutationNeedsCommercialOrigin(saisie)
      ? createCommercialRepository()
      : null;
    const commercial = commercialRepository ? await commercialRepository.load() : null;
    const quotes = mutationNeedsCommercialOrigin(saisie)
      ? await createQuotesRepository().load()
      : null;

    // The Pennylane reconciliation is not connected yet: all active BC allocations
    // are unverified. Require an explicit keep/remove decision before closing.
    if (saisie.action === "markDone") {
      stage = "review-purchase-orders";
      const chantierBefore = (await repository.load()).chantiers.find(
        (candidat) => candidat.id === saisie.chantierId,
      );
      if (!chantierBefore) throw new Error("CHANTIER_NOT_FOUND");
      assertChantierRevision(chantierBefore, expectedUpdatedAt);
      if (chantierBefore.status !== "ACTIVE") throw new Error("CHANTIER_NOT_ACTIVE");
      const purchasesRepo = createPurchaseOrdersRepository();
      const outstanding = committedOrdersForChantier(await purchasesRepo.load(), saisie.chantierId);
      const token = purchaseCloseReviewToken(outstanding);
      if (outstanding.length > 0) {
        if (!saisie.purchaseReview) throw new Error("CHANTIER_PURCHASE_REVIEW_REQUIRED");
        if (saisie.purchaseReview.token !== token) {
          throw new Error("CHANTIER_PURCHASE_REVIEW_CONFLICT");
        }
        if (saisie.purchaseReview.decision === "REMOVE") {
          if (saisie.purchaseReview.confirmRemove !== true) {
            throw new Error("CHANTIER_PURCHASE_REMOVE_CONFIRMATION_REQUIRED");
          }
          if (!(await hasModuleAccess(contexte.user.id, "purchases", "WRITE"))) {
            throw new Error("CHANTIER_PURCHASE_REMOVE_FORBIDDEN");
          }
          // Preserve other chantier allocations and the original BC audit trail.
          // This operation precedes closing so failure cannot silently mark the
          // chantier done while leaving purchases unresolved. A concurrent change
          // to the chantier itself may still require the operator to retry.
          await purchasesRepo.mutate((courant) => {
            if (
              purchaseCloseReviewToken(committedOrdersForChantier(courant, saisie.chantierId)) !==
              token
            ) {
              throw new Error("CHANTIER_PURCHASE_REVIEW_CONFLICT");
            }
            return removeChantierPurchaseCommitments(
              courant,
              saisie.chantierId,
              contexte.user.displayName,
            );
          });
        }
      }
    }

    stage = "apply-and-save-mutation";
    const mutation = await repository.mutate((contenu) => {
      const openedChantier = contenu.chantiers.find(
        (candidat) => candidat.id === saisie.chantierId,
      );
      if (!openedChantier) throw new Error("CHANTIER_NOT_FOUND");
      assertChantierRevision(openedChantier, expectedUpdatedAt);

      let normalizedInput = saisie;

      if (mutationNeedsCommercialOrigin(saisie)) {
        const chantier = contenu.chantiers.find((candidat) => candidat.id === saisie.chantierId);
        if (!chantier) throw new Error("CHANTIER_NOT_FOUND");
        const affair = commercial?.cases.find(
          (candidat) => candidat.id === chantier.sourceCommercialCaseId,
        );
        if (!affair) throw new Error("CHANTIER_COMMERCIAL_CASE_NOT_FOUND");
        if (!quotes) throw new Error("CHANTIER_QUOTES_UNAVAILABLE");

        if (saisie.action === "createBeItem" || saisie.action === "createWorkshopItem") {
          if (!saisie.sourceQuoteId || !saisie.sourceQuoteLineId) {
            throw new Error("CHANTIER_QUOTE_LINE_REQUIRED");
          }
          const reference = resolveRetainedChantierQuoteLine(
            affair,
            quotes,
            saisie.sourceQuoteId,
            saisie.sourceQuoteLineId,
          );
          normalizedInput = {
            ...saisie,
            originKind: reference.quoteKind === "TS" ? "TS" : "QUOTE_LINE",
            originLabel: chantierQuoteLineDisplay(reference),
            sourceQuoteId: reference.quoteId,
            sourceQuoteLineId: reference.quoteLineId,
          };
        }

        if (saisie.action === "setQuoteLineProgress") {
          const reference = resolveRetainedChantierQuoteLine(
            affair,
            quotes,
            saisie.quoteId,
            saisie.quoteLineId,
          );
          normalizedInput = {
            ...saisie,
            quoteId: reference.quoteId,
            quoteLineId: reference.quoteLineId,
            quoteLineLabel: chantierQuoteLineDisplay(reference),
          };
        }
      }

      return applyChantierMutation(contenu, normalizedInput, auteur);
    });

    if (
      saisie.action === "markDone" ||
      saisie.action === "cancel" ||
      saisie.action === "reactivate" ||
      saisie.action === "unarchive"
    ) {
      stage = "sync-planning-lifecycle";
      await createPlanningRepository().mutate((contenu) => {
        if (saisie.action === "markDone" || saisie.action === "cancel") {
          return removeFirmPlanningForChantier(contenu, saisie.chantierId);
        }
        return restoreFirmPlanningOrderForChantier(contenu, saisie.chantierId);
      });
    }

    console.info("[PAPOT][Chantiers] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(
      await snapshot(mutation.payload, owner, contexte.user, true, mutation.focusChantierId),
    );
  } catch (erreur) {
    const code =
      erreur instanceof ZodError
        ? "CHANTIERS_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "CHANTIERS_MUTATION_FAILED";
    console.error("[PAPOT][Chantiers] POST failed", { stage, code, ms: Date.now() - startedAt });
    const corps =
      erreur instanceof ChantiersRepositoryError && erreur.details?.lockedBy
        ? { error: code, lockedBy: erreur.details.lockedBy }
        : { error: code };
    return noStoreJson(corps, { status: statusFor(code) });
  }
}

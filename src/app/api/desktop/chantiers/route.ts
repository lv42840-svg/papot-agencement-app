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
import { calculateChantierLaborCostCents } from "@/lib/payroll/chantier-labor-cost";
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

function mutationNeedsCommercialOrigin(input: { action: string }): boolean {
  return (
    input.action === "createBeItem" ||
    input.action === "createWorkshopItem" ||
    input.action === "setQuoteLineProgress"
  );
}

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function snapshot(
  payload: ChantiersPayload,
  owner: Owner,
  user: PermissionUser,
  canWrite: boolean,
  focusChantierId?: string,
) {
  const actor = { userId: owner.userId, displayName: owner.displayName };
  const baseCapabilities = chantierCapabilities(actor);
  const planningPayload = await createPlanningRepository().load();
  const now = new Date();
  const canViewLaborCosts = await hasModuleAccess(user.id, "payroll", "READ");
  const monthlyCosts = canViewLaborCosts ? await readMonthlyLaborCosts() : null;
  const [canLaunchSpecial, canCloseReopenSpecial, canArchiveSpecial] = await Promise.all([
    hasEffectiveSpecialPermission(user, "commercial.confirm_launch"),
    hasEffectiveSpecialPermission(user, "chantiers.close_reopen"),
    hasEffectiveSpecialPermission(user, "chantiers.archive_reactivate"),
  ]);
  const canReadPurchases =
    (await hasModuleAccess(user.id, "purchases", "READ")) ||
    (canWrite && canCloseReopenSpecial);
  const purchasePayload = canReadPurchases ? await createPurchaseOrdersRepository().load() : null;
  // Reconcile the chantier's read-only production metrics from the real hours register.
  // Do not write the projection into the chantier repository: the planning ledger is the source.
  const realizedChantierIds = new Set(planningPayload.actualHours.map((entry) => entry.chantierId));
  const viewPayload: ChantiersPayload = {
    ...payload,
    chantiers: payload.chantiers.map((chantier) => {
      if (!realizedChantierIds.has(chantier.id)) return chantier;
      return {
        ...chantier,
        actualHours: actualHoursByActivity(
          planningPayload.actualHours.filter((entry) => entry.chantierId === chantier.id),
        ),
      };
    }),
  };
  return {
    payload: viewPayload,
    actualLaborCostsByChantier: Object.fromEntries(
      payload.chantiers.map((chantier) => [
        chantier.id,
        monthlyCosts
          ? calculateChantierLaborCostCents(
              chantier.id,
              planningPayload.actualHours,
              monthlyCosts.records,
              planningPayload.peopleCapacity,
            )
          : null,
      ]),
    ),
    actor,
    committedPurchasesByChantier: purchasePayload
      ? Object.fromEntries(
          payload.chantiers.map((chantier) => [
            chantier.id,
            committedPurchaseTotal(purchasePayload, chantier.id),
          ]),
        )
      : null,
    purchaseCloseWarnings: purchasePayload
      ? Object.fromEntries(
          payload.chantiers.map((chantier) => {
            const orders = committedOrdersForChantier(purchasePayload, chantier.id);
            return [
              chantier.id,
              {
                orders,
                count: orders.length,
                amountHtCents: orders.reduce((total, order) => total + order.amountHtCents, 0),
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
      payload.chantiers.map((chantier) => [
        chantier.id,
        buildChantierPlanningCloseWarning(chantier, planningPayload, now),
      ]),
    ),
    serverNow: now.toISOString(),
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
    const context = await requireModuleRequestContext("chantiers", "READ");
    const repository = createChantiersRepository(context);
    const payload = await repository.load();

    const owner = {
      userId: context.user.id,
      deviceId: context.user.id,
      displayName: context.user.displayName,
    };
    return noStoreJson(await snapshot(payload, owner, context.user, context.moduleAccess.canWrite));
  } catch (error) {
    const code = error instanceof Error ? error.message : "CHANTIERS_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let stage = "parse-request";

  try {
    const raw = (await request.json()) as Record<string, unknown>;
    const input = chantierMutationSchema.parse(raw);
    const expectedUpdatedAt =
      typeof raw.expectedUpdatedAt === "string" ? raw.expectedUpdatedAt.trim() : "";
    if (!expectedUpdatedAt) throw new Error("CHANTIERS_VERSION_REQUIRED");
    stage = "create-runtime";
    const context = await requireModuleRequestContext("chantiers", "WRITE");
    const requiredSpecialPermission = chantierSpecialPermissionForMutation(input);
    if (requiredSpecialPermission) {
      await requireSpecialPermission(context.user, requiredSpecialPermission);
    }

    const repository = createChantiersRepository(context);
    const owner = {
      userId: context.user.id,
      deviceId: context.user.id,
      displayName: context.user.displayName,
    };
    const actor = { userId: owner.userId, displayName: owner.displayName };
    const commercialRepository = mutationNeedsCommercialOrigin(input)
      ? createCommercialRepository()
      : null;
    const commercial = commercialRepository ? await commercialRepository.load() : null;
    const quotes = mutationNeedsCommercialOrigin(input)
      ? await createQuotesRepository().load()
      : null;

    // The Pennylane reconciliation is not connected yet: all active BC allocations
    // are unverified. Require an explicit keep/remove decision before closing.
    if (input.action === "markDone") {
      stage = "review-purchase-orders";
      const chantierBefore = (await repository.load()).chantiers.find(
        (candidate) => candidate.id === input.chantierId,
      );
      if (!chantierBefore) throw new Error("CHANTIER_NOT_FOUND");
      assertChantierRevision(chantierBefore, expectedUpdatedAt);
      if (chantierBefore.status !== "ACTIVE") throw new Error("CHANTIER_NOT_ACTIVE");
      const purchasesRepo = createPurchaseOrdersRepository();
      const outstanding = committedOrdersForChantier(await purchasesRepo.load(), input.chantierId);
      const token = purchaseCloseReviewToken(outstanding);
      if (outstanding.length > 0) {
        if (!input.purchaseReview) throw new Error("CHANTIER_PURCHASE_REVIEW_REQUIRED");
        if (input.purchaseReview.token !== token) {
          throw new Error("CHANTIER_PURCHASE_REVIEW_CONFLICT");
        }
        if (input.purchaseReview.decision === "REMOVE") {
          // Preserve other chantier allocations and the original BC audit trail.
          // This operation precedes closing so failure cannot silently mark the
          // chantier done while leaving purchases unresolved. A concurrent change
          // to the chantier itself may still require the operator to retry.
          await purchasesRepo.mutate((current) => {
            if (
              purchaseCloseReviewToken(committedOrdersForChantier(current, input.chantierId)) !==
              token
            ) {
              throw new Error("CHANTIER_PURCHASE_REVIEW_CONFLICT");
            }
            return removeChantierPurchaseCommitments(
              current,
              input.chantierId,
              context.user.displayName,
            );
          });
        }
      }
    }

    stage = "apply-and-save-mutation";
    const mutation = await repository.mutate((payload) => {
      const openedChantier = payload.chantiers.find(
        (candidate) => candidate.id === input.chantierId,
      );
      if (!openedChantier) throw new Error("CHANTIER_NOT_FOUND");
      assertChantierRevision(openedChantier, expectedUpdatedAt);

      let normalizedInput = input;

      if (mutationNeedsCommercialOrigin(input)) {
        const chantier = payload.chantiers.find((candidate) => candidate.id === input.chantierId);
        if (!chantier) throw new Error("CHANTIER_NOT_FOUND");
        const affair = commercial?.cases.find(
          (candidate) => candidate.id === chantier.sourceCommercialCaseId,
        );
        if (!affair) throw new Error("CHANTIER_COMMERCIAL_CASE_NOT_FOUND");
        if (!quotes) throw new Error("CHANTIER_QUOTES_UNAVAILABLE");

        if (input.action === "createBeItem" || input.action === "createWorkshopItem") {
          if (!input.sourceQuoteId || !input.sourceQuoteLineId) {
            throw new Error("CHANTIER_QUOTE_LINE_REQUIRED");
          }
          const reference = resolveRetainedChantierQuoteLine(
            affair,
            quotes,
            input.sourceQuoteId,
            input.sourceQuoteLineId,
          );
          normalizedInput = {
            ...input,
            originKind: reference.quoteKind === "TS" ? "TS" : "QUOTE_LINE",
            originLabel: chantierQuoteLineDisplay(reference),
            sourceQuoteId: reference.quoteId,
            sourceQuoteLineId: reference.quoteLineId,
          };
        }

        if (input.action === "setQuoteLineProgress") {
          const reference = resolveRetainedChantierQuoteLine(
            affair,
            quotes,
            input.quoteId,
            input.quoteLineId,
          );
          normalizedInput = {
            ...input,
            quoteId: reference.quoteId,
            quoteLineId: reference.quoteLineId,
            quoteLineLabel: chantierQuoteLineDisplay(reference),
          };
        }
      }

      return applyChantierMutation(payload, normalizedInput, actor);
    });

    if (
      input.action === "markDone" ||
      input.action === "cancel" ||
      input.action === "reactivate" ||
      input.action === "unarchive"
    ) {
      stage = "sync-planning-lifecycle";
      await createPlanningRepository().mutate((payload) => {
        if (input.action === "markDone" || input.action === "cancel") {
          return removeFirmPlanningForChantier(payload, input.chantierId);
        }
        return restoreFirmPlanningOrderForChantier(payload, input.chantierId);
      });
    }

    console.info("[PAPOT][Chantiers] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(
      await snapshot(mutation.payload, owner, context.user, true, mutation.focusChantierId),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "CHANTIERS_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "CHANTIERS_MUTATION_FAILED";
    console.error("[PAPOT][Chantiers] POST failed", { stage, code, ms: Date.now() - startedAt });
    const body =
      error instanceof ChantiersRepositoryError && error.details?.lockedBy
        ? { error: code, lockedBy: error.details.lockedBy }
        : { error: code };
    return noStoreJson(body, { status: statusFor(code) });
  }
}

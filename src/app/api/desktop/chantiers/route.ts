import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { chantierSpecialPermissionForMutation } from "@/lib/auth/action-permissions";
import { hasEffectiveSpecialPermission, requireSpecialPermission } from "@/lib/auth/permissions";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import type { ChantiersPayload } from "@/lib/chantiers/domain";
import {
  chantierQuoteLineDisplay,
  resolveRetainedChantierQuoteLine,
} from "@/lib/chantiers/quote-links";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import {
  applyChantierMutation,
  chantierCapabilities,
  chantierMutationSchema,
} from "@/lib/chantiers/mutations";
import { ChantiersRepositoryError } from "@/lib/chantiers/repository";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";

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
  const [canLaunchSpecial, canArchiveSpecial] = await Promise.all([
    hasEffectiveSpecialPermission(user, "commercial.confirm_launch"),
    hasEffectiveSpecialPermission(user, "chantiers.archive_reactivate"),
  ]);
  return {
    payload,
    actor,
    capabilities: {
      ...baseCapabilities,
      canRead: true,
      canModify: canWrite,
      canLaunch: canWrite && canLaunchSpecial,
      canArchive: canWrite && canArchiveSpecial,
    },
    focusChantierId,
    serverNow: new Date().toISOString(),
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
    const context = await requireDesktopRequestContext("chantiers", "READ");
    const repository = createChantiersRepository(context);
    const payload = await repository.load();

    return noStoreJson(
      await snapshot(payload, context.owner, context.user, context.moduleAccess.canWrite),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "CHANTIERS_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let stage = "parse-request";

  try {
    const input = chantierMutationSchema.parse(await request.json());
    stage = "create-runtime";
    const context = await requireDesktopRequestContext("chantiers", "WRITE");
    const requiredSpecialPermission = chantierSpecialPermissionForMutation(input);
    if (requiredSpecialPermission) {
      await requireSpecialPermission(context.user, requiredSpecialPermission);
    }

    const repository = createChantiersRepository(context);
    const actor = { userId: context.owner.userId, displayName: context.owner.displayName };
    const commercialRepository = mutationNeedsCommercialOrigin(input)
      ? await createCommercialRepository(context)
      : null;
    const commercial = commercialRepository ? await commercialRepository.load() : null;
    const quotes = mutationNeedsCommercialOrigin(input)
      ? await createQuotesRepository().load()
      : null;

    stage = "apply-and-save-mutation";
    const mutation = await repository.mutate((payload) => {
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

    console.info("[PAPOT][Chantiers] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(
      await snapshot(mutation.payload, context.owner, context.user, true, mutation.focusChantierId),
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

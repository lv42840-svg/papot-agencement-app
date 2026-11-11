import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { commercialSpecialPermissionForMutation } from "@/lib/auth/action-permissions";
import { hasEffectiveSpecialPermission, requireSpecialPermission } from "@/lib/auth/permissions";
import { createClientsRepository } from "@/lib/clients/create-repository";
import type { ClientsRepository } from "@/lib/clients/repository";
import {
  hydrateCommercialPayloadWithCanonicalClients,
  listCanonicalCommercialClients,
  resolveCommercialClient,
  type ResolvedCommercialClient,
} from "@/lib/commercial/client-integration";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import {
  applyCommercialAutomaticTransitions,
  type CommercialPayload,
} from "@/lib/commercial/domain";
import {
  applyCommercialMutation,
  assertCommercialRevision,
  commercialMutationSchema,
  listCommercialPeople,
  type CommercialMutation,
  type CommercialMutationResult,
} from "@/lib/commercial/mutations";
import { CommercialRepositoryError, type CommercialRepository } from "@/lib/commercial/repository";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import { createPlanningRepository } from "@/lib/planning/create-repository";
import {
  clearPlanningProvisionForCommercialCase,
  syncPlanningPotentialOrderForCommercialCase,
} from "@/lib/planning/mutations";
import {
  assertForecastQuoteSelection,
  effectiveCommercialForecastHours,
} from "@/lib/commercial/forecast-quotes";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import {
  validateAdditionalRetainedQuote,
  validateRetainedQuoteSelection,
} from "@/lib/quotes/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Owner = { userId: string; deviceId: string; displayName: string };
type RawRequest = Record<string, unknown>;

function noStoreJson(corps: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(corps, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

function rawString(raw: RawRequest, cle: string): string | undefined {
  const valeur = raw[cle];
  return typeof valeur === "string" && valeur.trim() ? valeur.trim() : undefined;
}

function confirmationRequested(saisie: CommercialMutation): boolean {
  return (
    (saisie.action === "setStatus" && saisie.status === "CONFIRMED") ||
    (saisie.action === "recordFollowUp" && saisie.nextStatus === "CONFIRMED")
  );
}

function caseIdForMutation(saisie: CommercialMutation): string | null {
  if (saisie.action === "create") return null;
  return "caseId" in saisie ? saisie.caseId : null;
}

function planningProvisionMustBeCleared(saisie: CommercialMutation): boolean {
  return (
    saisie.action === "close" ||
    saisie.action === "reopen" ||
    (saisie.action === "recordFollowUp" &&
      (saisie.nextStatus === "LOST" || saisie.nextStatus === "ABANDONED"))
  );
}

async function validateAdditionalQuoteRetention(saisie: CommercialMutation): Promise<void> {
  if (saisie.action !== "retainAdditionalQuote") return;
  const quotes = await createQuotesRepository().load();
  validateAdditionalRetainedQuote(quotes, saisie.caseId, saisie.quoteId);
}

async function validateConfirmationQuoteSelection(saisie: CommercialMutation): Promise<void> {
  let idAffaire: string;
  let retainedQuoteIds: string[];
  let confirmWithoutQuote: boolean;

  if (saisie.action === "setStatus" && saisie.status === "CONFIRMED") {
    idAffaire = saisie.caseId;
    retainedQuoteIds = saisie.retainedQuoteIds ?? [];
    confirmWithoutQuote = saisie.confirmWithoutQuote === true;
  } else if (saisie.action === "recordFollowUp" && saisie.nextStatus === "CONFIRMED") {
    idAffaire = saisie.caseId;
    retainedQuoteIds = saisie.retainedQuoteIds ?? [];
    confirmWithoutQuote = saisie.confirmWithoutQuote === true;
  } else {
    return;
  }

  const quotes = await createQuotesRepository().load();
  validateRetainedQuoteSelection(quotes, idAffaire, retainedQuoteIds, confirmWithoutQuote);
}

function linkResolvedClient(
  mutation: CommercialMutationResult,
  resolvedClient: ResolvedCommercialClient,
  actorName: string,
): void {
  if (!mutation.focusCaseId) return;
  const element = mutation.payload.cases.find((candidat) => candidat.id === mutation.focusCaseId);
  if (!element) throw new Error("COMMERCIAL_CASE_NOT_FOUND");

  const previousClientId = element.clientId ?? null;
  const previousName = element.clientName ?? null;
  element.clientId = resolvedClient.id;
  element.primaryContactId = null;
  element.clientName = resolvedClient.displayName;

  if (previousClientId !== resolvedClient.id || previousName !== resolvedClient.displayName) {
    element.history.push({
      id: randomUUID(),
      type: "CLIENT_LINKED",
      at: new Date().toISOString(),
      actorName,
      summary: `Client lié : ${resolvedClient.displayName}.`,
    });
  }
}

async function snapshot(
  contenu: CommercialPayload,
  owner: Owner,
  canWrite: boolean,
  utilisateur: { id: string },
  clients: ClientsRepository,
  focusCaseId?: string,
) {
  const auteur = { userId: owner.userId, displayName: owner.displayName };
  const [canCreate, canProvision, canConfirm, canonicalClients] = await Promise.all([
    hasEffectiveSpecialPermission(utilisateur, "commercial.create"),
    hasEffectiveSpecialPermission(utilisateur, "commercial.provision"),
    hasEffectiveSpecialPermission(utilisateur, "commercial.confirm_launch"),
    listCanonicalCommercialClients(clients),
  ]);
  const payloadForUi = hydrateCommercialPayloadWithCanonicalClients(contenu, canonicalClients);
  return {
    payload: payloadForUi,
    actor: auteur,
    capabilities: {
      canCreate: canWrite && canCreate,
      canRead: true,
      canModify: canWrite,
      canProvision: canWrite && canProvision,
      canConfirm: canWrite && canConfirm,
    },
    suggestedPeople: listCommercialPeople(payloadForUi, auteur),
    focusCaseId,
    serverNow: new Date().toISOString(),
  };
}

function statusFor(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "COMMERCIAL_LOCKED" || code === "CLIENTS_LOCKED") return 423;
  if (code.endsWith("_NOT_FOUND")) return 404;
  if (code.endsWith("_FORBIDDEN")) return 403;
  if (
    code.includes("CONFLICT") ||
    code.includes("CLOSED") ||
    code === "COMMERCIAL_CLIENT_INCOMPLETE"
  ) {
    return 409;
  }
  return 400;
}

async function persistAutomaticTransitions(
  repository: CommercialRepository,
): Promise<CommercialPayload> {
  const mutation = await repository.mutate((source) => {
    const transition = applyCommercialAutomaticTransitions(source);
    return {
      payload: transition.payload,
      shouldPersist: transition.changed,
    };
  });
  return mutation.payload;
}

export async function GET() {
  try {
    const contexte = await requireModuleRequestContext("commercial", "READ");
    const repository = createCommercialRepository();
    const clients = await createClientsRepository();
    const analyse = await repository.load();
    const transition = applyCommercialAutomaticTransitions(analyse);

    const contenu =
      transition.changed && contexte.moduleAccess.canWrite
        ? await persistAutomaticTransitions(repository)
        : transition.payload;

    const owner = {
      userId: contexte.user.id,
      deviceId: contexte.user.id,
      displayName: contexte.user.displayName,
    };
    return noStoreJson(
      await snapshot(contenu, owner, contexte.moduleAccess.canWrite, contexte.user, clients),
    );
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "COMMERCIAL_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}

export async function POST(requete: Request) {
  const startedAt = Date.now();
  let stage = "parse-request";

  try {
    const raw = (await requete.json()) as RawRequest;
    const saisie = commercialMutationSchema.parse(raw);
    const expectedUpdatedAt =
      saisie.action === "create" ? null : rawString(raw, "expectedUpdatedAt");
    if (saisie.action !== "create" && !expectedUpdatedAt) {
      throw new Error("COMMERCIAL_VERSION_REQUIRED");
    }
    stage = "create-runtime";
    const contexte = await requireModuleRequestContext("commercial", "WRITE");
    const requiredSpecialPermission = commercialSpecialPermissionForMutation(saisie);
    if (requiredSpecialPermission) {
      await requireSpecialPermission(contexte.user, requiredSpecialPermission);
    }

    const repository = createCommercialRepository();
    const clients = await createClientsRepository();
    const owner = {
      userId: contexte.user.id,
      deviceId: contexte.user.id,
      displayName: contexte.user.displayName,
    };
    const auteur = { userId: owner.userId, displayName: owner.displayName };
    let resolvedClient: ResolvedCommercialClient | null = null;

    const buildMutation = async (
      source: CommercialPayload,
      isRetry: boolean,
    ): Promise<CommercialMutationResult> => {
      if (saisie.action !== "create") {
        const courant = source.cases.find((candidat) => candidat.id === saisie.caseId);
        if (!courant) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        assertCommercialRevision(courant, expectedUpdatedAt!);
      }

      if (confirmationRequested(saisie)) {
        const idAffaire = caseIdForMutation(saisie);
        const element = idAffaire
          ? source.cases.find((candidat) => candidat.id === idAffaire)
          : null;
        if (!element) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        await validateConfirmationQuoteSelection(saisie);
      }
      if (saisie.action === "retainAdditionalQuote") {
        const element = source.cases.find((candidat) => candidat.id === saisie.caseId);
        if (!element) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        if (element.status !== "CONFIRMED") throw new Error("COMMERCIAL_NOT_CONFIRMED");
        await validateAdditionalQuoteRetention(saisie);
      }

      if (saisie.action === "setForecastQuotes") {
        const quotes = await createQuotesRepository().load();
        assertForecastQuoteSelection(saisie.caseId, saisie.quoteIds, quotes.quotes);
      }

      const resultat = applyCommercialMutation(source, saisie, auteur);

      if (saisie.action === "create" || saisie.action === "updateDetails") {
        const currentItem =
          saisie.action === "updateDetails"
            ? source.cases.find((candidat) => candidat.id === saisie.caseId)
            : null;
        if (saisie.action === "updateDetails" && !currentItem) {
          throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        }

        if (!resolvedClient) {
          if (isRetry) throw new Error("COMMERCIAL_CLIENT_RESOLUTION_LOST");
          stage = "resolve-client";
          resolvedClient = await resolveCommercialClient({
            clients,
            actor: auteur,
            existingClientId: rawString(raw, "existingClientId"),
            newClientName: saisie.clientName,
            currentClientId: currentItem?.clientId ?? null,
          });
        }
        linkResolvedClient(resultat, resolvedClient, auteur.displayName);
      }

      return resultat;
    };

    stage = "apply-and-save-mutation";
    const mutation = await repository.mutate(buildMutation);

    if (planningProvisionMustBeCleared(saisie)) {
      const idAffaire = caseIdForMutation(saisie);
      if (!idAffaire) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
      stage = "clear-planning-provision";
      await createPlanningRepository().mutate((contenu) =>
        clearPlanningProvisionForCommercialCase(contenu, idAffaire),
      );
    } else if (
      saisie.action === "updateProvision" ||
      saisie.action === "setForecastQuotes" ||
      saisie.action === "useManualProvision"
    ) {
      const element = mutation.payload.cases.find((candidat) => candidat.id === saisie.caseId);
      if (!element) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
      const quotePayload = await createQuotesRepository().load();
      const heures = effectiveCommercialForecastHours(element, quotePayload.quotes);
      const hasProvisionReference = heures.be > 0 || heures.workshop > 0 || heures.install > 0;
      stage = "sync-planning-potential-order";
      await createPlanningRepository().mutate((contenu) =>
        syncPlanningPotentialOrderForCommercialCase(contenu, saisie.caseId, hasProvisionReference),
      );
    }

    console.info("[PAPOT][Commercial] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(
      await snapshot(mutation.payload, owner, true, contexte.user, clients, mutation.focusCaseId),
    );
  } catch (erreur) {
    const code =
      erreur instanceof ZodError
        ? "COMMERCIAL_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "COMMERCIAL_MUTATION_FAILED";
    console.error("[PAPOT][Commercial] POST failed", {
      stage,
      code,
      ms: Date.now() - startedAt,
    });
    const corps =
      erreur instanceof CommercialRepositoryError && erreur.details?.lockedBy
        ? { error: code, lockedBy: erreur.details.lockedBy }
        : { error: code };
    return noStoreJson(corps, { status: statusFor(code) });
  }
}

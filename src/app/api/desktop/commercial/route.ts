import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { commercialSpecialPermissionForMutation } from "@/lib/auth/action-permissions";
import { hasEffectiveSpecialPermission, requireSpecialPermission } from "@/lib/auth/permissions";
import { createClientsRepository } from "@/lib/clients/create-repository";
import type { ClientsRepository } from "@/lib/clients/repository";
import {
  assertCommercialClientReadyForConfirmation,
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
  commercialMutationSchema,
  listCommercialPeople,
  type CommercialMutation,
  type CommercialMutationResult,
} from "@/lib/commercial/mutations";
import { CommercialRepositoryError, type CommercialRepository } from "@/lib/commercial/repository";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { isLocalStorageMode } from "@/lib/local-db/runtime";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { validateRetainedQuoteSelection } from "@/lib/quotes/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Owner = { userId: string; deviceId: string; displayName: string };
type RawRequest = Record<string, unknown>;

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function rawString(raw: RawRequest, key: string): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function confirmationRequested(input: CommercialMutation): boolean {
  return (
    (input.action === "setStatus" && input.status === "CONFIRMED") ||
    (input.action === "recordFollowUp" && input.nextStatus === "CONFIRMED")
  );
}

function caseIdForMutation(input: CommercialMutation): string | null {
  if (input.action === "create") return null;
  return "caseId" in input ? input.caseId : null;
}

async function validateConfirmationQuoteSelection(input: CommercialMutation): Promise<void> {
  if (!confirmationRequested(input)) return;
  const caseId = caseIdForMutation(input);
  if (!caseId) throw new Error("COMMERCIAL_CASE_NOT_FOUND");

  const retainedQuoteIds = input.retainedQuoteIds ?? [];
  const confirmWithoutQuote = input.confirmWithoutQuote === true;

  if (!isLocalStorageMode()) {
    if (retainedQuoteIds.length > 0) throw new Error("QUOTES_SERVER_REPOSITORY_NOT_IMPLEMENTED");
    if (!confirmWithoutQuote) throw new Error("COMMERCIAL_CONFIRM_WITHOUT_QUOTE_REQUIRED");
    return;
  }

  const quotes = await createQuotesRepository().load();
  validateRetainedQuoteSelection(quotes, caseId, retainedQuoteIds, confirmWithoutQuote);
}

function linkResolvedClient(
  mutation: CommercialMutationResult,
  resolvedClient: ResolvedCommercialClient,
  actorName: string,
): void {
  if (!mutation.focusCaseId) return;
  const item = mutation.payload.cases.find((candidate) => candidate.id === mutation.focusCaseId);
  if (!item) throw new Error("COMMERCIAL_CASE_NOT_FOUND");

  const previousClientId = item.clientId ?? null;
  const previousName = item.clientName ?? null;
  item.clientId = resolvedClient.id;
  item.primaryContactId = null;
  item.clientName = resolvedClient.displayName;

  if (previousClientId !== resolvedClient.id || previousName !== resolvedClient.displayName) {
    item.history.push({
      id: randomUUID(),
      type: "CLIENT_LINKED",
      at: new Date().toISOString(),
      actorName,
      summary: `Client lié : ${resolvedClient.displayName}.`,
    });
  }
}

async function snapshot(
  payload: CommercialPayload,
  owner: Owner,
  canWrite: boolean,
  user: { id: string },
  clients: ClientsRepository,
  focusCaseId?: string,
) {
  const actor = { userId: owner.userId, displayName: owner.displayName };
  const [canCreate, canProvision, canConfirm, canonicalClients] = await Promise.all([
    hasEffectiveSpecialPermission(user, "commercial.create"),
    hasEffectiveSpecialPermission(user, "commercial.provision"),
    hasEffectiveSpecialPermission(user, "commercial.confirm_launch"),
    listCanonicalCommercialClients(clients),
  ]);
  const payloadForUi = hydrateCommercialPayloadWithCanonicalClients(payload, canonicalClients);
  return {
    payload: payloadForUi,
    actor,
    capabilities: {
      canCreate: canWrite && canCreate,
      canRead: true,
      canModify: canWrite,
      canProvision: canWrite && canProvision,
      canConfirm: canWrite && canConfirm,
    },
    suggestedPeople: listCommercialPeople(payloadForUi, actor),
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
    const context = await requireDesktopRequestContext("commercial", "READ");
    const repository = await createCommercialRepository(context);
    const clients = await createClientsRepository(context);
    const parsed = await repository.load();
    const transition = applyCommercialAutomaticTransitions(parsed);

    const payload =
      transition.changed && context.moduleAccess.canWrite
        ? await persistAutomaticTransitions(repository)
        : transition.payload;

    return noStoreJson(
      await snapshot(payload, context.owner, context.moduleAccess.canWrite, context.user, clients),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "COMMERCIAL_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: statusFor(code) });
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  let stage = "parse-request";

  try {
    const raw = (await request.json()) as RawRequest;
    const input = commercialMutationSchema.parse(raw);
    stage = "create-runtime";
    const context = await requireDesktopRequestContext("commercial", "WRITE");
    const requiredSpecialPermission = commercialSpecialPermissionForMutation(input);
    if (requiredSpecialPermission) {
      await requireSpecialPermission(context.user, requiredSpecialPermission);
    }

    const repository = await createCommercialRepository(context);
    const clients = await createClientsRepository(context);
    const actor = { userId: context.owner.userId, displayName: context.owner.displayName };
    let resolvedClient: ResolvedCommercialClient | null = null;

    const buildMutation = async (
      source: CommercialPayload,
      isRetry: boolean,
    ): Promise<CommercialMutationResult> => {
      if (confirmationRequested(input)) {
        const caseId = caseIdForMutation(input);
        const item = caseId ? source.cases.find((candidate) => candidate.id === caseId) : null;
        if (!item) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        await assertCommercialClientReadyForConfirmation(clients, item.clientId);
        await validateConfirmationQuoteSelection(input);
      }

      const result = applyCommercialMutation(source, input, actor);

      if (input.action === "create" || input.action === "updateDetails") {
        const currentItem =
          input.action === "updateDetails"
            ? source.cases.find((candidate) => candidate.id === input.caseId)
            : null;
        if (input.action === "updateDetails" && !currentItem) {
          throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        }

        if (!resolvedClient) {
          if (isRetry) throw new Error("COMMERCIAL_CLIENT_RESOLUTION_LOST");
          stage = "resolve-client";
          resolvedClient = await resolveCommercialClient({
            clients,
            actor,
            existingClientId: rawString(raw, "existingClientId"),
            newClientName: input.clientName,
            currentClientId: currentItem?.clientId ?? null,
          });
        }
        linkResolvedClient(result, resolvedClient, actor.displayName);
      }

      return result;
    };

    stage = "apply-and-save-mutation";
    const mutation = await repository.mutate(buildMutation);
    console.info("[PAPOT][Commercial] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(
      await snapshot(
        mutation.payload,
        context.owner,
        true,
        context.user,
        clients,
        mutation.focusCaseId,
      ),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "COMMERCIAL_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "COMMERCIAL_MUTATION_FAILED";
    console.error("[PAPOT][Commercial] POST failed", {
      stage,
      code,
      ms: Date.now() - startedAt,
    });
    const body =
      error instanceof CommercialRepositoryError && error.details?.lockedBy
        ? { error: code, lockedBy: error.details.lockedBy }
        : { error: code };
    return noStoreJson(body, { status: statusFor(code) });
  }
}

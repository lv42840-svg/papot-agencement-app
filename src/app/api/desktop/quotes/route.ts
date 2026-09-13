import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  clientConfirmationMissingFields,
  clientDisplayName,
  parseClientsPayload,
  type ClientRecord,
} from "@/lib/clients/domain";
import { parseCommercialPayload } from "@/lib/commercial/domain";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { createDesktopSharedResourceRuntime } from "@/lib/desktop/shared-resource-runtime";
import { findQuote, parseQuotesPayload, type QuoteClientSnapshot } from "@/lib/quotes/model";
import {
  applyQuotesMutation,
  quotesMutationSchema,
  type QuoteSendContext,
  type QuotesMutation,
  type QuotesMutationResult,
} from "@/lib/quotes/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUOTES_RESOURCE = { resource_type: "QUOTES" as const, resource_id: "global" };
const CLIENTS_RESOURCE = { resource_type: "CLIENTS" as const, resource_id: "global" };
const COMMERCIAL_RESOURCE = { resource_type: "COMMERCIAL" as const, resource_id: "global" };
const QUOTES_WRITE_LOCK_TTL_MS = 30_000;
const QUOTES_OWN_LOCK_RECLAIM_AFTER_MS = 0;

type Desktop = ReturnType<typeof createDesktopSharedResourceRuntime>;
type Owner = { userId: string; deviceId: string; displayName: string };
type Actor = { userId: string; displayName: string };

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function publicSnapshot(
  payload: ReturnType<typeof parseQuotesPayload>,
  canWrite: boolean,
  focusQuoteId?: string,
) {
  return { payload, canWrite, focusQuoteId };
}

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "QUOTES_LOCKED") return 423;
  if (
    code === "QUOTE_NOT_FOUND" ||
    code === "CLIENT_NOT_FOUND" ||
    code === "COMMERCIAL_CASE_NOT_FOUND"
  ) {
    return 404;
  }
  if (
    code === "QUOTES_VERSION_CONFLICT" ||
    code === "QUOTE_NOT_DRAFT" ||
    code === "CLIENT_ARCHIVED" ||
    code === "QUOTE_CLIENT_INCOMPLETE" ||
    code === "QUOTE_COMMERCIAL_CLIENT_MISMATCH"
  ) {
    return 409;
  }
  return 400;
}

async function getClient(desktop: Desktop, clientId: string): Promise<ClientRecord> {
  const resource = await desktop.states.get(CLIENTS_RESOURCE);
  const client = parseClientsPayload(resource?.payload).clients.find((item) => item.id === clientId);
  if (!client) throw new Error("CLIENT_NOT_FOUND");
  if (client.isArchived) throw new Error("CLIENT_ARCHIVED");
  return client;
}

async function assertCommercialLink(
  desktop: Desktop,
  commercialCaseId: string | null,
  clientId: string,
): Promise<void> {
  if (commercialCaseId === null) return;
  const resource = await desktop.states.get(COMMERCIAL_RESOURCE);
  const commercialCase = parseCommercialPayload(resource?.payload).cases.find(
    (item) => item.id === commercialCaseId,
  );
  if (!commercialCase) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
  if (commercialCase.clientId && commercialCase.clientId !== clientId) {
    throw new Error("QUOTE_COMMERCIAL_CLIENT_MISMATCH");
  }
}

function clientSnapshot(client: ClientRecord, paymentTerms: string): QuoteClientSnapshot {
  return {
    displayName: clientDisplayName(client),
    companyName: client.companyName,
    firstName: client.firstName,
    lastName: client.lastName,
    addressLine1: client.addressLine1,
    addressLine2: client.addressLine2,
    postalCode: client.postalCode,
    city: client.city,
    phone: client.phone,
    email: client.email,
    siret: client.siret,
    paymentTerms,
  };
}

async function applyApiMutation(params: {
  desktop: Desktop;
  source: ReturnType<typeof parseQuotesPayload>;
  input: QuotesMutation;
  actor: Actor;
}): Promise<QuotesMutationResult> {
  const { desktop, source, input, actor } = params;

  if (input.action === "create") {
    const client = await getClient(desktop, input.clientId);
    await assertCommercialLink(desktop, input.commercialCaseId, client.id);
    return applyQuotesMutation(
      source,
      {
        ...input,
        paymentTerms: input.paymentTerms || client.paymentTerms,
      },
      actor,
    );
  }

  const current = findQuote(source, input.quoteId);

  if (input.action === "update") {
    const clientId = input.clientId ?? current.clientId;
    const client = await getClient(desktop, clientId);
    const commercialCaseId =
      input.commercialCaseId === undefined ? current.commercialCaseId : input.commercialCaseId;
    await assertCommercialLink(desktop, commercialCaseId, client.id);
    const clientChanged = client.id !== current.clientId;
    return applyQuotesMutation(
      source,
      {
        ...input,
        paymentTerms:
          input.paymentTerms === undefined && clientChanged ? client.paymentTerms : input.paymentTerms,
      },
      actor,
    );
  }

  if (current.status === "SENT") {
    return applyQuotesMutation(source, input, actor);
  }

  const client = await getClient(desktop, current.clientId);
  const missing = clientConfirmationMissingFields(client);
  if (missing.length > 0) throw new Error("QUOTE_CLIENT_INCOMPLETE");
  const sendContext: QuoteSendContext = {
    clientSnapshot: clientSnapshot(client, current.paymentTerms),
  };
  return applyQuotesMutation(source, input, actor, new Date(), sendContext);
}

export async function GET() {
  try {
    const context = await requireDesktopRequestContext("quotes", "READ");
    const cached = context.desktop.states.getCached(QUOTES_RESOURCE);

    if (cached !== undefined) {
      void context.desktop.states.get(QUOTES_RESOURCE).catch((error: unknown) => {
        const code = error instanceof Error ? error.message : "QUOTES_REFRESH_FAILED";
        console.error("[PAPOT][Quotes] background refresh failed", { code });
      });
      return noStoreJson(
        publicSnapshot(parseQuotesPayload(cached?.payload), context.moduleAccess.canWrite),
      );
    }

    const resource = await context.desktop.states.get(QUOTES_RESOURCE);
    return noStoreJson(
      publicSnapshot(parseQuotesPayload(resource?.payload), context.moduleAccess.canWrite),
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUOTES_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}

export async function POST(request: Request) {
  const leaseId = randomUUID();
  const startedAt = Date.now();
  let desktop: Desktop | null = null;
  let owner: Owner | null = null;
  let ownsLock = false;
  let stage = "parse-request";

  try {
    const input = quotesMutationSchema.parse(await request.json());
    stage = "create-runtime";
    const context = await requireDesktopRequestContext("quotes", "WRITE");
    desktop = context.desktop;
    owner = context.owner;
    const actor = { userId: context.user.id, displayName: context.user.displayName };

    stage = "acquire-lock-and-open-resource";
    const [lockResult, initialOpened] = await Promise.all([
      desktop.locks.acquire({
        resource: QUOTES_RESOURCE,
        leaseId,
        owner,
        baseVersion: 0,
        ttlMs: QUOTES_WRITE_LOCK_TTL_MS,
        reclaimOwnAfterMs: QUOTES_OWN_LOCK_RECLAIM_AFTER_MS,
      }),
      desktop.states.openForUpdate(QUOTES_RESOURCE),
    ]);

    if (lockResult.status === "locked") {
      return noStoreJson(
        { error: "QUOTES_LOCKED", lockedBy: lockResult.lock.owner_display_name },
        { status: 423 },
      );
    }
    ownsLock = true;

    let opened = initialOpened;
    stage = "apply-mutation";
    let mutation = await applyApiMutation({
      desktop,
      source: parseQuotesPayload(opened.resource?.payload),
      input,
      actor,
    });

    stage = "save-resource";
    let saved = await desktop.states.saveOpened({
      resource: QUOTES_RESOURCE,
      opened,
      payload: mutation.payload,
      actor: { userId: owner.userId, deviceId: owner.deviceId },
    });

    if (saved.status === "conflict") {
      stage = "reopen-after-conflict";
      opened = await desktop.states.openForUpdate(QUOTES_RESOURCE);
      stage = "reapply-after-conflict";
      mutation = await applyApiMutation({
        desktop,
        source: parseQuotesPayload(opened.resource?.payload),
        input,
        actor,
      });
      stage = "save-after-conflict";
      saved = await desktop.states.saveOpened({
        resource: QUOTES_RESOURCE,
        opened,
        payload: mutation.payload,
        actor: { userId: owner.userId, deviceId: owner.deviceId },
      });
    }

    if (saved.status === "conflict") {
      return noStoreJson({ error: "QUOTES_VERSION_CONFLICT" }, { status: 409 });
    }

    console.info("[PAPOT][Quotes] POST saved", { ms: Date.now() - startedAt });
    return noStoreJson(
      publicSnapshot(
        parseQuotesPayload(saved.resource.payload),
        context.moduleAccess.canWrite,
        mutation.focusQuoteId,
      ),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "QUOTES_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "QUOTES_MUTATION_FAILED";
    console.error("[PAPOT][Quotes] POST failed", {
      stage,
      code,
      ms: Date.now() - startedAt,
    });
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  } finally {
    if (desktop && owner && ownsLock) {
      const releaseDesktop = desktop;
      const releaseOwner = owner;
      void releaseDesktop.locks
        .release({ resource: QUOTES_RESOURCE, leaseId, owner: releaseOwner })
        .catch((error: unknown) => {
          const code = error instanceof Error ? error.message : "LOCK_RELEASE_FAILED";
          console.error("[PAPOT][Quotes] lock release failed", { code });
        });
    }
  }
}

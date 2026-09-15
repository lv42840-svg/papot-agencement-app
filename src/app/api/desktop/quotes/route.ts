import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { isCommercialClosed } from "@/lib/commercial/domain";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { upsertLibraryComponent } from "@/lib/library/catalog-edit";
import { createLibraryRepository } from "@/lib/library/create-repository";
import { ensureRequiredLaborComponents } from "@/lib/library/required-labor-components";
import {
  createInitialLibraryPayload,
  parseLibraryPayload,
  type LibraryPayload,
} from "@/lib/library/storage";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { createLibraryComponentFromQuoteLine } from "@/lib/quotes/library-component";
import { applyQuotesMutation, quotesMutationSchema } from "@/lib/quotes/mutations";
import type { QuoteLibraryComponentSource } from "@/lib/quotes/model";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function publicSnapshot(payload: NativeQuotesPayload, canWrite: boolean, focusQuoteId?: string) {
  return { payload, canWrite, focusQuoteId };
}

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (
    code === "QUOTE_AFFAIR_NOT_FOUND" ||
    code === "QUOTE_CLIENT_NOT_FOUND" ||
    code === "QUOTE_NOT_FOUND" ||
    code === "QUOTE_LINE_NOT_FOUND" ||
    code === "QUOTE_LIBRARY_COMPONENT_NOT_FOUND"
  ) {
    return 404;
  }
  if (
    code === "QUOTE_AFFAIR_CLOSED" ||
    code === "QUOTE_CLIENT_ARCHIVED" ||
    code === "QUOTE_NOT_EDITABLE" ||
    code === "LIBRARY_VERSION_CONFLICT"
  ) {
    return 409;
  }
  if (code === "LIBRARY_LOCKED") return 423;
  return 400;
}

export async function GET() {
  try {
    const context = await requireDesktopRequestContext("quotes", "READ");
    const payload = await createQuotesRepository().load();
    return noStoreJson(publicSnapshot(payload, context.moduleAccess.canWrite));
  } catch (error) {
    const code = error instanceof Error ? error.message : "QUOTES_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}

export async function POST(request: Request) {
  let librarySession:
    | {
        repository: ReturnType<typeof createLibraryRepository>;
        leaseId: string;
        baseVersion: number;
        payload: LibraryPayload;
        source: QuoteLibraryComponentSource;
      }
    | undefined;

  try {
    const input = quotesMutationSchema.parse(await request.json());
    const context = await requireDesktopRequestContext("quotes", "WRITE");
    const actor = { userId: context.user.id, displayName: context.user.displayName };

    if (input.action === "createDraft") {
      const commercialRepository = createCommercialRepository(context);
      const clientsRepository = await createClientsRepository(context);
      const [commercial, clients] = await Promise.all([
        commercialRepository.load(),
        clientsRepository.load(),
      ]);

      const affair = commercial.cases.find((item) => item.id === input.commercialCaseId);
      if (!affair) throw new Error("QUOTE_AFFAIR_NOT_FOUND");
      if (isCommercialClosed(affair)) throw new Error("QUOTE_AFFAIR_CLOSED");
      if (!affair.clientId) throw new Error("QUOTE_CLIENT_NOT_FOUND");

      const client = clients.clients.find((item) => item.id === affair.clientId);
      if (!client) throw new Error("QUOTE_CLIENT_NOT_FOUND");
      if (client.isArchived) throw new Error("QUOTE_CLIENT_ARCHIVED");

      const repository = createQuotesRepository();
      const mutation = await repository.mutate((payload) =>
        applyQuotesMutation(payload, input, actor, client.id),
      );
      return noStoreJson(
        publicSnapshot(mutation.payload, context.moduleAccess.canWrite, mutation.focusQuoteId),
      );
    }

    if (input.action === "upsertLine" && input.saveToLibrary) {
      if (input.libraryCostPriceCents === undefined || !input.libraryName) {
        throw new Error("QUOTES_REQUEST_INVALID");
      }

      const libraryRepository = createLibraryRepository(context);
      const leaseId = globalThis.crypto.randomUUID();
      const opened = await libraryRepository.open(leaseId);
      if (opened.status !== "editable") throw new Error("LIBRARY_LOCKED");

      const currentPayload = opened.resource
        ? parseLibraryPayload(opened.resource.payload)
        : createInitialLibraryPayload();
      const { component, source } = createLibraryComponentFromQuoteLine({
        componentId: globalThis.crypto.randomUUID(),
        name: input.libraryName,
        description: input.description,
        unit: input.unit,
        costPriceCents: input.libraryCostPriceCents,
        salePriceCents: input.unitPriceCents,
      });

      librarySession = {
        repository: libraryRepository,
        leaseId,
        baseVersion: opened.baseVersion,
        payload: upsertLibraryComponent(currentPayload, component),
        source,
      };
    }

    let libraryComponentSources: ReadonlyMap<string, QuoteLibraryComponentSource> | undefined;
    if (input.action === "upsertOuvrage") {
      const requestedComponentIds = Array.from(
        new Set(
          input.components
            .map((component) => component.libraryComponentId)
            .filter((componentId): componentId is string => Boolean(componentId)),
        ),
      );

      if (requestedComponentIds.length > 0) {
        const library = await createLibraryRepository(context).load();
        const libraryPayload = ensureRequiredLaborComponents(library.payload);
        const sources = new Map<string, QuoteLibraryComponentSource>();

        for (const componentId of requestedComponentIds) {
          const component = libraryPayload.components.find((item) => item.id === componentId);
          if (!component) throw new Error("QUOTE_LIBRARY_COMPONENT_NOT_FOUND");
          sources.set(
            componentId,
            createLibraryComponentFromQuoteLine({
              componentId: component.id,
              name: component.name,
              description: component.description,
              unit: component.unit,
              costPriceCents: component.costPriceCents,
              salePriceCents: component.salePriceCents,
              activity: component.activity,
            }).source,
          );
        }

        libraryComponentSources = sources;
      }
    }

    const repository = createQuotesRepository();
    const mutation = await repository.mutate(async (payload) => {
      const result = applyQuotesMutation(
        payload,
        input,
        actor,
        undefined,
        new Date(),
        librarySession?.source,
        libraryComponentSources,
      );

      if (librarySession) {
        const saved = await librarySession.repository.save({
          leaseId: librarySession.leaseId,
          expectedVersion: librarySession.baseVersion,
          payload: librarySession.payload,
        });
        if (saved.status !== "saved") throw new Error("LIBRARY_VERSION_CONFLICT");
      }

      return result;
    });

    return noStoreJson(
      publicSnapshot(mutation.payload, context.moduleAccess.canWrite, mutation.focusQuoteId),
    );
  } catch (error) {
    const code =
      error instanceof ZodError
        ? "QUOTES_REQUEST_INVALID"
        : error instanceof Error
          ? error.message
          : "QUOTES_MUTATION_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  } finally {
    if (librarySession) {
      try {
        await librarySession.repository.release(librarySession.leaseId);
      } catch {
        // A lease release failure does not invalidate a successfully committed quote/library save.
      }
    }
  }
}

import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { isCommercialClosed } from "@/lib/commercial/domain";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import { upsertLibraryComponent } from "@/lib/library/catalog-edit";
import { createLibraryRepository } from "@/lib/library/create-repository";
import { ensureRequiredLaborComponents } from "@/lib/library/required-labor-components";
import {
  createInitialLibraryPayload,
  parseLibraryPayload,
  type LibraryPayload,
} from "@/lib/library/storage";
import { quoteWorkflowMayChangeCommercialStatus } from "@/lib/quotes/chantier";
import {
  assertQuoteRevision,
  expectedQuoteRevision,
  quoteConcurrencyStatus,
} from "@/lib/quotes/concurrency";
import { startQuoteCommercialWorkflow } from "@/lib/quotes/commercial-bridge";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { initializeQuoteVatFromClient } from "@/lib/quotes/legal-details";
import { createLibraryComponentFromQuoteLine } from "@/lib/quotes/library-component";
import { applyQuotesMutation, quotesMutationSchema } from "@/lib/quotes/mutations";
import type { QuoteLibraryComponentSource } from "@/lib/quotes/model";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const quoteCommercialWorkflowSchema = z.object({
  action: z.literal("createDraft"),
  quoteOwnerName: z.string().trim().min(1).max(120),
  quoteDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function noStoreJson(corps: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(corps, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

function publicSnapshot(contenu: NativeQuotesPayload, canWrite: boolean, focusQuoteId?: string) {
  return { payload: contenu, canWrite, focusQuoteId };
}

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  const concurrencyStatus = quoteConcurrencyStatus(code);
  if (concurrencyStatus) return concurrencyStatus;
  if (
    code === "QUOTE_AFFAIR_NOT_FOUND" ||
    code === "QUOTE_CLIENT_NOT_FOUND" ||
    code === "QUOTE_NOT_FOUND" ||
    code === "QUOTE_LINE_NOT_FOUND" ||
    code === "QUOTE_LIBRARY_COMPONENT_NOT_FOUND" ||
    code === "COMMERCIAL_CASE_NOT_FOUND"
  ) {
    return 404;
  }
  if (
    code === "QUOTE_AFFAIR_CLOSED" ||
    code === "QUOTE_CLIENT_ARCHIVED" ||
    code === "QUOTE_NOT_EDITABLE" ||
    code === "LIBRARY_VERSION_CONFLICT" ||
    code === "COMMERCIAL_CASE_CLOSED"
  ) {
    return 409;
  }
  if (code === "LIBRARY_LOCKED") return 423;
  return 400;
}

export async function GET() {
  try {
    const contexte = await requireModuleRequestContext("quotes", "READ");
    const contenu = await createQuotesRepository().load();
    return noStoreJson(publicSnapshot(contenu, contexte.moduleAccess.canWrite));
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "QUOTES_LOAD_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}

export async function POST(requete: Request) {
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
    const rawInput = await requete.json();
    const saisie = quotesMutationSchema.parse(rawInput);
    const expectedRevision =
      saisie.action === "createDraft" ? null : expectedQuoteRevision(requete);
    const contexte = await requireModuleRequestContext("quotes", "WRITE");
    const auteur = { userId: contexte.user.id, displayName: contexte.user.displayName };

    if (saisie.action === "createDraft") {
      const workflow = quoteCommercialWorkflowSchema.parse(rawInput);
      await requireModuleRequestContext("commercial", "WRITE");
      const commercialRepository = createCommercialRepository();
      const clientsRepository = await createClientsRepository();
      const [commercial, clients] = await Promise.all([
        commercialRepository.load(),
        clientsRepository.load(),
      ]);

      const affair = commercial.cases.find((element) => element.id === saisie.commercialCaseId);
      if (!affair) throw new Error("QUOTE_AFFAIR_NOT_FOUND");
      if (isCommercialClosed(affair)) throw new Error("QUOTE_AFFAIR_CLOSED");
      if (!affair.clientId) throw new Error("QUOTE_CLIENT_NOT_FOUND");

      const client = clients.clients.find((element) => element.id === affair.clientId);
      if (!client) throw new Error("QUOTE_CLIENT_NOT_FOUND");
      if (client.isArchived) throw new Error("QUOTE_CLIENT_ARCHIVED");

      const maintenant = new Date();
      if (quoteWorkflowMayChangeCommercialStatus(affair.status)) {
        await commercialRepository.mutate((contenu) =>
          startQuoteCommercialWorkflow(
            contenu,
            affair.id,
            workflow.quoteOwnerName,
            workflow.quoteDueDate,
            auteur,
            maintenant,
          ),
        );
      }

      const repository = createQuotesRepository();
      const mutation = await repository.mutate((contenu) => {
        const created = applyQuotesMutation(contenu, saisie, auteur, client.id, maintenant);
        return initializeQuoteVatFromClient(
          created.payload,
          created.focusQuoteId,
          client.defaultVatRatePercent,
          auteur,
          maintenant,
        );
      });
      return noStoreJson(
        publicSnapshot(mutation.payload, contexte.moduleAccess.canWrite, mutation.focusQuoteId),
      );
    }

    if (saisie.action === "upsertLine" && saisie.saveToLibrary) {
      if (saisie.libraryCostPriceCents === undefined || !saisie.libraryName) {
        throw new Error("QUOTES_REQUEST_INVALID");
      }

      const libraryRepository = createLibraryRepository(contexte);
      const leaseId = globalThis.crypto.randomUUID();
      const opened = await libraryRepository.open(leaseId);
      if (opened.status !== "editable") throw new Error("LIBRARY_LOCKED");

      const currentPayload = opened.resource
        ? parseLibraryPayload(opened.resource.payload)
        : createInitialLibraryPayload();
      const { component, source } = createLibraryComponentFromQuoteLine({
        componentId: globalThis.crypto.randomUUID(),
        name: saisie.libraryName,
        description: saisie.description,
        unit: saisie.unit,
        costPriceCents: saisie.libraryCostPriceCents,
        salePriceCents: saisie.unitPriceCents,
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
    if (saisie.action === "upsertOuvrage") {
      const requestedComponentIds = Array.from(
        new Set(
          saisie.components
            .map((component) => component.libraryComponentId)
            .filter((componentId): componentId is string => Boolean(componentId)),
        ),
      );

      if (requestedComponentIds.length > 0) {
        const library = await createLibraryRepository(contexte).load();
        const libraryPayload = ensureRequiredLaborComponents(library.payload);
        const sources = new Map<string, QuoteLibraryComponentSource>();

        for (const componentId of requestedComponentIds) {
          const component = libraryPayload.components.find((element) => element.id === componentId);
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
    const mutation = await repository.mutate(async (contenu) => {
      assertQuoteRevision(contenu, saisie.quoteId, expectedRevision!);
      const resultat = applyQuotesMutation(
        contenu,
        saisie,
        auteur,
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

      return resultat;
    });

    return noStoreJson(
      publicSnapshot(mutation.payload, contexte.moduleAccess.canWrite, mutation.focusQuoteId),
    );
  } catch (erreur) {
    const code =
      erreur instanceof ZodError
        ? "QUOTES_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
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

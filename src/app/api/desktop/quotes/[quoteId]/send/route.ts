import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { createCommercialDocumentTransport } from "@/lib/commercial/document-file-runtime";
import { applyCommercialMutation, registerCommercialDocuments } from "@/lib/commercial/mutations";
import { createCompanyProfileRepository } from "@/lib/company-profile/create-repository";
import {
  desktopRequestErrorStatus,
  requireDesktopRequestContext,
} from "@/lib/desktop/request-context";
import { quoteWorkflowMayChangeCommercialStatus } from "@/lib/quotes/chantier";
import { buildQuoteDocumentDataFromPayloads } from "@/lib/quotes/document-data-mapping";
import { archiveFinalQuotePdf, nextFinalQuoteNumber } from "@/lib/quotes/final-pdf-archive";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { normalizeQuotePricingAfterModelMutation } from "@/lib/quotes/pricing-integrity";
import { markNativeQuoteSentWithFinalPdf } from "@/lib/quotes/send";
import type { NativeQuotesPayload } from "@/lib/quotes/store";
import { renderQuoteWordV2PdfWithPhotos } from "@/lib/quotes/word-v2-pdf";
import { loadQuoteWordV2Template } from "@/lib/quotes/word-v2-template-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sendQuoteSchema = z.object({
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function publicSnapshot(payload: NativeQuotesPayload, canWrite: boolean, focusQuoteId: string) {
  return { payload, canWrite, focusQuoteId };
}

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  if (code === "QUOTE_NOT_FOUND" || code === "COMMERCIAL_CASE_NOT_FOUND") return 404;
  if (code === "QUOTE_NOT_EDITABLE" || code === "COMMERCIAL_CASE_CLOSED") return 409;
  if (code === "QUOTE_FINAL_PDF_ARCHIVE_CONFLICT") return 409;
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") return 503;
  if (
    code.startsWith("PDF_") ||
    code.startsWith("QUOTE_WORD_V2_TEMPLATE_") ||
    code.includes("INTEGRITY")
  ) {
    return 500;
  }
  return 400;
}

type PendingArchiveCleanup = {
  storagePath: string;
  deleteFile: (storagePath: string) => Promise<boolean>;
};

export async function POST(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  const cleanupState: { archive: PendingArchiveCleanup | null } = { archive: null };
  let committed = false;

  try {
    const { quoteId } = await params;
    const input = sendQuoteSchema.parse(await request.json());
    const quoteContext = await requireDesktopRequestContext("quotes", "WRITE");
    const commercialContext = await requireDesktopRequestContext("commercial", "WRITE");
    const actor = {
      userId: quoteContext.user.id,
      displayName: quoteContext.user.displayName,
    };
    const now = new Date();
    const quotesRepository = createQuotesRepository();
    const commercialRepository = createCommercialRepository(commercialContext);
    const clientsRepository = await createClientsRepository(quoteContext);
    const companyProfileRepository = createCompanyProfileRepository();
    const transport = await createCommercialDocumentTransport(quoteContext);
    const [clients, companyProfile, template] = await Promise.all([
      clientsRepository.load(),
      companyProfileRepository.load(),
      loadQuoteWordV2Template(),
    ]);

    const mutation = await quotesRepository.mutate(async (payload) => {
      normalizeQuotePricingAfterModelMutation(payload, quoteId);
      const quote = payload.quotes.find((candidate) => candidate.id === quoteId);
      if (!quote) throw new Error("QUOTE_NOT_FOUND");
      if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

      const issueYear = Number(quote.model.issueDate.slice(0, 4));
      const quoteNumber = nextFinalQuoteNumber(payload, issueYear);
      const commercial = await commercialRepository.load();
      const commercialCase = commercial.cases.find(
        (candidate) => candidate.id === quote.commercialCaseId,
      );
      if (!commercialCase) throw new Error("COMMERCIAL_CASE_NOT_FOUND");

      const document = buildQuoteDocumentDataFromPayloads(
        { quoteId, quoteNumber },
        { quotes: payload, clients, commercial, companyProfile },
      );
      const generated = await renderQuoteWordV2PdfWithPhotos(template, document, (photo) =>
        transport.store.readBytes(photo.storagePath, photo.sha256),
      );
      const archive = await archiveFinalQuotePdf(transport.store, {
        quote,
        quoteNumber,
        context: {
          creationYear: new Date(commercialCase.createdAt).getFullYear(),
          clientName: commercialCase.clientName,
          caseName: commercialCase.name,
        },
        pdf: generated.pdf,
        actorName: actor.displayName,
        now,
      });
      if (archive.created) {
        cleanupState.archive = {
          storagePath: archive.finalPdf.storagePath,
          deleteFile: (storagePath) => transport.store.deleteFile(storagePath),
        };
      }

      const sent = markNativeQuoteSentWithFinalPdf(
        payload,
        quoteId,
        input.followUpDate,
        archive.finalPdf,
        actor,
        now,
      );

      await commercialRepository.mutate((commercialPayload) => {
        const registered = registerCommercialDocuments(
          commercialPayload,
          sent.commercialCaseId,
          [archive.commercialDocument],
          actor,
          now,
        );
        const affair = registered.payload.cases.find(
          (candidate) => candidate.id === sent.commercialCaseId,
        );
        if (!affair) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        if (!quoteWorkflowMayChangeCommercialStatus(affair.status)) return registered;
        return applyCommercialMutation(
          registered.payload,
          {
            action: "markQuoteSent",
            caseId: sent.commercialCaseId,
            followUpDate: input.followUpDate,
          },
          actor,
          now,
        );
      });

      return {
        payload: sent.payload,
        focusQuoteId: sent.focusQuoteId,
      };
    });

    committed = true;
    return noStoreJson(
      publicSnapshot(mutation.payload, quoteContext.moduleAccess.canWrite, mutation.focusQuoteId),
    );
  } catch (error) {
    const pendingArchive = cleanupState.archive;
    if (!committed && pendingArchive) {
      await pendingArchive.deleteFile(pendingArchive.storagePath).catch(() => undefined);
    }
    const code =
      error instanceof ZodError
        ? "QUOTE_FOLLOW_UP_DATE_REQUIRED"
        : error instanceof Error
          ? error.message
          : "QUOTE_SEND_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}

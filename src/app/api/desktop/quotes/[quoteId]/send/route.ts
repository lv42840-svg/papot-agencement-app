import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { createCommercialDocumentTransport } from "@/lib/commercial/document-file-runtime";
import { applyCommercialMutation, registerCommercialDocuments } from "@/lib/commercial/mutations";
import { createCompanyProfileRepository } from "@/lib/company-profile/create-repository";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";
import { quoteWorkflowMayChangeCommercialStatus } from "@/lib/quotes/chantier";
import {
  assertQuoteRevision,
  expectedQuoteRevision,
  quoteConcurrencyStatus,
} from "@/lib/quotes/concurrency";
import { buildQuoteDocumentDataFromPayloads } from "@/lib/quotes/document-data-mapping";
import { archiveFinalQuotePdf, nextFinalQuoteNumber } from "@/lib/quotes/final-pdf-archive";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { createQuoteEmailSettingsRepository } from "@/lib/quote-email-settings/create-repository";
import { sendQuoteEmail } from "@/lib/quotes/email";
import { normalizeQuotePricingAfterModelMutation } from "@/lib/quotes/pricing-integrity";
import {
  markFrozenNativeQuoteSent,
  markNativeQuoteSentWithFinalPdf,
  markNativeQuoteValidatedWithFinalPdf,
} from "@/lib/quotes/send";
import type { NativeQuotesPayload } from "@/lib/quotes/store";
import { renderQuoteWordV2PdfWithPhotos } from "@/lib/quotes/word-v2-pdf";
import { loadQuoteWordV2Template } from "@/lib/quotes/word-v2-template-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sendQuoteSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("VALIDATE"),
  }),
  z.object({
    mode: z.literal("SEND"),
    followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    email: z.object({
      to: z.string().trim().email().max(240),
      subject: z.string().trim().min(1).max(500),
      body: z.string().trim().min(1).max(10_000),
    }),
  }),
]);

function noStoreJson(corps: unknown, init?: ResponseInit) {
  const reponse = NextResponse.json(corps, init);
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}

function publicSnapshot(contenu: NativeQuotesPayload, canWrite: boolean, focusQuoteId: string) {
  return { payload: contenu, canWrite, focusQuoteId };
}

function errorStatus(code: string): number {
  const requestStatus = desktopRequestErrorStatus(code);
  if (requestStatus) return requestStatus;
  const concurrencyStatus = quoteConcurrencyStatus(code);
  if (concurrencyStatus) return concurrencyStatus;
  if (code === "QUOTE_NOT_FOUND" || code === "COMMERCIAL_CASE_NOT_FOUND") return 404;
  if (
    code === "QUOTE_NOT_EDITABLE" ||
    code === "QUOTE_NOT_FROZEN" ||
    code === "COMMERCIAL_CASE_CLOSED"
  )
    return 409;
  if (code === "QUOTE_FINAL_PDF_ARCHIVE_CONFLICT") return 409;
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE" || code === "QUOTE_EMAIL_NOT_CONFIGURED") return 503;
  if (code === "QUOTE_EMAIL_SEND_FAILED") return 502;
  if (code === "QUOTE_RECIPIENT_EMAIL_REQUIRED" || code === "QUOTE_EMAIL_CONTENT_REQUIRED") {
    return 400;
  }
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

export async function POST(
  requete: Request,
  { params: parametres }: { params: Promise<{ quoteId: string }> },
) {
  const cleanupState: { archive: PendingArchiveCleanup | null } = { archive: null };
  let committed = false;

  try {
    const { quoteId: idDevis } = await parametres;
    const expectedRevision = expectedQuoteRevision(requete);
    const saisie = sendQuoteSchema.parse(await requete.json());
    const quoteContext = await requireModuleRequestContext("quotes", "WRITE");
    await requireModuleRequestContext("commercial", "WRITE");
    const auteur = {
      userId: quoteContext.user.id,
      displayName: quoteContext.user.displayName,
    };
    const maintenant = new Date();
    const quotesRepository = createQuotesRepository();
    const commercialRepository = createCommercialRepository();
    const clientsRepository = await createClientsRepository();
    const companyProfileRepository = createCompanyProfileRepository();
    const emailSettingsRepository = createQuoteEmailSettingsRepository();
    const transport = await createCommercialDocumentTransport({
      displayName: quoteContext.user.displayName,
    });
    const [clients, companyProfile, template, emailSettings] = await Promise.all([
      clientsRepository.load(),
      companyProfileRepository.load(),
      loadQuoteWordV2Template(),
      emailSettingsRepository.load(),
    ]);

    const mutation = await quotesRepository.mutate(async (contenu) => {
      assertQuoteRevision(contenu, idDevis, expectedRevision);
      normalizeQuotePricingAfterModelMutation(contenu, idDevis);
      const quote = contenu.quotes.find((candidat) => candidat.id === idDevis);
      if (!quote) throw new Error("QUOTE_NOT_FOUND");

      const commercial = await commercialRepository.load();
      const commercialCase = commercial.cases.find(
        (candidat) => candidat.id === quote.commercialCaseId,
      );
      if (!commercialCase) throw new Error("COMMERCIAL_CASE_NOT_FOUND");

      if (quote.status === "FROZEN") {
        if (saisie.mode !== "SEND") throw new Error("QUOTE_NOT_EDITABLE");
        if (!quote.finalPdf) throw new Error("QUOTE_NOT_FROZEN");
        const pdfBytes = await transport.store.readBytes(
          quote.finalPdf.storagePath,
          quote.finalPdf.sha256,
        );
        await sendQuoteEmail(
          {
            to: saisie.email.to,
            subject: saisie.email.subject,
            body: saisie.email.body,
            pdfFileName: quote.finalPdf.fileName,
            pdfBytes,
          },
          {
            fromEmail: emailSettings.fromEmail,
            ccEmail: emailSettings.ccEmail,
            replyToEmail: emailSettings.replyToEmail,
          },
        );
        const sent = markFrozenNativeQuoteSent(
          contenu,
          idDevis,
          saisie.followUpDate,
          auteur,
          maintenant,
        );

        await commercialRepository.mutate((commercialPayload) => {
          const affair = commercialPayload.cases.find(
            (candidat) => candidat.id === sent.commercialCaseId,
          );
          if (!affair) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
          if (!quoteWorkflowMayChangeCommercialStatus(affair.status)) {
            return { payload: commercialPayload, focusCaseId: affair.id };
          }
          return applyCommercialMutation(
            commercialPayload,
            {
              action: "markQuoteSent",
              caseId: sent.commercialCaseId,
              followUpDate: saisie.followUpDate,
            },
            auteur,
            maintenant,
          );
        });

        return {
          payload: sent.payload,
          focusQuoteId: sent.focusQuoteId,
        };
      }

      if (quote.status !== "DRAFT") throw new Error("QUOTE_NOT_EDITABLE");

      const issueYear = Number(quote.model.issueDate.slice(0, 4));
      const quoteNumber = nextFinalQuoteNumber(contenu, issueYear);
      const document = buildQuoteDocumentDataFromPayloads(
        { quoteId: idDevis, quoteNumber },
        { quotes: contenu, clients, commercial, companyProfile },
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
        actorName: auteur.displayName,
        now: maintenant,
      });
      if (archive.created) {
        cleanupState.archive = {
          storagePath: archive.finalPdf.storagePath,
          deleteFile: (storagePath) => transport.store.deleteFile(storagePath),
        };
      }

      if (saisie.mode === "SEND") {
        await sendQuoteEmail(
          {
            to: saisie.email.to,
            subject: saisie.email.subject,
            body: saisie.email.body,
            pdfFileName: archive.finalPdf.fileName,
            pdfBytes: generated.pdf,
          },
          {
            fromEmail: emailSettings.fromEmail,
            ccEmail: emailSettings.ccEmail,
            replyToEmail: emailSettings.replyToEmail,
          },
        );
      }

      const finalized =
        saisie.mode === "VALIDATE"
          ? markNativeQuoteValidatedWithFinalPdf(
              contenu,
              idDevis,
              archive.finalPdf,
              auteur,
              maintenant,
            )
          : markNativeQuoteSentWithFinalPdf(
              contenu,
              idDevis,
              saisie.followUpDate,
              archive.finalPdf,
              auteur,
              maintenant,
            );

      await commercialRepository.mutate((commercialPayload) => {
        const registered = registerCommercialDocuments(
          commercialPayload,
          finalized.commercialCaseId,
          [archive.commercialDocument],
          auteur,
          maintenant,
        );
        if (saisie.mode === "VALIDATE") return registered;

        const affair = registered.payload.cases.find(
          (candidat) => candidat.id === finalized.commercialCaseId,
        );
        if (!affair) throw new Error("COMMERCIAL_CASE_NOT_FOUND");
        if (!quoteWorkflowMayChangeCommercialStatus(affair.status)) return registered;
        return applyCommercialMutation(
          registered.payload,
          {
            action: "markQuoteSent",
            caseId: finalized.commercialCaseId,
            followUpDate: saisie.followUpDate,
          },
          auteur,
          maintenant,
        );
      });

      return {
        payload: finalized.payload,
        focusQuoteId: finalized.focusQuoteId,
      };
    });

    committed = true;
    return noStoreJson(
      publicSnapshot(mutation.payload, quoteContext.moduleAccess.canWrite, mutation.focusQuoteId),
    );
  } catch (erreur) {
    const pendingArchive = cleanupState.archive;
    if (!committed && pendingArchive) {
      await pendingArchive.deleteFile(pendingArchive.storagePath).catch(() => undefined);
    }
    const code =
      erreur instanceof ZodError
        ? "QUOTE_SEND_REQUEST_INVALID"
        : erreur instanceof Error
          ? erreur.message
          : "QUOTE_SEND_FAILED";
    return noStoreJson({ error: code }, { status: errorStatus(code) });
  }
}

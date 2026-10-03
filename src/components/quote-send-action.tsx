"use client";

import { CheckCircle2, FileLock2, Send } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type ApiResponse = { payload?: NativeQuotesPayload; error?: string };
type FinalizeMode = "VALIDATE" | "SEND";

function sendErrorLabel(code?: string): string {
  if (code === "MODULE_FORBIDDEN") {
    return "Droit de modification Devis et Commercial requis.";
  }
  if (code === "QUOTE_FOLLOW_UP_DATE_REQUIRED") {
    return "Choisis une date de relance valide.";
  }
  if (code === "QUOTE_SEND_REQUEST_INVALID") {
    return "Vérifie l’action demandée et la date de relance.";
  }
  if (code === "QUOTE_PRICING_REVIEW_REQUIRED" || code === "QUOTE_DOCUMENT_PRICING_WARNING") {
    return "Vérifie les ajustements de chiffrage signalés avant de figer le devis.";
  }
  if (code === "QUOTE_OPTION_TARGET_DUPLICATE" || code === "QUOTE_OPTION_TARGET_INVALID") {
    return "Vérifie les options du devis avant le gel du PDF.";
  }
  if (code === "QUOTE_NOT_EDITABLE") return "Ce devis n’est plus modifiable.";
  if (code === "QUOTE_NOT_FROZEN") return "Ce devis n’est pas encore validé.";
  if (code === "QUOTE_FINAL_PDF_ARCHIVE_CONFLICT") {
    return "Un PDF différent existe déjà pour ce numéro, cette variante et cette version. Aucun fichier n’a été écrasé.";
  }
  if (
    code?.startsWith("QUOTE_WORD_V2_PDF_REQUIRED_FIELDS:") ||
    code?.startsWith("QUOTE_DOCUMENT_WORK_") ||
    code === "QUOTE_DOCUMENT_DATE_INVALID"
  ) {
    return "Complète les informations nécessaires au PDF, notamment les dates et la durée des travaux.";
  }
  if (code === "QUOTE_DOCUMENT_COMPANY_REQUIRED") {
    return "Renseigne les informations de PAPOT nécessaires au devis dans les paramètres société.";
  }
  if (
    code === "QUOTE_DOCUMENT_CLIENT_NOT_FOUND" ||
    code === "QUOTE_DOCUMENT_AFFAIR_NOT_FOUND" ||
    code === "QUOTE_DOCUMENT_CLIENT_MISMATCH" ||
    code === "QUOTE_DOCUMENT_AFFAIR_CLIENT_MISMATCH"
  ) {
    return "Le client ou l’affaire du devis n’est pas correctement rattaché. Vérifie la fiche affaire.";
  }
  if (code?.startsWith("QUOTE_WORD_V2_TEMPLATE_")) {
    return "Le modèle Word du devis est indisponible.";
  }
  if (code === "PDF_CONVERTER_UNAVAILABLE") {
    return "Aucun moteur PDF n’est disponible sur ce poste. Installe LibreOffice ou Microsoft Word puis relance PAPOT.";
  }
  if (code?.startsWith("PDF_WINDOWS_CONVERTER_FAILED:")) {
    return "LibreOffice est indisponible et Microsoft Word n’a pas réussi à convertir le devis en PDF.";
  }
  if (
    code?.startsWith("PDF_CONVERSION_FAILED:") ||
    code?.startsWith("PDF_CONVERSION_OUTPUT_MISSING:")
  ) {
    return "LibreOffice a été trouvé mais n’a pas réussi à convertir le devis en PDF.";
  }
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") {
    return "Le dossier d’archivage PAPOT est inaccessible ou non modifiable sur ce poste.";
  }
  if (code?.startsWith("PDF_")) {
    return "La génération du PDF a échoué avant l’archivage. Rien n’a été figé.";
  }
  return code
    ? `La génération du PDF a échoué (${code}). La date de relance n’est pas forcément en cause.`
    : "Impossible de générer et figer le PDF du devis.";
}

function outlookErrorLabel(code?: string): string {
  if (code === "OUTLOOK_ATTACHMENT_NOT_FOUND") {
    return "Le PDF validé est introuvable. Outlook n’a pas été ouvert.";
  }
  if (
    code === "DESKTOP_BUSINESS_FILE_INVALID" ||
    code === "DESKTOP_BUSINESS_FILE_ROOT_UNAVAILABLE"
  ) {
    return "Le PDF validé n’est pas accessible dans le dossier PAPOT.";
  }
  if (code === "OUTLOOK_DESKTOP_REQUIRED") {
    return "L’ouverture directe d’Outlook est disponible dans l’application Windows PAPOT.";
  }
  return "Outlook n’a pas pu être ouvert sur ce poste.";
}

async function postFinalize(
  quoteId: string,
  mode: FinalizeMode,
  followUpDate: string,
): Promise<NativeQuotesPayload> {
  const response = await fetch(`/api/desktop/quotes/${quoteId}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(mode === "SEND" ? { mode, followUpDate } : { mode }),
  });
  const data = (await response.json()) as ApiResponse;
  if (!response.ok || !data.payload) {
    throw new Error(data.error ?? "QUOTE_SEND_FAILED");
  }
  return data.payload;
}

export function QuoteSendAction({
  quote,
  canWrite,
  affairName,
  recipientEmail,
  recipientName,
  onSaved,
}: {
  quote: NativeQuoteRecord;
  canWrite: boolean;
  affairName: string;
  recipientEmail: string;
  recipientName: string;
  onSaved: (payload: NativeQuotesPayload) => void;
}) {
  const [mode, setMode] = useState<FinalizeMode | null>(null);
  const [followUpDate, setFollowUpDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [outlookOpenedWithoutAttachment, setOutlookOpenedWithoutAttachment] = useState(false);

  function startMode(nextMode: FinalizeMode) {
    setError("");
    setOutlookOpenedWithoutAttachment(false);
    setMode(nextMode);
  }

  function cancel() {
    setError("");
    setOutlookOpenedWithoutAttachment(false);
    setMode(null);
  }

  async function openOutlook(validatedQuote: NativeQuoteRecord) {
    if (!validatedQuote.finalPdf) throw new Error("OUTLOOK_ATTACHMENT_NOT_FOUND");
    const compose = window.papotDesktop?.composeOutlookMail;
    if (!compose) throw new Error("OUTLOOK_DESKTOP_REQUIRED");

    const quoteNumber = validatedQuote.finalPdf.quoteNumber;
    const greeting = recipientName.trim() ? `Bonjour ${recipientName.trim()},` : "Bonjour,";
    const result = await compose({
      kind: "quote-email",
      to: recipientEmail.trim(),
      subject: `Devis ${quoteNumber} - ${affairName}`,
      body: [
        greeting,
        "",
        `Veuillez trouver ci-joint notre devis ${quoteNumber} concernant ${validatedQuote.model.subject}.`,
        "",
        "Bien cordialement,",
      ].join("\n"),
      storagePath: validatedQuote.finalPdf.storagePath,
    });
    if (!result.ok) throw new Error(result.error);
    return result;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode) return;
    if (mode === "SEND" && !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) {
      setError("Choisis une date de relance valide.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      if (mode === "VALIDATE") {
        const payload = await postFinalize(quote.id, "VALIDATE", "");
        onSaved(payload);
        setMode(null);
        return;
      }

      if (outlookOpenedWithoutAttachment) {
        const sentPayload = await postFinalize(quote.id, "SEND", followUpDate);
        onSaved(sentPayload);
        setOutlookOpenedWithoutAttachment(false);
        setMode(null);
        return;
      }

      let validatedQuote = quote;
      if (quote.status === "DRAFT") {
        const validatedPayload = await postFinalize(quote.id, "VALIDATE", "");
        onSaved(validatedPayload);
        const nextQuote = validatedPayload.quotes.find((candidate) => candidate.id === quote.id);
        if (!nextQuote) throw new Error("QUOTE_NOT_FOUND");
        validatedQuote = nextQuote;
      }

      let outlookResult;
      try {
        outlookResult = await openOutlook(validatedQuote);
      } catch (outlookError) {
        setError(outlookErrorLabel(outlookError instanceof Error ? outlookError.message : ""));
        return;
      }

      if (!outlookResult.attachmentAttached) {
        setOutlookOpenedWithoutAttachment(true);
        setError(
          "Outlook est ouvert, mais cette version d’Outlook ne permet pas à PAPOT de joindre automatiquement le PDF. Ajoute le PDF, envoie le mail, puis clique « J’ai envoyé ».",
        );
        return;
      }

      const sentPayload = await postFinalize(quote.id, "SEND", followUpDate);
      onSaved(sentPayload);
      setMode(null);
    } catch (caught) {
      setError(sendErrorLabel(caught instanceof Error ? caught.message : ""));
    } finally {
      setSaving(false);
    }
  }

  if (quote.status === "SENT" || quote.status === "ACCEPTED" || quote.status === "REJECTED") {
    if (!quote.finalPdf) {
      return quote.followUpDate ? (
        <div className="quoteNotice">Envoyé · relance prévue le {quote.followUpDate}</div>
      ) : null;
    }
    return (
      <div className="quoteNotice">
        <FileLock2 size={14} aria-hidden="true" /> {quote.finalPdf.quoteNumber} · PDF figé ·{" "}
        {quote.variantName} V{quote.version}
        {quote.followUpDate ? ` · relance prévue le ${quote.followUpDate}` : ""}
      </div>
    );
  }

  if (quote.status === "FROZEN" && !mode) {
    return (
      <div className="quoteFinalizeRow">
        <div className="quoteNotice">
          <CheckCircle2 size={14} aria-hidden="true" /> {quote.finalPdf?.quoteNumber} · PDF validé,
          pas encore envoyé
        </div>
        {canWrite ? (
          <button type="button" className="primaryButton" onClick={() => startMode("SEND")}>
            <Send size={15} aria-hidden="true" /> Envoyer avec Outlook
          </button>
        ) : null}
      </div>
    );
  }

  if (quote.status !== "DRAFT" && quote.status !== "FROZEN") return null;
  if (!canWrite) return null;

  if (!mode) {
    return (
      <div className="quoteFinalizeRow">
        <button type="button" className="secondaryButton" onClick={() => startMode("VALIDATE")}>
          <FileLock2 size={15} aria-hidden="true" /> Valider
        </button>
        <button type="button" className="primaryButton" onClick={() => startMode("SEND")}>
          <Send size={15} aria-hidden="true" /> Valider et envoyer
        </button>
      </div>
    );
  }

  const alreadyValidated = quote.status === "FROZEN";

  return (
    <form className="quoteDraftForm" onSubmit={submit}>
      <div className="quoteNotice">
        {mode === "VALIDATE"
          ? "Le PDF recevra son numéro définitif et sera figé. Le devis restera non envoyé."
          : outlookOpenedWithoutAttachment
            ? "Outlook est déjà ouvert. Après l’envoi manuel, confirme simplement dans PAPOT."
            : alreadyValidated
              ? "Le PDF est déjà figé. PAPOT va ouvrir Outlook avec le devis joint."
              : "Le PDF sera figé puis PAPOT ouvrira Outlook avec le devis joint."}
      </div>
      {mode === "SEND" ? (
        <>
          <label className="quoteField">
            <span>Date de relance obligatoire</span>
            <input
              type="date"
              value={followUpDate}
              onChange={(event) => setFollowUpDate(event.target.value)}
              required
            />
          </label>
          <div className="quoteNotice">
            Destinataire Outlook : {recipientEmail.trim() || "à renseigner dans Outlook"}
          </div>
        </>
      ) : null}
      {error ? <div className="quoteFormError">{error}</div> : null}
      <div className="quoteDraftActions">
        <button type="button" className="secondaryButton" onClick={cancel}>
          Annuler
        </button>
        <button type="submit" className="primaryButton" disabled={saving}>
          {saving
            ? mode === "VALIDATE"
              ? "Validation du PDF…"
              : "Ouverture d’Outlook…"
            : mode === "VALIDATE"
              ? "Confirmer la validation"
              : outlookOpenedWithoutAttachment
                ? "J’ai envoyé"
                : alreadyValidated
                  ? "Ouvrir Outlook"
                  : "Valider et ouvrir Outlook"}
        </button>
      </div>
      <style jsx>{`
        .quoteFinalizeRow {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .quoteFinalizeRow :global(button) {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
      `}</style>
    </form>
  );
}

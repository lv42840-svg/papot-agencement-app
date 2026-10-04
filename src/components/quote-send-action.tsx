"use client";

import { FileLock2, Send } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import {
  renderQuoteEmailTemplate,
  type QuoteEmailSettings,
} from "@/lib/quote-email-settings/domain";
import { quoteRevisionHeaders } from "@/lib/quotes/concurrency";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type ApiResponse = { payload?: NativeQuotesPayload; error?: string };
type FinalizeMode = "VALIDATE" | "SEND";

type EmailDraft = {
  to: string;
  subject: string;
  body: string;
};

function sendErrorLabel(code?: string): string {
  if (code === "QUOTE_VERSION_CONFLICT")
    return "Ce devis a été modifié ailleurs. Recharge-le avant de le valider ou de l’envoyer.";
  if (code === "MODULE_FORBIDDEN") return "Droit de modification Devis et Commercial requis.";
  if (code === "QUOTE_FOLLOW_UP_DATE_REQUIRED") return "Choisis une date de relance valide.";
  if (code === "QUOTE_SEND_REQUEST_INVALID") return "Vérifie le mail et la date de relance.";
  if (code === "QUOTE_PRICING_REVIEW_REQUIRED" || code === "QUOTE_DOCUMENT_PRICING_WARNING") {
    return "Vérifie les ajustements de chiffrage signalés avant de figer le devis.";
  }
  if (code === "QUOTE_OPTION_TARGET_DUPLICATE" || code === "QUOTE_OPTION_TARGET_INVALID") {
    return "Vérifie les options du devis avant le gel du PDF.";
  }
  if (code === "QUOTE_NOT_EDITABLE") return "Ce devis n’est plus modifiable.";
  if (code === "QUOTE_NOT_FROZEN") return "Ce devis n’est pas encore validé.";
  if (code === "QUOTE_FINAL_PDF_ARCHIVE_CONFLICT") {
    return "Un PDF différent existe déjà pour ce numéro, cette variante et cette version.";
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
  if (code?.startsWith("QUOTE_WORD_V2_TEMPLATE_")) {
    return "Le modèle Word du devis est indisponible.";
  }
  if (code === "SERVER_FILE_ROOT_UNAVAILABLE") {
    return "Le dossier d’archivage PAPOT est inaccessible.";
  }
  if (code === "QUOTE_RECIPIENT_EMAIL_REQUIRED") {
    return "Renseigne une adresse e-mail destinataire.";
  }
  if (code === "QUOTE_EMAIL_CONTENT_REQUIRED") {
    return "L’objet et le message de l’e-mail sont obligatoires.";
  }
  if (code === "QUOTE_EMAIL_NOT_CONFIGURED") {
    return "L’envoi automatique des devis n’est pas encore configuré sur le serveur.";
  }
  if (code === "QUOTE_EMAIL_SEND_FAILED") {
    return "Le serveur n’a pas réussi à envoyer le devis. Il n’a pas été marqué comme envoyé.";
  }
  if (code?.startsWith("PDF_")) {
    return "La génération du PDF a échoué avant l’archivage.";
  }
  return code ? `Impossible d’envoyer le devis (${code}).` : "Impossible d’envoyer le devis.";
}

async function postFinalize(
  quoteId: string,
  mode: FinalizeMode,
  followUpDate: string,
  updatedAt: string,
  email?: EmailDraft,
): Promise<NativeQuotesPayload> {
  const response = await fetch(`/api/desktop/quotes/${quoteId}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...quoteRevisionHeaders(updatedAt),
    },
    body: JSON.stringify(
      mode === "SEND" ? { mode, followUpDate, email } : { mode },
    ),
  });
  const data = (await response.json()) as ApiResponse;
  if (!response.ok || !data.payload) throw new Error(data.error ?? "QUOTE_SEND_FAILED");
  return data.payload;
}

function buildEmailDraft(params: {
  quote: NativeQuoteRecord;
  settings: QuoteEmailSettings;
  recipientEmail: string;
  recipientName: string;
  clientName: string;
  affairName: string;
}): EmailDraft {
  const quoteNumber = params.quote.finalPdf?.quoteNumber ?? "";
  const greeting = params.recipientName.trim()
    ? `Bonjour ${params.recipientName.trim()},`
    : "Bonjour,";
  const values = {
    AFFAIRE: params.affairName,
    BONJOUR: greeting,
    CLIENT: params.clientName,
    CONTACT: params.recipientName,
    NUM_DEVIS: quoteNumber,
    OBJET_DEVIS: params.quote.model.subject,
  };

  return {
    to: params.recipientEmail,
    subject: renderQuoteEmailTemplate(params.settings.subjectTemplate, values),
    body: renderQuoteEmailTemplate(params.settings.bodyTemplate, values),
  };
}

export function QuoteSendAction({
  quote,
  canWrite,
  clientName,
  affairName,
  recipientEmail,
  recipientName,
  emailSettings,
  onSaved,
}: {
  quote: NativeQuoteRecord;
  canWrite: boolean;
  clientName: string;
  affairName: string;
  recipientEmail: string;
  recipientName: string;
  emailSettings: QuoteEmailSettings;
  onSaved: (payload: NativeQuotesPayload) => void;
}) {
  const [mode, setMode] = useState<FinalizeMode | null>(null);
  const [followUpDate, setFollowUpDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);

  const defaultFrozenDraft = useMemo(
    () =>
      quote.status === "FROZEN"
        ? buildEmailDraft({
            quote,
            settings: emailSettings,
            recipientEmail,
            recipientName,
            clientName,
            affairName,
          })
        : null,
    [affairName, clientName, emailSettings, quote, recipientEmail, recipientName],
  );

  function startMode(nextMode: FinalizeMode) {
    setError("");
    setMode(nextMode);
    setEmailDraft(nextMode === "SEND" ? defaultFrozenDraft : null);
  }

  function cancel() {
    setError("");
    setMode(null);
    setEmailDraft(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode) return;

    setSaving(true);
    setError("");
    try {
      if (mode === "VALIDATE") {
        const payload = await postFinalize(quote.id, "VALIDATE", "", quote.updatedAt);
        onSaved(payload);
        setMode(null);
        return;
      }

      if (!emailDraft) {
        const payload = await postFinalize(quote.id, "VALIDATE", "", quote.updatedAt);
        onSaved(payload);
        const frozen = payload.quotes.find((candidate) => candidate.id === quote.id);
        if (!frozen) throw new Error("QUOTE_NOT_FOUND");
        setEmailDraft(
          buildEmailDraft({
            quote: frozen,
            settings: emailSettings,
            recipientEmail,
            recipientName,
            clientName,
            affairName,
          }),
        );
        return;
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) {
        setError("Choisis une date de relance valide.");
        return;
      }
      if (!emailDraft.to.trim()) {
        setError("Renseigne une adresse e-mail destinataire.");
        return;
      }
      if (!emailDraft.subject.trim() || !emailDraft.body.trim()) {
        setError("L’objet et le message de l’e-mail sont obligatoires.");
        return;
      }

      const payload = await postFinalize(
        quote.id,
        "SEND",
        followUpDate,
        quote.updatedAt,
        emailDraft,
      );
      onSaved(payload);
      setMode(null);
      setEmailDraft(null);
    } catch (caught) {
      setError(sendErrorLabel(caught instanceof Error ? caught.message : ""));
    } finally {
      setSaving(false);
    }
  }

  if (quote.status === "SENT" || quote.status === "ACCEPTED" || quote.status === "REJECTED") {
    return quote.finalPdf ? (
      <div className="quoteNotice">
        <FileLock2 size={14} aria-hidden="true" /> {quote.finalPdf.quoteNumber} · PDF figé ·{" "}
        {quote.variantName} V{quote.version}
        {quote.followUpDate ? ` · relance prévue le ${quote.followUpDate}` : ""}
      </div>
    ) : null;
  }

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

  return (
    <form className="quoteDraftForm quoteEmailCompose" onSubmit={submit}>
      <div className="quoteNotice">
        {mode === "VALIDATE"
          ? "Le PDF recevra son numéro définitif et sera figé. Le devis restera non envoyé."
          : emailDraft
            ? "Vérifie ou modifie le mail avant l’envoi, comme pour les bons de commande PAPOT CONCEPT."
            : "PAPOT va d’abord figer le PDF et attribuer le numéro définitif, puis ouvrir le mail modifiable."}
      </div>

      {mode === "SEND" && emailDraft ? (
        <>
          <label className="quoteField">
            <span>Destinataire</span>
            <input
              type="email"
              value={emailDraft.to}
              onChange={(event) =>
                setEmailDraft((current) => current ? { ...current, to: event.target.value } : current)
              }
              required
            />
          </label>
          <label className="quoteField">
            <span>Objet</span>
            <input
              value={emailDraft.subject}
              onChange={(event) =>
                setEmailDraft((current) =>
                  current ? { ...current, subject: event.target.value } : current,
                )
              }
              required
            />
          </label>
          <label className="quoteField">
            <span>Message</span>
            <textarea
              rows={9}
              value={emailDraft.body}
              onChange={(event) =>
                setEmailDraft((current) =>
                  current ? { ...current, body: event.target.value } : current,
                )
              }
              required
            />
          </label>
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
            De : {emailSettings.fromEmail} · copie : {emailSettings.ccEmail} · réponses :{" "}
            {emailSettings.replyToEmail}
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
              : emailDraft
                ? "Envoi du devis…"
                : "Préparation du mail…"
            : mode === "VALIDATE"
              ? "Confirmer la validation"
              : emailDraft
                ? "Envoyer le devis"
                : "Valider le PDF et préparer le mail"}
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
        .quoteEmailCompose {
          display: grid;
          gap: 10px;
        }
        .quoteEmailCompose textarea {
          width: 100%;
          resize: vertical;
        }
      `}</style>
    </form>
  );
}

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

export function QuoteSendAction({
  quote,
  canWrite,
  onSaved,
}: {
  quote: NativeQuoteRecord;
  canWrite: boolean;
  onSaved: (payload: NativeQuotesPayload) => void;
}) {
  const [mode, setMode] = useState<FinalizeMode | null>(null);
  const [followUpDate, setFollowUpDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
      const response = await fetch(`/api/desktop/quotes/${quote.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "SEND" ? { mode, followUpDate } : { mode },
        ),
      });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok || !data.payload) {
        setError(sendErrorLabel(data.error));
        return;
      }
      onSaved(data.payload);
      setMode(null);
    } catch {
      setError("Impossible de générer et figer le PDF du devis.");
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
          <button type="button" className="primaryButton" onClick={() => setMode("SEND")}>
            <Send size={15} aria-hidden="true" /> Envoyer
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
        <button type="button" className="secondaryButton" onClick={() => setMode("VALIDATE")}>
          <FileLock2 size={15} aria-hidden="true" /> Valider
        </button>
        <button type="button" className="primaryButton" onClick={() => setMode("SEND")}>
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
          : alreadyValidated
            ? "Le PDF est déjà figé. Le devis va maintenant passer en Envoyé."
            : "Le PDF recevra son numéro définitif, sera figé puis le devis passera en Envoyé."}
      </div>
      {mode === "SEND" ? (
        <label className="quoteField">
          <span>Date de relance obligatoire</span>
          <input
            type="date"
            value={followUpDate}
            onChange={(event) => setFollowUpDate(event.target.value)}
            required
          />
        </label>
      ) : null}
      {error ? <div className="quoteFormError">{error}</div> : null}
      <div className="quoteDraftActions">
        <button type="button" className="secondaryButton" onClick={() => setMode(null)}>
          Annuler
        </button>
        <button type="submit" className="primaryButton" disabled={saving}>
          {saving
            ? mode === "VALIDATE"
              ? "Validation du PDF…"
              : "Validation et envoi…"
            : mode === "VALIDATE"
              ? "Confirmer la validation"
              : alreadyValidated
                ? "Confirmer l’envoi"
                : "Valider et envoyer"}
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

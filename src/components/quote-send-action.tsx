"use client";

import { FileLock2, Send } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type ApiResponse = { payload?: NativeQuotesPayload; error?: string };

function sendErrorLabel(code?: string): string {
  if (code === "MODULE_FORBIDDEN") {
    return "Droit de modification Devis et Commercial requis.";
  }
  if (code === "QUOTE_FOLLOW_UP_DATE_REQUIRED") {
    return "Choisis une date de relance valide.";
  }
  if (code === "QUOTE_PRICING_REVIEW_REQUIRED" || code === "QUOTE_DOCUMENT_PRICING_WARNING") {
    return "Vérifie les ajustements de chiffrage signalés avant de figer le devis.";
  }
  if (code === "QUOTE_OPTION_TARGET_DUPLICATE" || code === "QUOTE_OPTION_TARGET_INVALID") {
    return "Vérifie les options du devis avant le gel du PDF.";
  }
  if (code === "QUOTE_NOT_EDITABLE") return "Ce devis n’est plus modifiable.";
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
  if (code?.startsWith("PDF_") || code === "SERVER_FILE_ROOT_UNAVAILABLE") {
    return "Impossible de générer ou d’archiver le PDF final. Rien n’a été figé.";
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
  const [open, setOpen] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(followUpDate)) {
      setError("Choisis une date de relance valide.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/desktop/quotes/${quote.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followUpDate }),
      });
      const data = (await response.json()) as ApiResponse;
      if (!response.ok || !data.payload) {
        setError(sendErrorLabel(data.error));
        return;
      }
      onSaved(data.payload);
      setOpen(false);
    } catch {
      setError("Impossible de générer et figer le PDF du devis.");
    } finally {
      setSaving(false);
    }
  }

  if (quote.status !== "DRAFT") {
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
  if (!canWrite) return null;

  if (!open) {
    return (
      <button type="button" className="primaryButton" onClick={() => setOpen(true)}>
        <Send size={15} aria-hidden="true" /> Générer et figer le PDF
      </button>
    );
  }

  return (
    <form className="quoteDraftForm" onSubmit={submit}>
      <div className="quoteNotice">
        Le PDF recevra son numéro définitif puis sera archivé sans possibilité d’écraser ce fichier.
        Pour modifier ensuite le devis, crée une nouvelle version.
      </div>
      <label className="quoteField">
        <span>Date de relance obligatoire</span>
        <input
          type="date"
          value={followUpDate}
          onChange={(event) => setFollowUpDate(event.target.value)}
          required
        />
      </label>
      {error ? <div className="quoteFormError">{error}</div> : null}
      <div className="quoteDraftActions">
        <button type="button" className="secondaryButton" onClick={() => setOpen(false)}>
          Annuler
        </button>
        <button type="submit" className="primaryButton" disabled={saving}>
          {saving ? "Génération du PDF…" : "Confirmer et figer"}
        </button>
      </div>
    </form>
  );
}

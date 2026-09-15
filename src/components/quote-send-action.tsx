"use client";

import { Send } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type ApiResponse = { payload?: NativeQuotesPayload; error?: string };

function sendErrorLabel(code?: string): string {
  if (code === "MODULE_FORBIDDEN") {
    return "Droit de modification Devis et Commercial requis.";
  }
  if (code === "QUOTE_PRICING_REVIEW_REQUIRED") {
    return "Vérifie les ajustements de chiffrage signalés avant d’envoyer le devis.";
  }
  if (code === "QUOTE_OPTION_TARGET_DUPLICATE" || code === "QUOTE_OPTION_TARGET_INVALID") {
    return "Vérifie les options du devis avant l’envoi.";
  }
  if (code === "QUOTE_NOT_EDITABLE") return "Ce devis n’est plus modifiable.";
  return "Choisis une date de relance valide.";
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
      setError("Impossible d’enregistrer l’envoi du devis.");
    } finally {
      setSaving(false);
    }
  }

  if (quote.status !== "DRAFT") {
    return quote.followUpDate ? (
      <div className="quoteNotice">Envoyé · relance prévue le {quote.followUpDate}</div>
    ) : null;
  }
  if (!canWrite) return null;

  if (!open) {
    return (
      <button type="button" className="primaryButton" onClick={() => setOpen(true)}>
        <Send size={15} aria-hidden="true" /> Passer en envoyé
      </button>
    );
  }

  return (
    <form className="quoteDraftForm" onSubmit={submit}>
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
          {saving ? "Enregistrement…" : "Confirmer l’envoi"}
        </button>
      </div>
    </form>
  );
}

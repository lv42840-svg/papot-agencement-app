"use client";

import { Copy, GitBranch, History } from "lucide-react";
import { useState } from "react";
import { quoteHref } from "@/lib/quotes/navigation";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type LifecycleAction = "createVersion" | "createVariant" | "duplicateQuote";

type LifecycleResponse = {
  payload?: NativeQuotesPayload;
  focusQuoteId?: string;
  error?: string;
};

function errorLabel(code: string): string {
  if (code === "QUOTE_VERSION_SOURCE_OUTDATED") {
    return "Cette version n’est plus la version courante. Ouvre la dernière version pour continuer.";
  }
  if (code === "QUOTE_VERSION_SOURCE_CLOSED") {
    return "Un devis accepté ou annulé ne peut pas être remplacé par une nouvelle version.";
  }
  if (code === "MODULE_FORBIDDEN") return "Ton profil n’autorise pas la modification des devis.";
  return "La nouvelle copie du devis n’a pas pu être créée.";
}

export function QuoteLifecycleActions({
  quote,
  canWrite,
}: {
  quote: NativeQuoteRecord;
  canWrite: boolean;
}) {
  const [working, setWorking] = useState<LifecycleAction | null>(null);
  const [error, setError] = useState("");
  const isPrevious = quote.status === "SUPERSEDED";

  async function run(action: LifecycleAction) {
    if (!canWrite || working || isPrevious) return;
    setWorking(action);
    setError("");
    try {
      const response = await fetch(`/api/desktop/quotes/${quote.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as LifecycleResponse;
      if (!response.ok || !data.payload || !data.focusQuoteId) {
        setError(errorLabel(data.error ?? "QUOTE_LIFECYCLE_FAILED"));
        return;
      }
      window.location.assign(quoteHref(data.focusQuoteId));
    } catch {
      setError("La nouvelle copie du devis n’a pas pu être créée.");
    } finally {
      setWorking(null);
    }
  }

  if (isPrevious) {
    return (
      <div className="quoteLifecyclePrevious">
        <History size={14} aria-hidden="true" />
        <span>
          <strong>Version précédente</strong>
          Cette version est conservée en lecture seule. Ouvre la dernière version pour la modifier.
        </span>
        <style jsx>{`
          .quoteLifecyclePrevious {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            border: 1px solid #ddd8e4;
            border-radius: 9px;
            background: #f7f5f8;
            color: #6f6875;
            font-size: 11px;
          }
          .quoteLifecyclePrevious span {
            display: grid;
            gap: 2px;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="quoteLifecycleActions">
      <div className="quoteLifecycleIdentity">
        <strong>{quote.variantName}</strong>
        <span>V{quote.version} · version courante</span>
      </div>
      <div className="quoteLifecycleButtons">
        <button
          className="secondaryButton"
          type="button"
          disabled={!canWrite || Boolean(working) || quote.status === "ACCEPTED" || quote.status === "CANCELLED"}
          onClick={() => void run("createVersion")}
        >
          <History size={14} /> {working === "createVersion" ? "Création…" : "Nouvelle version"}
        </button>
        <button
          className="secondaryButton"
          type="button"
          disabled={!canWrite || Boolean(working)}
          onClick={() => void run("createVariant")}
        >
          <GitBranch size={14} /> {working === "createVariant" ? "Création…" : "Nouvelle variante"}
        </button>
        <button
          className="secondaryButton"
          type="button"
          disabled={!canWrite || Boolean(working)}
          onClick={() => void run("duplicateQuote")}
        >
          <Copy size={14} /> {working === "duplicateQuote" ? "Duplication…" : "Dupliquer"}
        </button>
      </div>
      {error ? <div className="quoteLifecycleError">{error}</div> : null}

      <style jsx>{`
        .quoteLifecycleActions {
          display: grid;
          grid-template-columns: minmax(180px, 1fr) auto;
          align-items: center;
          gap: 10px 16px;
          padding: 10px 12px;
          border: 1px solid #ded7ed;
          border-radius: 10px;
          background: #faf8ff;
        }
        .quoteLifecycleIdentity {
          display: grid;
          gap: 2px;
        }
        .quoteLifecycleIdentity strong {
          font-size: 12px;
        }
        .quoteLifecycleIdentity span {
          color: var(--muted);
          font-size: 10px;
        }
        .quoteLifecycleButtons {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 7px;
          flex-wrap: wrap;
        }
        .quoteLifecycleButtons button {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .quoteLifecycleError {
          grid-column: 1 / -1;
          padding: 7px 9px;
          border-radius: 7px;
          background: #fff0f0;
          color: #9c3434;
          font-size: 10px;
          font-weight: 700;
        }
        @media (max-width: 760px) {
          .quoteLifecycleActions {
            grid-template-columns: 1fr;
          }
          .quoteLifecycleButtons {
            justify-content: flex-start;
          }
        }
      `}</style>
    </div>
  );
}

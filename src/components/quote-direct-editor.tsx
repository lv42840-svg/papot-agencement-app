"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { QuoteComponentCheck } from "@/components/quote-component-check";
import { QuoteFixedSummary } from "@/components/quote-fixed-summary";
import { QuoteGeneralInfoEditor } from "@/components/quote-general-info-editor";
import { QuoteInternalNotesEditor } from "@/components/quote-internal-notes-editor";
import { QuoteLegalDetailsEditor } from "@/components/quote-legal-details-editor";
import { QuoteLifecycleActions } from "@/components/quote-lifecycle-actions";
import { QuotePricingAdjustmentsEditor } from "@/components/quote-pricing-adjustments-editor";
import { QuoteRichTextLayer } from "@/components/quote-rich-text-layer";
import { QuoteSendAction } from "@/components/quote-send-action";
import { QuoteStructuredLinesRichEditor } from "@/components/quote-structured-lines-rich-editor";
import { calculateQuoteAdjustedPricing } from "@/lib/quotes/adjustments";
import {
  quoteContractSelectionLabel,
  type QuoteContractSelectionState,
} from "@/lib/quotes/retention";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

function quoteWithAdjustedDisplayPrices(quote: NativeQuoteRecord): NativeQuoteRecord {
  const pricing = calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig);
  const adjustedByLineId = new Map(pricing.lines.map((line) => [line.lineId, line]));

  return {
    ...quote,
    model: {
      ...quote.model,
      items: quote.model.items.map((item) => {
        if (item.kind !== "LINE") return item;
        const adjusted = adjustedByLineId.get(item.id);
        if (!adjusted || item.quantity <= 0) return item;
        return {
          ...item,
          // Vue uniquement : conserve le total de ligne exact, y compris les centimes
          // distribués par le moteur. Les composants et prix de base restent inchangés
          // et sont réutilisés dès qu'on ouvre l'édition de l'ouvrage.
          unitPriceCents: adjusted.saleCents / item.quantity,
        };
      }),
    },
  };
}

export function QuoteDirectEditor({
  initialPayload,
  quoteId,
  canWrite,
  clientName,
  affairName,
  paymentTermOptions,
  contractState,
}: {
  initialPayload: NativeQuotesPayload;
  quoteId: string;
  canWrite: boolean;
  clientName: string;
  affairName: string;
  paymentTermOptions: string[];
  contractState: QuoteContractSelectionState;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const quote = useMemo(
    () => payload.quotes.find((candidate) => candidate.id === quoteId) ?? null,
    [payload.quotes, quoteId],
  );
  const displayQuote = useMemo(
    () => (quote ? quoteWithAdjustedDisplayPrices(quote) : null),
    [quote],
  );

  if (!quote || !displayQuote) return null;

  return (
    <div className="quoteDirectWorkspace">
      {contractState ? (
        <div
          className={`quoteContractState ${
            contractState === "RETAINED" ? "isRetained" : "isClassed"
          }`}
        >
          <strong>{quoteContractSelectionLabel(contractState)}</strong>
          <span>
            {contractState === "RETAINED"
              ? "Ce devis entre dans le contrat de l’affaire."
              : "Ce devis reste dans l’historique mais n’entre pas dans le contrat."}
          </span>
        </div>
      ) : null}
      <QuoteLifecycleActions quote={quote} canWrite={canWrite} />
      <QuoteSendAction quote={quote} canWrite={canWrite} onSaved={setPayload} />

      <QuoteGeneralInfoEditor
        quote={quote}
        clientName={clientName}
        affairName={affairName}
        paymentTermOptions={paymentTermOptions}
        canWrite={canWrite}
        onSaved={setPayload}
      />

      <QuoteLegalDetailsEditor quote={quote} canWrite={canWrite} onSaved={setPayload} />

      <QuoteInternalNotesEditor quote={quote} canWrite={canWrite} onSaved={setPayload} />

      <QuoteStructuredLinesRichEditor
        quote={displayQuote}
        canWrite={canWrite}
        onSaved={setPayload}
        headerActions={
          <div className="quoteDirectActions">
            <Link href="/devis" className="secondaryButton quoteDirectBack">
              <ArrowLeft size={14} /> Tous les devis
            </Link>
            <QuoteComponentCheck quote={quote} />
          </div>
        }
      />

      <QuoteRichTextLayer quote={displayQuote} />

      <QuotePricingAdjustmentsEditor quote={quote} canWrite={canWrite} onSaved={setPayload} />

      <div className="quoteDirectSummarySpacer" aria-hidden="true" />
      <QuoteFixedSummary quote={quote} />

      <style jsx>{`
        .quoteDirectWorkspace {
          display: grid;
          gap: 14px;
        }
        .quoteContractState {
          padding: 9px 11px;
          display: flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #ddd8e4;
          border-radius: 9px;
          background: #f7f5f8;
          color: #6f6875;
          font-size: 11px;
        }
        .quoteContractState.isRetained {
          border-color: #cfe6d8;
          background: #edf8f1;
          color: #347850;
        }
        .quoteContractState strong {
          flex: 0 0 auto;
        }
        .quoteContractState span {
          color: inherit;
        }
        .quoteDirectActions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }
        .quoteDirectActions :global(.quoteDirectBack) {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          text-decoration: none;
        }
        .quoteDirectSummarySpacer {
          height: 78px;
        }
      `}</style>
    </div>
  );
}

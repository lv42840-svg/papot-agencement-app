"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { QuoteComponentCheck } from "@/components/quote-component-check";
import { QuoteFixedSummary } from "@/components/quote-fixed-summary";
import { QuoteGeneralInfoEditor } from "@/components/quote-general-info-editor";
import { QuoteInternalNotesEditor } from "@/components/quote-internal-notes-editor";
import { QuotePricingAdjustmentsEditor } from "@/components/quote-pricing-adjustments-editor";
import { QuoteSendAction } from "@/components/quote-send-action";
import { QuoteStructuredLinesEditor } from "@/components/quote-structured-lines-editor";
import { calculateQuoteAdjustedPricing } from "@/lib/quotes/adjustments";
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
}: {
  initialPayload: NativeQuotesPayload;
  quoteId: string;
  canWrite: boolean;
  clientName: string;
  affairName: string;
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
      <QuoteGeneralInfoEditor
        quote={quote}
        clientName={clientName}
        affairName={affairName}
        canWrite={canWrite}
        onSaved={setPayload}
      />

      <QuoteInternalNotesEditor quote={quote} canWrite={canWrite} onSaved={setPayload} />

      <QuoteStructuredLinesEditor
        quote={displayQuote}
        canWrite={canWrite}
        onSaved={setPayload}
        headerActions={
          <div className="quoteDirectActions">
            <QuoteComponentCheck quote={quote} />
            <Link href="/devis" className="secondaryButton quoteDirectBack">
              <ArrowLeft size={14} /> Tous les devis
            </Link>
            <QuoteSendAction quote={quote} canWrite={canWrite} onSaved={setPayload} />
          </div>
        }
      />

      <QuotePricingAdjustmentsEditor quote={quote} canWrite={canWrite} onSaved={setPayload} />

      <div className="quoteDirectSummarySpacer" aria-hidden="true" />
      <QuoteFixedSummary quote={quote} />

      <style jsx>{`
        .quoteDirectWorkspace {
          display: grid;
          gap: 14px;
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

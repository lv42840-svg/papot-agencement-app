"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { QuoteFixedSummary } from "@/components/quote-fixed-summary";
import { QuoteGeneralInfoEditor } from "@/components/quote-general-info-editor";
import { QuoteSendAction } from "@/components/quote-send-action";
import { QuoteStructuredLinesEditor } from "@/components/quote-structured-lines-editor";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

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

  if (!quote) return null;

  return (
    <div className="quoteDirectWorkspace">
      <QuoteGeneralInfoEditor
        quote={quote}
        clientName={clientName}
        affairName={affairName}
        canWrite={canWrite}
        onSaved={setPayload}
      />

      <QuoteStructuredLinesEditor
        quote={quote}
        canWrite={canWrite}
        onSaved={setPayload}
        headerActions={
          <div className="quoteDirectActions">
            <Link href="/devis" className="secondaryButton quoteDirectBack">
              <ArrowLeft size={14} /> Tous les devis
            </Link>
            <QuoteSendAction quote={quote} canWrite={canWrite} onSaved={setPayload} />
          </div>
        }
      />
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

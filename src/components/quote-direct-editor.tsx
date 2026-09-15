"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { QuoteStructuredLinesEditor } from "@/components/quote-structured-lines-editor";
import { QuoteSendAction } from "@/components/quote-send-action";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

export function QuoteDirectEditor({
  initialPayload,
  quoteId,
  canWrite,
}: {
  initialPayload: NativeQuotesPayload;
  quoteId: string;
  canWrite: boolean;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const quote = useMemo(
    () => payload.quotes.find((candidate) => candidate.id === quoteId) ?? null,
    [payload.quotes, quoteId],
  );

  if (!quote) return null;

  return (
    <>
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

      <style jsx>{`
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
      `}</style>
    </>
  );
}

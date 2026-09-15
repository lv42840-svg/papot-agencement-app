"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { QuoteLinesEditor } from "@/components/quote-lines-editor";
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
    <div className="quoteDirectEditor">
      <section className="panel quoteDirectHeader">
        <div>
          <p className="eyebrow">Devis</p>
          <h2>{quote.model.subject}</h2>
          <span>
            {quote.variantName} · V{quote.version}
          </span>
        </div>
        <div className="quoteDirectActions">
          <Link href="/devis" className="secondaryButton quoteDirectBack">
            <ArrowLeft size={14} /> Tous les devis
          </Link>
          <QuoteSendAction quote={quote} canWrite={canWrite} onSaved={setPayload} />
        </div>
      </section>

      <QuoteLinesEditor quote={quote} canWrite={canWrite} onSaved={setPayload} />

      <style jsx>{`
        .quoteDirectEditor {
          display: grid;
          gap: 14px;
        }
        .quoteDirectHeader {
          padding: 16px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
        }
        .quoteDirectHeader h2,
        .quoteDirectHeader p {
          margin-bottom: 0;
        }
        .quoteDirectHeader span {
          color: var(--muted);
          font-size: 11px;
        }
        .quoteDirectActions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }
        .quoteDirectHeader :global(.quoteDirectBack) {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          text-decoration: none;
        }
      `}</style>
    </div>
  );
}

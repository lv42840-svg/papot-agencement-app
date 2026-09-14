"use client";

import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { useMemo, useState } from "react";
import { QuoteLinesEditor } from "@/components/quote-lines-editor";
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
        <Link href="/devis" className="secondaryButton quoteDirectBack">
          <ArrowLeft size={14} /> Tous les devis
        </Link>
      </section>

      <div className="quoteDirectHint">
        <FileText size={14} /> Devis ouvert directement depuis le suivi de l’affaire.
      </div>

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
        .quoteDirectHeader :global(.quoteDirectBack) {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          text-decoration: none;
        }
        .quoteDirectHint {
          padding: 9px 12px;
          display: flex;
          align-items: center;
          gap: 7px;
          border: 1px solid #e1daf4;
          border-radius: 8px;
          background: #faf8ff;
          color: #74688b;
          font-size: 10px;
        }
      `}</style>
    </div>
  );
}

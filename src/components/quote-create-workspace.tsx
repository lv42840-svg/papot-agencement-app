"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type { QuoteAffairOption } from "@/components/quotes-workspace";
import { quoteHref } from "@/lib/quotes/navigation";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

type QuotesApiResponse = {
  payload?: NativeQuotesPayload;
  focusQuoteId?: string;
  error?: string;
};

function quoteErrorLabel(code: string): string {
  if (code === "QUOTE_AFFAIR_NOT_FOUND") return "L’affaire sélectionnée n’existe plus.";
  if (code === "QUOTE_AFFAIR_CLOSED") return "Cette affaire est fermée.";
  if (code === "QUOTE_CLIENT_NOT_FOUND") return "Cette affaire doit être liée à un client.";
  if (code === "QUOTE_CLIENT_ARCHIVED") return "Le client lié à cette affaire est archivé.";
  if (code === "QUOTES_REQUEST_INVALID") return "Vérifie les informations du brouillon.";
  if (code === "MODULE_FORBIDDEN") return "Ton profil n’autorise pas la création de devis.";
  return "Le brouillon n’a pas pu être enregistré.";
}

export function QuoteCreateWorkspace({
  affairs,
  canWrite,
  today,
}: {
  affairs: QuoteAffairOption[];
  canWrite: boolean;
  today: string;
}) {
  const router = useRouter();
  const affairsById = useMemo(
    () => new Map(affairs.map((affair) => [affair.id, affair])),
    [affairs],
  );
  const firstAffair = affairs[0];
  const [selectedAffairId, setSelectedAffairId] = useState(firstAffair?.id ?? "");
  const [subject, setSubject] = useState(firstAffair?.name ?? "");
  const [variantName, setVariantName] = useState("Base");
  const [issueDate, setIssueDate] = useState(today);
  const [paymentTerms, setPaymentTerms] = useState(firstAffair?.paymentTerms ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function selectAffair(affairId: string) {
    setSelectedAffairId(affairId);
    const affair = affairsById.get(affairId);
    setSubject(affair?.name ?? "");
    setPaymentTerms(affair?.paymentTerms ?? "");
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || !selectedAffairId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createDraft",
          commercialCaseId: selectedAffairId,
          subject,
          issueDate,
          variantName,
          paymentTerms,
        }),
      });
      const data = (await response.json()) as QuotesApiResponse;
      if (!response.ok || !data.payload || !data.focusQuoteId) {
        setError(quoteErrorLabel(data.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }
      router.replace(quoteHref(data.focusQuoteId));
    } catch {
      setError("Le brouillon n’a pas pu être enregistré.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="quoteCreateWorkspace">
      <div className="quoteCreateTop">
        <Link href="/devis" className="secondaryButton quoteCreateBack">
          <ArrowLeft size={14} /> Tous les devis
        </Link>
      </div>

      <section className="panel quoteCreatePanel">
        <div className="quoteCreateHeader">
          <div>
            <p className="eyebrow">Nouveau devis</p>
            <h2>Créer le brouillon</h2>
            <p className="muted">
              Choisis l’affaire et les informations de départ. Le devis s’ouvrira ensuite dans sa
              page complète.
            </p>
          </div>
          <span className="quoteCreatePill">Pas encore numéroté</span>
        </div>

        {!canWrite ? (
          <div className="quoteCreateNotice">Ton profil est en lecture seule sur les devis.</div>
        ) : affairs.length === 0 ? (
          <div className="quoteCreateNotice">
            Lie d’abord un client à une affaire active pour pouvoir créer son devis.
          </div>
        ) : (
          <form className="quoteCreateForm" onSubmit={createDraft}>
            <label className="quoteField quoteFieldWide">
              <span>Affaire</span>
              <select
                value={selectedAffairId}
                onChange={(event) => selectAffair(event.target.value)}
                required
                disabled={saving}
              >
                {affairs.map((affair) => (
                  <option key={affair.id} value={affair.id}>
                    {affair.clientName} · {affair.name}
                    {affair.siteLabel ? ` · ${affair.siteLabel}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="quoteField quoteFieldWide">
              <span>Objet</span>
              <input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                maxLength={240}
                required
                disabled={saving}
              />
            </label>

            <label className="quoteField">
              <span>Variante</span>
              <input
                value={variantName}
                onChange={(event) => setVariantName(event.target.value)}
                maxLength={120}
                required
                disabled={saving}
              />
            </label>

            <label className="quoteField">
              <span>Date du devis</span>
              <input
                type="date"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
                required
                disabled={saving}
              />
            </label>

            <label className="quoteField quoteFieldWide">
              <span>Conditions de règlement</span>
              <textarea
                value={paymentTerms}
                onChange={(event) => setPaymentTerms(event.target.value)}
                rows={3}
                disabled={saving}
              />
            </label>

            {error ? <div className="quoteCreateError quoteFieldWide">{error}</div> : null}

            <div className="quoteCreateActions quoteFieldWide">
              <button className="primaryButton" type="submit" disabled={saving}>
                <FilePlus2 size={15} /> {saving ? "Création…" : "Créer et ouvrir le devis"}
              </button>
              <Link href="/devis" className="secondaryButton quoteCancelLink">
                Annuler
              </Link>
            </div>
          </form>
        )}
      </section>

      <style jsx>{`
        .quoteCreateWorkspace {
          display: grid;
          gap: 14px;
        }
        .quoteCreateTop {
          display: flex;
          justify-content: flex-start;
        }
        .quoteCreateTop :global(.quoteCreateBack),
        .quoteCreateActions :global(.quoteCancelLink) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          text-decoration: none;
        }
        .quoteCreatePanel {
          padding: 22px;
        }
        .quoteCreateHeader {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--border);
        }
        .quoteCreateHeader h2 {
          margin-bottom: 5px;
        }
        .quoteCreateHeader p:last-child {
          max-width: 720px;
          margin-bottom: 0;
        }
        .quoteCreatePill {
          flex: 0 0 auto;
          padding: 6px 9px;
          border-radius: 999px;
          background: #eee9fb;
          color: #6654be;
          font-size: 11px;
          font-weight: 700;
        }
        .quoteCreateForm {
          max-width: 980px;
          padding-top: 20px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .quoteField {
          display: grid;
          gap: 6px;
        }
        .quoteFieldWide {
          grid-column: 1 / -1;
        }
        .quoteField > span {
          color: var(--muted);
          font-size: 11px;
          font-weight: 700;
        }
        .quoteField input,
        .quoteField select,
        .quoteField textarea {
          width: 100%;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #fff;
          color: var(--text);
          font: inherit;
        }
        .quoteField input,
        .quoteField select {
          min-height: 40px;
          padding: 0 11px;
        }
        .quoteField textarea {
          padding: 10px 11px;
          resize: vertical;
        }
        .quoteField input:focus,
        .quoteField select:focus,
        .quoteField textarea:focus {
          outline: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
          border-color: var(--accent);
        }
        .quoteCreateActions {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-top: 4px;
        }
        .quoteCreateActions button {
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }
        .quoteCreateError,
        .quoteCreateNotice {
          padding: 11px 13px;
          border: 1px solid #f0c9c9;
          border-radius: 8px;
          background: #fff7f7;
          color: #9d3f3f;
          font-size: 12px;
        }
        .quoteCreateNotice {
          margin-top: 20px;
          border-color: #e4def5;
          background: #faf8ff;
          color: var(--muted);
        }
        @media (max-width: 760px) {
          .quoteCreatePanel {
            padding: 16px;
          }
          .quoteCreateHeader {
            flex-direction: column;
          }
          .quoteCreateForm {
            grid-template-columns: 1fr;
          }
          .quoteFieldWide {
            grid-column: auto;
          }
        }
      `}</style>
    </div>
  );
}

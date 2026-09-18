"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FilePlus2, LockKeyhole } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type { QuoteAffairOption } from "@/components/quotes-workspace";
import { quoteHref } from "@/lib/quotes/navigation";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

type QuoteCreateAffairOption = QuoteAffairOption & {
  quoteOwnerName: string;
  quoteDueDate: string;
};

type QuoteOwnerOption = {
  id: string;
  displayName: string;
};

type QuotesApiResponse = {
  payload?: NativeQuotesPayload;
  focusQuoteId?: string;
  error?: string;
};

function quoteErrorLabel(code: string): string {
  if (code === "QUOTE_AFFAIR_NOT_FOUND") return "L’affaire sélectionnée n’existe plus.";
  if (code === "QUOTE_AFFAIR_CLOSED" || code === "COMMERCIAL_CASE_CLOSED") {
    return "Cette affaire est fermée.";
  }
  if (code === "QUOTE_CLIENT_NOT_FOUND") return "Cette affaire doit être liée à un client.";
  if (code === "QUOTE_CLIENT_ARCHIVED") return "Le client lié à cette affaire est archivé.";
  if (code === "COMMERCIAL_QUOTE_OWNER_AND_DATE_REQUIRED") {
    return "Choisis le responsable du chiffrage et la date prévue d’envoi.";
  }
  if (code === "QUOTES_REQUEST_INVALID") return "Vérifie les informations du brouillon.";
  if (code === "MODULE_FORBIDDEN") {
    return "Ton profil n’autorise pas la création de devis ou la mise à jour commerciale.";
  }
  return "Le brouillon n’a pas pu être enregistré.";
}

export function QuoteCreateWorkspace({
  affairs,
  canWrite,
  today,
  initialAffairId,
  initialVariantName,
  chantierComplement,
  backHref,
  paymentTermOptions,
  quoteOwners,
  defaultQuoteOwnerName,
}: {
  affairs: QuoteCreateAffairOption[];
  canWrite: boolean;
  today: string;
  initialAffairId?: string;
  initialVariantName: string;
  chantierComplement: boolean;
  backHref: string;
  paymentTermOptions: string[];
  quoteOwners: QuoteOwnerOption[];
  defaultQuoteOwnerName: string;
}) {
  const router = useRouter();
  const affairsById = useMemo(
    () => new Map(affairs.map((affair) => [affair.id, affair])),
    [affairs],
  );
  const firstAffair = affairs.find((affair) => affair.id === initialAffairId) ?? affairs[0];
  const defaultOwnerName = quoteOwners.some((owner) => owner.displayName === defaultQuoteOwnerName)
    ? defaultQuoteOwnerName
    : (quoteOwners[0]?.displayName ?? "");
  const [selectedAffairId, setSelectedAffairId] = useState(firstAffair?.id ?? "");
  const [subject, setSubject] = useState(firstAffair?.name ?? "");
  const [issueDate, setIssueDate] = useState(today);
  const [paymentTerms, setPaymentTerms] = useState(firstAffair?.paymentTerms ?? "");
  const [quoteOwnerName, setQuoteOwnerName] = useState(
    firstAffair?.quoteOwnerName || defaultOwnerName,
  );
  const [quoteDueDate, setQuoteDueDate] = useState(firstAffair?.quoteDueDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const availablePaymentTerms = useMemo(
    () =>
      Array.from(
        new Set(
          [affairsById.get(selectedAffairId)?.paymentTerms ?? "", ...paymentTermOptions]
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      ),
    [affairsById, paymentTermOptions, selectedAffairId],
  );
  const availableQuoteOwners = useMemo(
    () =>
      Array.from(
        new Set(
          [quoteOwnerName, ...quoteOwners.map((owner) => owner.displayName)]
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        ),
      ),
    [quoteOwnerName, quoteOwners],
  );

  function selectAffair(affairId: string) {
    setSelectedAffairId(affairId);
    const affair = affairsById.get(affairId);
    setSubject(affair?.name ?? "");
    setPaymentTerms(affair?.paymentTerms ?? availablePaymentTerms[0] ?? "");
    setQuoteOwnerName(affair?.quoteOwnerName || defaultOwnerName);
    setQuoteDueDate(affair?.quoteDueDate ?? "");
  }

  async function createDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || !selectedAffairId || !quoteOwnerName.trim() || !quoteDueDate) return;
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
          variantName: initialVariantName,
          paymentTerms,
          quoteOwnerName,
          quoteDueDate,
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
        <Link href={backHref} className="secondaryButton quoteCreateBack">
          <ArrowLeft size={14} /> {chantierComplement ? "Retour au chantier" : "Tous les devis"}
        </Link>
      </div>

      <section className="panel quoteCreatePanel">
        <div className="quoteCreateHeader">
          <div>
            <p className="eyebrow">
              {chantierComplement ? "Nouveau devis chantier" : "Nouveau devis"}
            </p>
            <h2>Créer {initialVariantName} V1</h2>
            <p className="muted">
              {chantierComplement
                ? "Ce devis complémentaire utilise le moteur Devis PAPOT existant. Il n’entre dans le contrat du chantier qu’après acceptation explicite."
                : "Le premier devis d’une affaire démarre automatiquement en Base V1. Les variantes et versions suivantes se créeront ensuite depuis le devis existant."}
            </p>
          </div>
          <span className="quoteCreatePill">{initialVariantName} · V1</span>
        </div>

        {!canWrite ? (
          <div className="quoteCreateNotice">Ton profil est en lecture seule sur les devis.</div>
        ) : affairs.length === 0 ? (
          <div className="quoteCreateNotice">
            Lie d’abord un client à une affaire active pour pouvoir créer son devis.
          </div>
        ) : quoteOwners.length === 0 ? (
          <div className="quoteCreateNotice">
            Aucun utilisateur actif ne peut être désigné responsable du chiffrage.
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

            <div className="quoteField">
              <span>Variante / version</span>
              <div className="quoteStructuredValue">
                <strong>{initialVariantName} · V1</strong>
                <small>
                  <LockKeyhole size={12} aria-hidden="true" /> Créé automatiquement
                </small>
              </div>
            </div>

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

            <label className="quoteField">
              <span>Responsable du chiffrage</span>
              <select
                value={quoteOwnerName}
                onChange={(event) => setQuoteOwnerName(event.target.value)}
                required
                disabled={saving}
              >
                {availableQuoteOwners.map((ownerName) => (
                  <option key={ownerName} value={ownerName}>
                    {ownerName}
                  </option>
                ))}
              </select>
            </label>

            <label className="quoteField">
              <span>Date prévue d’envoi</span>
              <input
                type="date"
                value={quoteDueDate}
                onChange={(event) => setQuoteDueDate(event.target.value)}
                required
                disabled={saving}
              />
            </label>

            <label className="quoteField quoteFieldWide">
              <span>Conditions de règlement</span>
              <select
                value={paymentTerms}
                onChange={(event) => setPaymentTerms(event.target.value)}
                required
                disabled={saving || availablePaymentTerms.length === 0}
              >
                {availablePaymentTerms.map((terms) => (
                  <option key={terms} value={terms}>
                    {terms}
                  </option>
                ))}
              </select>
            </label>

            <div className="quoteCreateFixed quoteFieldWide">
              <LockKeyhole size={13} aria-hidden="true" /> Validité du devis : 30 jours.{" "}
              {chantierComplement
                ? "L’affaire reste Confirmée : ce complément est suivi dans le chantier sans revenir en Chiffrage."
                : "À la création, l’affaire passe automatiquement en « Chiffrage en cours » avec le responsable et la date prévue ci-dessus."}
            </div>

            {error ? <div className="quoteCreateError quoteFieldWide">{error}</div> : null}

            <div className="quoteCreateActions quoteFieldWide">
              <button
                className="primaryButton"
                type="submit"
                disabled={
                  saving ||
                  availablePaymentTerms.length === 0 ||
                  !quoteOwnerName.trim() ||
                  !quoteDueDate
                }
              >
                <FilePlus2 size={15} />{" "}
                {saving ? "Création…" : `Créer et ouvrir ${initialVariantName} V1`}
              </button>
              <Link href={backHref} className="secondaryButton quoteCancelLink">
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
        .quoteStructuredValue {
          width: 100%;
          min-height: 40px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #fff;
          color: var(--text);
          font: inherit;
        }
        .quoteField input,
        .quoteField select {
          padding: 0 11px;
        }
        .quoteStructuredValue {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 0 11px;
          background: #faf8ff;
          border-color: #e4def2;
        }
        .quoteStructuredValue small,
        .quoteCreateFixed {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: var(--muted);
          font-size: 10px;
        }
        .quoteField input:focus,
        .quoteField select:focus {
          outline: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
          border-color: var(--accent);
        }
        .quoteCreateFixed {
          padding: 9px 11px;
          border: 1px solid #e4def2;
          border-radius: 8px;
          background: #faf8ff;
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
          .quoteStructuredValue {
            align-items: flex-start;
            flex-direction: column;
            padding-top: 9px;
            padding-bottom: 9px;
          }
        }
      `}</style>
    </div>
  );
}

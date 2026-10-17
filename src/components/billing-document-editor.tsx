"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowDown, ArrowUp, Copy, FileText, Plus, Save, Trash2 } from "lucide-react";
import {
  buildInvoiceDocumentLines,
  calculateInvoiceDocumentTotals,
} from "@/lib/billing/document-lines";
import type { BillingDocumentLine, BillingDraft, BillingPayload } from "@/lib/billing/domain";
import { calculateLineProgress, type LineProgressInput } from "@/lib/billing/progress";

type ApiSnapshot = { payload: BillingPayload; canWrite: boolean; error?: string };
type EditableRow = BillingDocumentLine & { quantityInput: string; priceInput: string };

const currency = (cents: number) =>
  (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const decimal = (value: number) => String(value).replace(".", ",");
const euros = (value: number) => (value / 100).toFixed(2).replace(".", ",");
function centsFromEuros(value: string): number {
  const text = value.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return NaN;
  return Math.round(Number(text) * 100);
}
function quantityFromText(value: string): number {
  const text = value.replace(/\s/g, "").replace(",", ".");
  return /^\d+(\.\d{1,4})?$/.test(text) ? Number(text) : NaN;
}
function editable(row: BillingDocumentLine): EditableRow {
  return { ...row, quantityInput: decimal(row.quantity), priceInput: euros(row.unitPriceCents) };
}
function serialize(row: EditableRow): BillingDocumentLine | null {
  if (!row.description.trim()) return null;
  const quantity = row.origin === "TITLE" ? 0 : quantityFromText(row.quantityInput);
  const unitPriceCents = row.origin === "TITLE" ? 0 : centsFromEuros(row.priceInput);
  if (
    !Number.isFinite(quantity) ||
    !Number.isSafeInteger(unitPriceCents) ||
    quantity < 0 ||
    unitPriceCents < 0 ||
    (row.origin !== "TITLE" && quantity <= 0)
  )
    return null;
  return {
    id: row.id,
    origin: row.origin,
    sourceLineId: row.sourceLineId,
    description: row.description,
    quantity,
    unit: row.unit,
    unitPriceCents,
    vatRatePercent: row.vatRatePercent,
  };
}
const labels: Record<BillingDraft["type"], string> = {
  STANDARD: "Facture classique",
  DEPOSIT: "Acompte",
  PROGRESS: "Situation",
  FINAL: "Solde",
};
const serverErrors: Record<string, string> = {
  BILLING_VERSION_CONFLICT:
    "Cette facture a été modifiée depuis l'ouverture. Recharge la page avant de poursuivre.",
  BILLING_DRAFT_HAS_DEPENDENTS:
    "Une facture plus récente dépend de ce projet : son montant ne peut plus changer.",
  BILLING_AMOUNT_EXCEEDS_CONTRACT:
    "Le total dépasse le restant du devis retenu. Un devis complémentaire validé est nécessaire.",
  BILLING_DOCUMENT_EMPTY: "Ajoute au moins une ligne avec un montant HT positif.",
  BILLING_DOCUMENT_DUPLICATE_LINE: "Des lignes sont dupliquées. Actualise puis réessaie.",
  BILLING_DOCUMENT_VAT_OUTSIDE_CONTRACT:
    "Le taux de TVA doit correspondre à un taux du devis retenu.",
  BILLING_DOCUMENT_SOURCE_LINE_INVALID: "La référence à une ligne du devis est incorrecte.",
  BILLING_PROGRESS_CANNOT_DECREASE: "Un avancement ne peut pas être inférieur à la situation précédente.",
  BILLING_PROGRESS_TAX_ALLOCATION_UNAVAILABLE: "La TVA est incompatible avec les acomptes déjà préparés.",
};

export function BillingDocumentEditor({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<BillingDraft | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [initialRows, setInitialRows] = useState<EditableRow[]>([]);
  const [payload, setPayload] = useState<BillingPayload | null>(null);
  const [progressValues, setProgressValues] = useState<Record<string, string>>({});
  const [pendingPercentages, setPendingPercentages] = useState<LineProgressInput[] | null>(null);
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function reload() {
    const response = await fetch("/api/desktop/billing", { cache: "no-store" });
    const json = (await response.json()) as ApiSnapshot;
    if (!response.ok) throw new Error(json.error ?? "Impossible de charger la facture");
    const selected = json.payload.drafts.find((item) => item.id === draftId);
    if (!selected) throw new Error("Projet de facture introuvable");
    setDraft(selected);
    setPayload(json.payload);
    setCanWrite(json.canWrite);
    setProgressValues(Object.fromEntries((selected.lines ?? []).map((line) =>
      [line.lineId, decimal(selected.lineProgress?.find((row) => row.lineId === line.lineId)?.percent
        ?? selected.cumulativePercent ?? 0)],
    )));
    setPendingPercentages(null);
    setLabel(selected.label);
    setNotes(selected.notes);
    const original = (
      selected.documentLines ?? buildInvoiceDocumentLines(selected, json.payload)
    ).map(editable);
    setRows(original);
    setInitialRows(original);
    setDirty(false);
  }
  useEffect(() => {
    void reload()
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Erreur de chargement"),
      )
      .finally(() => setLoading(false));
    // The draft ID is stable for this route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const parsedRows = useMemo(() => rows.map(serialize), [rows]);
  const invalid = parsedRows.some((row) => row === null);
  const preview = useMemo(() => {
    if (invalid || parsedRows.length === 0) return null;
    try {
      return calculateInvoiceDocumentTotals(parsedRows as BillingDocumentLine[]);
    } catch {
      return null;
    }
  }, [parsedRows, invalid]);
  const rates = [...new Set(draft?.contractTaxGroups.map((rate) => rate.ratePercent) ?? [20])].sort(
    (a, b) => a - b,
  );

  function alter(id: string, patch: Partial<EditableRow>) {
    setRows((old) => old.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setDirty(true);
    setNotice("");
  }
  function reorder(index: number, direction: number) {
    const other = index + direction;
    if (other < 0 || other >= rows.length) return;
    setRows((old) => {
      const result = [...old];
      [result[index], result[other]] = [result[other], result[index]];
      return result;
    });
    setDirty(true);
    setNotice("");
  }
  function addLine(kind: "FREE" | "TITLE") {
    const row: BillingDocumentLine = {
      id: crypto.randomUUID(),
      origin: kind,
      sourceLineId: null,
      description: kind === "TITLE" ? "Nouveau titre" : "Prestation complémentaire",
      quantity: kind === "TITLE" ? 0 : 1,
      unit: kind === "TITLE" ? "" : "u",
      unitPriceCents: 0,
      vatRatePercent: kind === "TITLE" ? 0 : (rates[0] ?? 20),
    };
    setRows((old) => [...old, editable(row)]);
    setDirty(true);
    setNotice("");
  }
  function duplicate(row: EditableRow, index: number) {
    if (row.origin === "TITLE") return;
    const copy: EditableRow = {
      ...row,
      id: crypto.randomUUID(),
      origin: "FREE",
      sourceLineId: null,
      description: `${row.description} (copie)`,
    };
    setRows((old) => [...old.slice(0, index + 1), copy, ...old.slice(index + 1)]);
    setDirty(true);
    setNotice("");
  }
  function remove(id: string) {
    setRows((old) => old.filter((row) => row.id !== id));
    setDirty(true);
    setNotice("");
  }
  function applyProgress() {
    if (!draft || !payload || draft.type !== "PROGRESS" || !draft.lines?.length) return;
    const percentages = draft.lines.map((line) => ({
      lineId: line.lineId,
      percent: Number((progressValues[line.lineId] ?? "").replace(",", ".")),
    }));
    if (percentages.some((row) => !Number.isFinite(row.percent) ||
      row.percent < 0 || row.percent > 100)) {
      setError("L'avancement de chaque ligne doit être compris entre 0 et 100 %.");
      return;
    }
    if (dirty && !window.confirm(
      "Recalculer les lignes du devis ? Les lignes ajoutées restent, mais les prix modifiés sur les lignes du devis seront recalculés."
    )) return;
    try {
      const index = payload.drafts.findIndex((row) => row.id === draft.id);
      const previous = { schemaVersion: 1 as const, drafts: payload.drafts.slice(0, index) };
      const result = calculateLineProgress(previous, draft, percentages);
      const recalculated: BillingDraft = {
        ...draft, lineProgress: result.lineProgress, cumulativePercent: null,
        amountHtCents: result.amountHtCents, taxGroups: result.tax.groups,
        vatCents: result.tax.vatCents, totalTtcCents: result.tax.ttcCents,
      };
      const custom = rows.filter((row) => row.origin !== "QUOTE");
      setRows([...buildInvoiceDocumentLines(recalculated, previous).map(editable), ...custom]);
      setPendingPercentages(percentages);
      setDirty(true); setError(""); setNotice("");
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(serverErrors[code] ?? code ?? "Avancement invalide");
    }
  }
  function goBack() {
    if (dirty && !window.confirm("Des modifications ne sont pas enregistrées. Quitter ?")) return;
    router.push(
      draft?.chantierId
        ? `/facturation?chantierId=${encodeURIComponent(draft.chantierId)}`
        : `/facturation?quoteId=${encodeURIComponent(draft?.quoteId ?? "")}`,
    );
  }
  async function save() {
    if (!draft || !canWrite || busy) return;
    setError("");
    setNotice("");
    if (!label.trim() || invalid || !preview || !parsedRows.length) {
      setError("Renseigne les désignations, quantités et prix de chaque ligne.");
      return;
    }
    const previous = draft.amountHtCents;
    const exceeds = preview.amountHtCents > draft.contractHtCents;
    if (exceeds) {
      setError("Ce projet dépasse le devis retenu. Crée un devis complémentaire validé.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/desktop/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_DOCUMENT",
          draftId: draft.id,
          expectedUpdatedAt: draft.updatedAt,
          label: label.trim(),
          notes,
          documentLines: parsedRows,
          ...(pendingPercentages ? { linePercentages: pendingPercentages } : {}),
        }),
      });
      const json = (await response.json()) as ApiSnapshot;
      if (!response.ok) throw new Error(json.error ?? "Enregistrement impossible");
      const saved = json.payload.drafts.find((item) => item.id === draft.id);
      if (!saved) throw new Error("Projet introuvable après enregistrement");
      setDraft(saved);
      setPayload(json.payload);
      setPendingPercentages(null);
      setProgressValues(Object.fromEntries((saved.lines ?? []).map((line) =>
        [line.lineId, decimal(saved.lineProgress?.find((row) => row.lineId === line.lineId)?.percent
          ?? saved.cumulativePercent ?? 0)],
      )));
      const original = (saved.documentLines ?? []).map(editable);
      setRows(original);
      setInitialRows(original);
      setDirty(false);
      setNotice(
        preview.amountHtCents !== previous
          ? "Projet enregistré et totaux recalculés. Aucune facture officielle émise."
          : "Modifications enregistrées. Aucune facture officielle émise.",
      );
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(serverErrors[code] ?? code ?? "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="invoiceLoading">Chargement du projet de facture…</main>;
  if (!draft)
    return (
      <main className="invoiceLoading" role="alert">
        {error || "Facture introuvable."}
      </main>
    );

  return (
    <div className="invoiceEditor">
      <header className="invoiceHeading">
        <div className="invoiceIdentity">
          <button type="button" className="secondaryButton" onClick={goBack}>
            <ArrowLeft size={15} /> Retour aux projets
          </button>
          <span className="invoiceTag">PROJET · NON ÉMIS</span>
          <h1>
            <FileText size={25} /> {labels[draft.type]}
          </h1>
          <p>
            {draft.affairName} · {draft.clientName}
          </p>
          <div className="invoiceReferences">
            <Link href={`/devis/${draft.quoteId}`}>Devis source : {draft.quoteLabel}</Link>
            {draft.chantierId && (
              <Link href={`/chantiers/${draft.chantierId}`}>Ouvrir le chantier</Link>
            )}
          </div>
        </div>
        <div className="invoiceHeadingActions">
          {dirty && <span className="invoiceModified">Modifications non enregistrées</span>}
          <button
            type="button"
            className="primaryButton"
            disabled={!canWrite || busy || !dirty}
            onClick={() => void save()}
          >
            <Save size={16} /> {busy ? "Enregistrement…" : "Enregistrer le projet"}
          </button>
        </div>
      </header>

      <aside className="invoiceDraftNotice">
        Tu modifies une <strong>copie des lignes du devis</strong>, uniquement pour cette facture.
        Le devis signé reste inchangé. Ce projet n&apos;a ni numéro officiel, ni PDF émis, ni envoi
        Pennylane.
      </aside>
      {error && (
        <p className="invoiceError" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="invoiceSuccess" role="status">
          {notice}
        </p>
      )}
      {!canWrite && (
        <p className="invoiceError">Lecture seule : droit Facturation en écriture requis.</p>
      )}

      <section className="invoiceCard">
        <h2>Informations de la facture</h2>
        <div className="invoiceMeta">
          <label>
            Libellé du projet
            <input
              value={label}
              disabled={!canWrite}
              maxLength={240}
              onChange={(e) => {
                setLabel(e.target.value);
                setDirty(true);
              }}
            />
          </label>
          <label>
            Observations / conditions
            <textarea
              rows={2}
              value={notes}
              disabled={!canWrite}
              maxLength={4000}
              onChange={(e) => {
                setNotes(e.target.value);
                setDirty(true);
              }}
            />
          </label>
        </div>
      </section>

      <section className="invoiceCard invoiceLines">
        <div className="invoiceCardHeader">
          <div>
            <h2>Détail des prestations</h2>
            <p>Modifie les lignes puis enregistre pour recalculer la facture.</p>
          </div>
          <div className="invoiceToolbar">
            <button
              className="secondaryButton"
              type="button"
              disabled={!canWrite || busy}
              onClick={() => addLine("TITLE")}
            >
              <Plus size={15} /> Titre
            </button>
            <button
              className="primaryButton"
              type="button"
              disabled={!canWrite || busy || rows.length >= 1000}
              onClick={() => addLine("FREE")}
            >
              <Plus size={15} /> Ajouter une ligne
            </button>
          </div>
        </div>
        <div className="invoiceScroll">
          <table className="invoiceTable">
            <thead>
              <tr>
                <th>N°</th>
                <th>Désignation</th>
                <th>Qté</th>
                <th>Unité</th>
                <th>Prix unit. HT</th>
                <th>TVA</th>
                <th>Total HT</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const current = parsedRows[index];
                const amount = current
                  ? Math.round(current.quantity * current.unitPriceCents)
                  : NaN;
                return (
                  <tr key={row.id} className={row.origin === "TITLE" ? "invoiceTitleRow" : ""}>
                    <td className="invoiceIndex">{index + 1}</td>
                    <td className="invoiceDescription">
                      <input
                        aria-label={`Désignation ligne ${index + 1}`}
                        disabled={!canWrite}
                        value={row.description}
                        onChange={(e) => alter(row.id, { description: e.target.value })}
                      />
                      {row.origin !== "TITLE" && (
                        <small>
                          {row.origin === "QUOTE"
                            ? "Issu du devis"
                            : "Ligne ajoutée à cette facture"}
                        </small>
                      )}
                    </td>
                    {row.origin === "TITLE" ? (
                      <td colSpan={5} className="invoiceTitleHint">
                        Titre libre, sans montant facturé
                      </td>
                    ) : (
                      <>
                        <td>
                          <input
                            aria-label={`Quantité ligne ${index + 1}`}
                            inputMode="decimal"
                            disabled={!canWrite}
                            value={row.quantityInput}
                            onChange={(e) => alter(row.id, { quantityInput: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Unité ligne ${index + 1}`}
                            disabled={!canWrite}
                            maxLength={40}
                            value={row.unit}
                            onChange={(e) => alter(row.id, { unit: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Prix unitaire HT ligne ${index + 1}`}
                            inputMode="decimal"
                            disabled={!canWrite}
                            value={row.priceInput}
                            onChange={(e) => alter(row.id, { priceInput: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            aria-label={`TVA ligne ${index + 1}`}
                            disabled={!canWrite}
                            value={row.vatRatePercent}
                            onChange={(e) =>
                              alter(row.id, { vatRatePercent: Number(e.target.value) })
                            }
                          >
                            {rates.map((rate) => (
                              <option key={rate} value={rate}>
                                {rate} %
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="invoiceLineSum">
                          {Number.isSafeInteger(amount) ? currency(amount) : "À vérifier"}
                        </td>
                      </>
                    )}
                    <td className="invoiceRowTools">
                      {canWrite && (
                        <>
                          <button
                            title="Monter"
                            aria-label={`Monter ligne ${index + 1}`}
                            disabled={index === 0}
                            onClick={() => reorder(index, -1)}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            title="Descendre"
                            aria-label={`Descendre ligne ${index + 1}`}
                            disabled={index === rows.length - 1}
                            onClick={() => reorder(index, 1)}
                          >
                            <ArrowDown size={14} />
                          </button>
                          {row.origin !== "TITLE" && (
                            <button
                              title="Dupliquer"
                              aria-label={`Dupliquer ligne ${index + 1}`}
                              onClick={() => duplicate(row, index)}
                            >
                              <Copy size={14} />
                            </button>
                          )}
                          <button
                            title="Supprimer"
                            aria-label={`Supprimer ligne ${index + 1}`}
                            onClick={() => remove(row.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {draft.type === "PROGRESS" && draft.lines?.length ? (
          <details className="invoiceProgress" open>
            <summary>Avancement cumulé par ligne du devis</summary>
            <p>Tu peux corriger les pourcentages de cette situation.
              Recalcule les lignes puis enregistre le projet. Les avancements antérieurs restent protégés.</p>
            <div className="invoiceScroll">
              <table className="invoiceTable">
                <thead><tr><th>Prestation du devis</th><th>Avancement cumulé (%)</th></tr></thead>
                <tbody>{draft.lines.map((line) => (
                  <tr key={line.lineId}>
                    <td>{line.description}</td>
                    <td><input aria-label={`Avancement cumulé de ${line.description}`}
                      inputMode="decimal" disabled={!canWrite || busy}
                      value={progressValues[line.lineId] ?? "0"}
                      onChange={(event) => setProgressValues((old) => ({
                        ...old, [line.lineId]: event.target.value,
                      }))} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <button type="button" className="secondaryButton"
              disabled={!canWrite || busy} onClick={applyProgress}>
              Recalculer les lignes depuis les pourcentages
            </button>
            {pendingPercentages && <p>Avancements recalculés, enregistrement nécessaire.</p>}
          </details>
        ) : null}
        <p className="invoiceHint">
          Les lignes libres sont intégrées au plafond du devis retenu. Pour facturer des travaux
          supplémentaires dépassant le contrat, crée et fais valider un devis complémentaire.
        </p>
      </section>

      <section className="invoiceCard invoiceSummary">
        <h2>Synthèse du projet</h2>
        <div className="invoiceTotals">
          <div>
            <span>Montant HT</span>
            <strong>{preview ? currency(preview.amountHtCents) : "À vérifier"}</strong>
          </div>
          <div>
            <span>TVA</span>
            <strong>{preview ? currency(preview.vatCents) : "À vérifier"}</strong>
          </div>
          <div className="invoiceTtc">
            <span>Total TTC</span>
            <strong>{preview ? currency(preview.totalTtcCents) : "À vérifier"}</strong>
          </div>
        </div>
        <div className="invoiceTotals invoiceComparison">
          <div>
            <span>Contrat retenu HT</span>
            <strong>{currency(draft.contractHtCents)}</strong>
          </div>
          <div>
            <span>Montant initial du projet HT</span>
            <strong>{currency(draft.amountHtCents)}</strong>
          </div>
        </div>
        <div className="invoiceFooterActions">
          <button
            className="secondaryButton"
            type="button"
            onClick={() => {
              if (dirty && !window.confirm("Abandonner les modifications non enregistrées ?"))
                return;
              setRows(initialRows.map((row) => ({ ...row })));
              setLabel(draft.label);
              setNotes(draft.notes);
              setDirty(false);
              setError("");
            }}
          >
            Annuler les modifications
          </button>
          <button
            className="primaryButton"
            type="button"
            disabled={!canWrite || busy || !dirty || !preview}
            onClick={() => void save()}
          >
            <Save size={16} /> Enregistrer le projet
          </button>
        </div>
      </section>
      <style jsx>{`
        .invoiceEditor {
          padding: 18px 22px 32px;
          max-width: 1500px;
          margin: auto;
          display: grid;
          gap: 16px;
          color: #302b3a;
        }
        .invoiceHeading {
          display: flex;
          justify-content: space-between;
          gap: 20px;
          align-items: flex-start;
          flex-wrap: wrap;
        }
        .invoiceIdentity {
          display: grid;
          gap: 9px;
        }
        .invoiceIdentity h1 {
          display: flex;
          align-items: center;
          gap: 9px;
          margin: 2px 0 0;
          font-size: 25px;
        }
        .invoiceIdentity p {
          font-size: 13px;
          color: #726c7d;
          margin: 0;
        }
        .invoiceReferences {
          display: flex;
          gap: 16px;
          font-size: 12px;
        }
        .invoiceReferences :global(a) {
          color: #5740a4;
          text-decoration: underline;
        }
        .invoiceHeadingActions {
          display: flex;
          gap: 13px;
          align-items: center;
          flex-wrap: wrap;
        }
        .invoiceTag {
          background: #fff5d9;
          color: #735000;
          font-size: 11px;
          font-weight: 700;
          border-radius: 6px;
          padding: 5px 8px;
          width: fit-content;
        }
        .invoiceModified {
          color: #8b6113;
          font-size: 12px;
        }
        .invoiceDraftNotice {
          background: #fff8e9;
          padding: 13px;
          border: 1px solid #ead9b0;
          border-radius: 8px;
          font-size: 12px;
        }
        .invoiceError,
        .invoiceSuccess {
          padding: 12px 14px;
          border-radius: 8px;
          font-size: 13px;
          margin: 0;
        }
        .invoiceError {
          background: #fff0f0;
          color: #9e2727;
        }
        .invoiceSuccess {
          background: #edf8ed;
          color: #286d41;
        }
        .invoiceCard {
          background: white;
          border: 1px solid #e5e1eb;
          border-radius: 12px;
          padding: 18px;
          display: grid;
          gap: 13px;
          min-width: 0;
        }
        .invoiceCard h2 {
          margin: 0;
          font-size: 18px;
        }
        .invoiceMeta {
          display: grid;
          grid-template-columns: 1fr 1.6fr;
          gap: 16px;
        }
        .invoiceMeta label {
          display: grid;
          gap: 6px;
          font-size: 12px;
          font-weight: 600;
        }
        .invoiceMeta input,
        .invoiceMeta textarea {
          border: 1px solid #ded9e5;
          border-radius: 7px;
          padding: 10px;
          width: 100%;
          background: #fff;
          color: #2b2735;
        }
        .invoiceCardHeader {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 15px;
          flex-wrap: wrap;
        }
        .invoiceCardHeader p {
          color: #716b79;
          font-size: 12px;
          margin: 4px 0;
        }
        .invoiceToolbar {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .invoiceScroll {
          max-width: 100%;
          overflow-x: auto;
        }
        .invoiceTable {
          border-collapse: collapse;
          width: 100%;
          min-width: 970px;
          font-size: 12px;
        }
        .invoiceTable th {
          text-align: left;
          color: #5c5666;
          font-weight: 600;
          font-size: 11px;
          background: #f7f5f9;
          padding: 10px 7px;
          border-bottom: 1px solid #e7e2ea;
        }
        .invoiceTable td {
          border-bottom: 1px solid #efecf2;
          vertical-align: top;
          padding: 7px;
        }
        .invoiceTable input,
        .invoiceTable select {
          width: 100%;
          min-width: 67px;
          border: 1px solid #dcd8e2;
          border-radius: 6px;
          background: #fff;
          padding: 8px;
          color: #292532;
        }
        .invoiceIndex {
          width: 35px;
          color: #9e96a4;
          padding-top: 15px !important;
        }
        .invoiceDescription {
          min-width: 280px;
        }
        .invoiceDescription small {
          display: block;
          color: #77717e;
          margin-top: 4px;
          font-size: 10px;
        }
        .invoiceLineSum {
          text-align: right;
          white-space: nowrap;
          font-weight: 650;
          padding-top: 16px !important;
        }
        .invoiceTitleRow {
          background: #f5f1f9;
        }
        .invoiceTitleRow input {
          font-weight: 700;
        }
        .invoiceTitleHint {
          color: #8a8390;
          padding-top: 15px !important;
        }
        .invoiceRowTools {
          white-space: nowrap;
        }
        .invoiceRowTools button {
          background: transparent;
          border: 1px solid #e6e1e9;
          border-radius: 6px;
          margin: 1px;
          padding: 5px;
          cursor: pointer;
        }
        .invoiceRowTools button:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .invoiceProgress {
          border-top: 1px solid #eee;
          padding-top: 12px;
          font-size: 12px;
        }
        .invoiceProgress summary {
          cursor: pointer;
          font-weight: 600;
        }
        .invoiceHint {
          margin: 0;
          color: #766b7b;
          font-size: 12px;
        }
        .invoiceTotals {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .invoiceTotals > div {
          display: grid;
          gap: 8px;
          padding: 12px;
          background: #f8f6fa;
          border-radius: 8px;
        }
        .invoiceTotals span {
          font-size: 11px;
          color: #746b7b;
        }
        .invoiceTotals strong {
          font-size: 18px;
        }
        .invoiceTtc {
          background: #eee7f9 !important;
          color: #392969;
        }
        .invoiceComparison {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .invoiceComparison strong {
          font-size: 14px;
        }
        .invoiceFooterActions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }
        .invoiceEditor :global(.primaryButton),
        .invoiceEditor :global(.secondaryButton) {
          display: inline-flex;
          gap: 7px;
          align-items: center;
        }
        @media (max-width: 750px) {
          .invoiceEditor {
            padding: 12px;
          }
          .invoiceMeta,
          .invoiceTotals {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

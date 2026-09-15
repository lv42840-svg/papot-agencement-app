"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { LibraryBig, Pencil, Plus, X } from "lucide-react";
import type { QuoteLine } from "@/lib/quotes/model";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type QuotesApiResponse = {
  payload?: NativeQuotesPayload;
  error?: string;
};

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function eurosToCents(value: string): number {
  const euros = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(euros) || euros < 0) throw new Error("PRICE_INVALID");
  const cents = Math.round(euros * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("PRICE_INVALID");
  return cents;
}

function lineErrorLabel(code: string): string {
  if (code === "QUOTE_NOT_FOUND") return "Ce devis n’existe plus.";
  if (code === "QUOTE_NOT_EDITABLE") return "Seul un brouillon peut être modifié.";
  if (code === "QUOTE_LINE_NOT_FOUND") return "Cette ligne n’existe plus.";
  if (code === "LIBRARY_LOCKED") return "La Bibliothèque est modifiée depuis un autre poste.";
  if (code === "LIBRARY_VERSION_CONFLICT") {
    return "La Bibliothèque a changé pendant l’enregistrement. Recommence l’ajout.";
  }
  if (code === "LIBRARY_COMPONENT_UNIT_REQUIRED") {
    return "Une unité est obligatoire pour enregistrer ce composant dans la Bibliothèque.";
  }
  if (
    code === "LIBRARY_COMPONENT_PRICING_INVALID" ||
    code === "LIBRARY_COMPONENT_MARGIN_UNDEFINED"
  ) {
    return "Pour la Bibliothèque, le coût doit être cohérent avec le prix de vente.";
  }
  if (code === "QUOTES_REQUEST_INVALID") return "Vérifie les informations de la ligne.";
  return "La ligne n’a pas pu être enregistrée.";
}

export function QuoteLinesEditor({
  quote,
  canWrite,
  onSaved,
  headerActions,
}: {
  quote: NativeQuoteRecord | null;
  canWrite: boolean;
  onSaved: (payload: NativeQuotesPayload) => void;
  headerActions?: ReactNode;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("u");
  const [quantityInput, setQuantityInput] = useState("1");
  const [unitPriceEuros, setUnitPriceEuros] = useState("0,00");
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [libraryName, setLibraryName] = useState("");
  const [libraryCostEuros, setLibraryCostEuros] = useState("0,00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const lines = useMemo(
    () => quote?.model.items.filter((item): item is QuoteLine => item.kind === "LINE") ?? [],
    [quote],
  );
  const editable = canWrite && quote?.status === "DRAFT";
  const editingLine = editingLineId
    ? (lines.find((line) => line.id === editingLineId) ?? null)
    : null;
  const canAddCurrentLineToLibrary = !editingLine?.librarySource;

  useEffect(() => {
    setFormOpen(false);
    setEditingLineId(null);
    setError("");
  }, [quote?.id]);

  function resetForm() {
    setEditingLineId(null);
    setDescription("");
    setUnit("u");
    setQuantityInput("1");
    setUnitPriceEuros("0,00");
    setSaveToLibrary(false);
    setLibraryName("");
    setLibraryCostEuros("0,00");
    setError("");
  }

  function openNewLine() {
    resetForm();
    setFormOpen(true);
  }

  function openEditLine(line: QuoteLine) {
    setEditingLineId(line.id);
    setDescription(line.description);
    setUnit(line.unit);
    setQuantityInput(line.quantityFormula ?? String(line.quantity).replace(".", ","));
    setUnitPriceEuros(centsToInput(line.unitPriceCents ?? 0));
    setSaveToLibrary(false);
    setLibraryName(line.description.slice(0, 240));
    setLibraryCostEuros("0,00");
    setError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    resetForm();
  }

  async function saveLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quote) return;
    setSaving(true);
    setError("");

    try {
      const unitPriceCents = eurosToCents(unitPriceEuros);
      const libraryCostPriceCents = saveToLibrary ? eurosToCents(libraryCostEuros) : undefined;
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsertLine",
          quoteId: quote.id,
          lineId: editingLineId ?? undefined,
          description,
          unit,
          quantityInput,
          unitPriceCents,
          saveToLibrary: saveToLibrary && canAddCurrentLineToLibrary,
          libraryName:
            saveToLibrary && canAddCurrentLineToLibrary ? libraryName || description : undefined,
          libraryCostPriceCents:
            saveToLibrary && canAddCurrentLineToLibrary ? libraryCostPriceCents : undefined,
        }),
      });
      const data = (await response.json()) as QuotesApiResponse;
      if (!response.ok || !data.payload) {
        setError(lineErrorLabel(data.error ?? "QUOTES_MUTATION_FAILED"));
        return;
      }

      onSaved(data.payload);
      closeForm();
    } catch {
      setError("Vérifie les prix saisis sur la ligne.");
    } finally {
      setSaving(false);
    }
  }

  if (!quote) {
    return (
      <section className="panel quoteLinesEmpty">
        <strong>Sélectionne un devis pour ouvrir son contenu.</strong>
        <span>Les lignes du brouillon apparaîtront ici.</span>
        <style jsx>{`
          .quoteLinesEmpty {
            min-height: 120px;
            display: grid;
            place-items: center;
            align-content: center;
            gap: 5px;
            color: var(--muted);
            text-align: center;
          }
          .quoteLinesEmpty strong {
            color: var(--text);
          }
        `}</style>
      </section>
    );
  }

  return (
    <section
      className="panel quoteLinesPanel"
      aria-label={`Contenu du devis ${quote.model.subject}`}
    >
      <div className="panelHeader quoteLinesHeader">
        <div>
          <p className="eyebrow">Devis</p>
          <h2>{quote.model.subject}</h2>
          <p className="muted">
            {quote.variantName} · V{quote.version} · {lines.length} ligne
            {lines.length === 1 ? "" : "s"} dans ce brouillon
          </p>
        </div>
        <div className="quoteLinesHeaderActions">
          {headerActions}
          {editable ? (
            <button type="button" className="primaryButton" onClick={openNewLine} disabled={saving}>
              <Plus size={16} aria-hidden="true" />
              Ajouter une ligne
            </button>
          ) : null}
        </div>
      </div>

      {formOpen && editable ? (
        <form className="quoteLineForm" onSubmit={saveLine}>
          <div className="quoteLineFormHeader">
            <div>
              <p className="eyebrow">{editingLineId ? "Modifier" : "Nouvelle ligne"}</p>
              <h3>{editingLineId ? "Modifier la ligne" : "Ajouter au devis"}</h3>
            </div>
            <button type="button" className="iconButton" onClick={closeForm} aria-label="Fermer">
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="quoteLineGrid">
            <label className="quoteLineField quoteLineFieldWide">
              <span>Désignation</span>
              <textarea
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (!libraryName || libraryName === description.slice(0, 240)) {
                    setLibraryName(event.target.value.slice(0, 240));
                  }
                }}
                rows={2}
                maxLength={4000}
                required
              />
            </label>

            <label className="quoteLineField">
              <span>Quantité / formule</span>
              <input
                value={quantityInput}
                onChange={(event) => setQuantityInput(event.target.value)}
                placeholder="1 ou 2+6+4+9"
                required
              />
            </label>

            <label className="quoteLineField">
              <span>Unité</span>
              <input
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                maxLength={40}
              />
            </label>

            <label className="quoteLineField">
              <span>Prix de vente unitaire HT</span>
              <input
                inputMode="decimal"
                value={unitPriceEuros}
                onChange={(event) => setUnitPriceEuros(event.target.value)}
                required
              />
            </label>
          </div>

          {canAddCurrentLineToLibrary ? (
            <div className={`quoteLibraryOption${saveToLibrary ? " isOpen" : ""}`}>
              <label className="quoteLibraryToggle">
                <input
                  type="checkbox"
                  checked={saveToLibrary}
                  onChange={(event) => {
                    setSaveToLibrary(event.target.checked);
                    if (event.target.checked && !libraryName) {
                      setLibraryName(description.slice(0, 240));
                    }
                  }}
                />
                <LibraryBig size={17} aria-hidden="true" />
                <span>
                  <strong>Ajouter aussi à la Bibliothèque</strong>
                  <small>
                    La ligne deviendra un composant réutilisable dans les prochains devis.
                  </small>
                </span>
              </label>

              {saveToLibrary ? (
                <div className="quoteLibraryFields">
                  <label className="quoteLineField">
                    <span>Nom dans la Bibliothèque</span>
                    <input
                      value={libraryName}
                      onChange={(event) => setLibraryName(event.target.value)}
                      maxLength={240}
                      required
                    />
                  </label>
                  <label className="quoteLineField">
                    <span>Coût / prix d’achat HT</span>
                    <input
                      inputMode="decimal"
                      value={libraryCostEuros}
                      onChange={(event) => setLibraryCostEuros(event.target.value)}
                      required
                    />
                  </label>
                  <p>
                    Le prix de vente vient de la ligne du devis. PAPOT calcule automatiquement la
                    marge du composant.
                  </p>
                </div>
              ) : null}
            </div>
          ) : editingLine?.librarySource ? (
            <div className="quoteLibraryLinked">
              <LibraryBig size={16} aria-hidden="true" />
              Cette ligne est déjà liée à un composant de la Bibliothèque.
            </div>
          ) : null}

          {error ? <div className="quoteLineError">{error}</div> : null}

          <div className="quoteLineActions">
            <button type="button" className="secondaryButton" onClick={closeForm} disabled={saving}>
              Annuler
            </button>
            <button type="submit" className="primaryButton" disabled={saving}>
              {saving ? "Enregistrement…" : editingLineId ? "Enregistrer" : "Ajouter la ligne"}
            </button>
          </div>
        </form>
      ) : null}

      {lines.length === 0 ? (
        <div className="quoteLinesNoData">
          <strong>Le devis est vide.</strong>
          <span>Ajoute sa première ligne libre, puis construis-le progressivement.</span>
        </div>
      ) : (
        <div className="quoteLinesTable">
          <div className="quoteLinesTableHeader">
            <span>Désignation</span>
            <span>Qté</span>
            <span>Unité</span>
            <span>PU HT</span>
            <span />
          </div>
          {lines.map((line) => (
            <div className="quoteLineRow" key={line.id}>
              <div className="quoteLineDescription">
                <strong>{line.description}</strong>
                {line.librarySource ? (
                  <span className="quoteLibraryBadge">
                    <LibraryBig size={12} aria-hidden="true" /> Bibliothèque
                  </span>
                ) : null}
              </div>
              <span>{line.quantityFormula ?? line.quantity}</span>
              <span>{line.unit || "—"}</span>
              <span>{formatMoney(line.unitPriceCents ?? 0)}</span>
              <span>
                {editable ? (
                  <button
                    type="button"
                    className="iconButton"
                    onClick={() => openEditLine(line)}
                    aria-label={`Modifier ${line.description}`}
                    title="Modifier"
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .quoteLinesPanel {
          overflow: hidden;
        }
        .quoteLinesHeader,
        .quoteLinesHeaderActions,
        .quoteLineFormHeader,
        .quoteLineActions,
        .quoteLibraryToggle,
        .quoteLibraryLinked,
        .quoteLibraryBadge {
          display: flex;
          align-items: center;
        }
        .quoteLinesHeader,
        .quoteLineFormHeader {
          justify-content: space-between;
          gap: 16px;
        }
        .quoteLinesHeaderActions {
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }
        .quoteLinesHeader :global(.primaryButton),
        .quoteLineActions :global(button) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
        }
        .quoteLinesHeader p,
        .quoteLinesHeader h2,
        .quoteLineFormHeader p,
        .quoteLineFormHeader h3 {
          margin-bottom: 0;
        }
        .quoteLineForm {
          margin: 0 18px 18px;
          padding: 16px;
          display: grid;
          gap: 15px;
          border: 1px solid #ddd6f0;
          border-radius: 10px;
          background: #fcfbff;
        }
        .quoteLineGrid,
        .quoteLibraryFields {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 11px;
        }
        .quoteLineField {
          display: grid;
          gap: 6px;
        }
        .quoteLineFieldWide {
          grid-column: 1 / -1;
        }
        .quoteLineField span {
          font-size: 11px;
          font-weight: 800;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .quoteLineField input,
        .quoteLineField textarea {
          width: 100%;
          border: 1px solid var(--border);
          border-radius: 7px;
          background: #fff;
        }
        .quoteLineField textarea {
          resize: vertical;
        }
        .quoteLibraryOption {
          padding: 12px;
          border: 1px solid var(--border);
          border-radius: 9px;
          background: #fff;
        }
        .quoteLibraryOption.isOpen {
          border-color: #cec4ea;
          background: #faf8ff;
        }
        .quoteLibraryToggle {
          gap: 9px;
          cursor: pointer;
        }
        .quoteLibraryToggle > :global(svg) {
          color: var(--accent);
          flex: 0 0 auto;
        }
        .quoteLibraryToggle span,
        .quoteLibraryToggle strong,
        .quoteLibraryToggle small {
          display: block;
        }
        .quoteLibraryToggle small {
          margin-top: 2px;
          color: var(--muted);
          font-size: 11px;
        }
        .quoteLibraryFields {
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border);
        }
        .quoteLibraryFields p {
          grid-column: 1 / -1;
          margin: 0;
          color: var(--muted);
          font-size: 11px;
        }
        .quoteLibraryLinked {
          gap: 7px;
          padding: 10px 12px;
          border-radius: 8px;
          background: #f3f0fb;
          color: #6554b5;
          font-size: 12px;
          font-weight: 700;
        }
        .quoteLineError {
          padding: 9px 11px;
          border-radius: 7px;
          background: #fff0f0;
          color: #9c3434;
          font-size: 12px;
          font-weight: 700;
        }
        .quoteLineActions {
          justify-content: flex-end;
          gap: 9px;
        }
        .quoteLinesNoData {
          min-height: 130px;
          display: grid;
          place-items: center;
          align-content: center;
          gap: 5px;
          color: var(--muted);
          text-align: center;
        }
        .quoteLinesNoData strong {
          color: var(--text);
        }
        .quoteLinesTable {
          border-top: 1px solid var(--border);
        }
        .quoteLinesTableHeader,
        .quoteLineRow {
          display: grid;
          grid-template-columns: minmax(260px, 1fr) 110px 80px 120px 42px;
          gap: 10px;
          align-items: center;
          padding: 10px 18px;
        }
        .quoteLinesTableHeader {
          min-height: 38px;
          background: var(--surface-soft);
          color: var(--muted);
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .quoteLineRow {
          min-height: 58px;
          border-top: 1px solid var(--border);
          font-size: 12px;
        }
        .quoteLineDescription {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .quoteLineDescription strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .quoteLibraryBadge {
          flex: 0 0 auto;
          gap: 4px;
          padding: 3px 6px;
          border-radius: 999px;
          background: #f0ecfb;
          color: #6554b5;
          font-size: 9px;
          font-weight: 800;
        }
        @media (max-width: 900px) {
          .quoteLineGrid,
          .quoteLibraryFields {
            grid-template-columns: 1fr;
          }
          .quoteLineFieldWide,
          .quoteLibraryFields p {
            grid-column: auto;
          }
          .quoteLinesTable {
            overflow-x: auto;
          }
          .quoteLinesTableHeader,
          .quoteLineRow {
            min-width: 700px;
          }
        }
      `}</style>
    </section>
  );
}

"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  LockKeyhole,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { parseQuoteQuantityInput } from "@/lib/quotes/domain";
import {
  calculateQuoteOuvrageMarginPercent,
  calculateQuoteOuvrageUnitCostCents,
  quoteOuvrageComponentCostPriceCents,
  type QuoteLine,
} from "@/lib/quotes/model";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type QuotesApiResponse = {
  payload?: NativeQuotesPayload;
  error?: string;
};

type OuvrageComponentForm = {
  key: string;
  id?: string;
  description: string;
  unit: string;
  quantityInput: string;
  costPriceEuros: string;
  unitPriceEuros: string;
};

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function formatPercent(value: number | null): string {
  return value === null ? "n/c" : `${percentFormatter.format(value)} %`;
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

function optionalEurosToCents(value: string): number | undefined {
  if (!value.trim()) return undefined;
  return eurosToCents(value);
}

function newComponentForm(): OuvrageComponentForm {
  return {
    key: globalThis.crypto.randomUUID(),
    description: "",
    unit: "u",
    quantityInput: "1",
    costPriceEuros: "",
    unitPriceEuros: "0,00",
  };
}

function formsFromLine(line: QuoteLine): OuvrageComponentForm[] {
  const lineComponents = line.components ?? [];
  if (lineComponents.length > 0) {
    return lineComponents.map((component) => {
      const costPriceCents = quoteOuvrageComponentCostPriceCents(component);
      return {
        key: component.id,
        id: component.id,
        description: component.description,
        unit: component.unit,
        quantityInput: component.quantityFormula ?? String(component.quantity).replace(".", ","),
        costPriceEuros: costPriceCents === null ? "" : centsToInput(costPriceCents),
        unitPriceEuros: centsToInput(component.unitPriceCents),
      };
    });
  }

  return [
    {
      key: `legacy-${line.id}`,
      description: line.description,
      unit: line.unit || "u",
      quantityInput: "1",
      costPriceEuros: "",
      unitPriceEuros: centsToInput(line.unitPriceCents ?? 0),
    },
  ];
}

function componentTotalCents(component: OuvrageComponentForm): number | null {
  try {
    const quantity = parseQuoteQuantityInput(component.quantityInput).quantity;
    const total = Math.round(quantity * eurosToCents(component.unitPriceEuros));
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}

function componentCostTotalCents(component: OuvrageComponentForm): number | null {
  try {
    const costPriceCents = optionalEurosToCents(component.costPriceEuros);
    if (costPriceCents === undefined) return null;
    const quantity = parseQuoteQuantityInput(component.quantityInput).quantity;
    const total = Math.round(quantity * costPriceCents);
    return Number.isSafeInteger(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}

function ouvrageUnitPriceCents(components: OuvrageComponentForm[]): number | null {
  let total = 0;
  for (const component of components) {
    const componentTotal = componentTotalCents(component);
    if (componentTotal === null) return null;
    total += componentTotal;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function ouvrageUnitCostCents(components: OuvrageComponentForm[]): number | null {
  let total = 0;
  for (const component of components) {
    const componentTotal = componentCostTotalCents(component);
    if (componentTotal === null) return null;
    total += componentTotal;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function lineErrorLabel(code: string): string {
  if (code === "QUOTE_NOT_FOUND") return "Ce devis n’existe plus.";
  if (code === "QUOTE_NOT_EDITABLE") return "Seul un brouillon peut être modifié.";
  if (code === "QUOTE_LINE_NOT_FOUND") return "Cet ouvrage n’existe plus.";
  if (code === "QUOTES_REQUEST_INVALID") return "Vérifie l’ouvrage et ses composants.";
  return "L’ouvrage n’a pas pu être enregistré.";
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
  const [components, setComponents] = useState<OuvrageComponentForm[]>([newComponentForm()]);
  const [priceForced, setPriceForced] = useState(false);
  const [forcedUnitPriceEuros, setForcedUnitPriceEuros] = useState("0,00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [expandedLineIds, setExpandedLineIds] = useState<Set<string>>(new Set());

  const lines = useMemo(
    () => quote?.model.items.filter((item): item is QuoteLine => item.kind === "LINE") ?? [],
    [quote],
  );
  const editable = canWrite && quote?.status === "DRAFT";
  const calculatedUnitPrice = useMemo(() => ouvrageUnitPriceCents(components), [components]);
  const calculatedUnitCost = useMemo(() => ouvrageUnitCostCents(components), [components]);
  const forcedUnitPrice = useMemo(() => {
    if (!priceForced) return null;
    try {
      return eurosToCents(forcedUnitPriceEuros);
    } catch {
      return null;
    }
  }, [forcedUnitPriceEuros, priceForced]);
  const effectiveUnitPrice = priceForced ? forcedUnitPrice : calculatedUnitPrice;
  const currentMarginAmount =
    effectiveUnitPrice !== null && calculatedUnitCost !== null
      ? effectiveUnitPrice - calculatedUnitCost
      : null;
  const currentMarginPercent =
    effectiveUnitPrice === null
      ? null
      : calculateQuoteOuvrageMarginPercent(effectiveUnitPrice, calculatedUnitCost);

  useEffect(() => {
    setFormOpen(false);
    setEditingLineId(null);
    setError("");
    setExpandedLineIds(new Set());
  }, [quote?.id]);

  function resetForm() {
    setEditingLineId(null);
    setDescription("");
    setUnit("u");
    setQuantityInput("1");
    setComponents([newComponentForm()]);
    setPriceForced(false);
    setForcedUnitPriceEuros("0,00");
    setError("");
  }

  function openNewOuvrage() {
    resetForm();
    setFormOpen(true);
  }

  function openEditOuvrage(line: QuoteLine) {
    setEditingLineId(line.id);
    setDescription(line.description);
    setUnit(line.unit || "u");
    setQuantityInput(line.quantityFormula ?? String(line.quantity).replace(".", ","));
    setComponents(formsFromLine(line));
    setPriceForced(line.forcedUnitPriceCents !== undefined);
    setForcedUnitPriceEuros(centsToInput(line.forcedUnitPriceCents ?? line.unitPriceCents ?? 0));
    setError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    resetForm();
  }

  function updateComponent(index: number, patch: Partial<OuvrageComponentForm>) {
    setComponents((current) =>
      current.map((component, componentIndex) =>
        componentIndex === index ? { ...component, ...patch } : component,
      ),
    );
  }

  function addComponent() {
    setComponents((current) => [...current, newComponentForm()]);
  }

  function removeComponent(index: number) {
    setComponents((current) => {
      if (current.length <= 1) return current;
      return current.filter((_, componentIndex) => componentIndex !== index);
    });
  }

  function enableForcedPrice() {
    setForcedUnitPriceEuros(centsToInput(calculatedUnitPrice ?? 0));
    setPriceForced(true);
  }

  function resetForcedPrice() {
    setPriceForced(false);
    setForcedUnitPriceEuros(centsToInput(calculatedUnitPrice ?? 0));
  }

  function toggleLine(lineId: string) {
    setExpandedLineIds((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  async function saveOuvrage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quote) return;
    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/desktop/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsertOuvrage",
          quoteId: quote.id,
          lineId: editingLineId ?? undefined,
          description,
          unit,
          quantityInput,
          forcedUnitPriceCents: priceForced ? eurosToCents(forcedUnitPriceEuros) : null,
          components: components.map((component) => ({
            id: component.id,
            description: component.description,
            unit: component.unit,
            quantityInput: component.quantityInput,
            costPriceCents: optionalEurosToCents(component.costPriceEuros),
            unitPriceCents: eurosToCents(component.unitPriceEuros),
          })),
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
      setError("Vérifie les quantités et les prix des composants ou le prix forcé.");
    } finally {
      setSaving(false);
    }
  }

  if (!quote) {
    return (
      <section className="panel quoteLinesEmpty">
        <strong>Sélectionne un devis pour ouvrir son contenu.</strong>
        <span>Les ouvrages du brouillon apparaîtront ici.</span>
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
            {quote.variantName} · V{quote.version} · {lines.length} ouvrage
            {lines.length === 1 ? "" : "s"} dans ce brouillon
          </p>
        </div>
        <div className="quoteLinesHeaderActions">
          {headerActions}
          {editable ? (
            <button
              type="button"
              className="primaryButton"
              onClick={openNewOuvrage}
              disabled={saving}
            >
              <Plus size={16} aria-hidden="true" />
              Ajouter un ouvrage
            </button>
          ) : null}
        </div>
      </div>

      {formOpen && editable ? (
        <form className="quoteLineForm" onSubmit={saveOuvrage}>
          <div className="quoteLineFormHeader">
            <div>
              <p className="eyebrow">{editingLineId ? "Modifier" : "Nouvel ouvrage"}</p>
              <h3>{editingLineId ? "Modifier l’ouvrage" : "Ajouter un ouvrage au devis"}</h3>
            </div>
            <button type="button" className="iconButton" onClick={closeForm} aria-label="Fermer">
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="quoteLineGrid">
            <label className="quoteLineField quoteLineFieldWide">
              <span>Désignation de l’ouvrage</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                maxLength={4000}
                required
              />
            </label>

            <label className="quoteLineField">
              <span>Quantité ouvrage / formule</span>
              <input
                value={quantityInput}
                onChange={(event) => setQuantityInput(event.target.value)}
                placeholder="1 ou 2+3"
                required
              />
            </label>

            <label className="quoteLineField">
              <span>Unité ouvrage</span>
              <input
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                maxLength={40}
              />
            </label>
          </div>

          <div className="quoteComponentsEditor">
            <div className="quoteComponentsEditorHeader">
              <div>
                <p className="eyebrow">Composition</p>
                <h4>Composants de l’ouvrage</h4>
              </div>
              <button type="button" className="secondaryButton" onClick={addComponent}>
                <Plus size={14} aria-hidden="true" /> Ajouter un composant
              </button>
            </div>

            {components.map((component, index) => {
              const total = componentTotalCents(component);
              const costTotal = componentCostTotalCents(component);
              return (
                <div className="quoteComponentCard" key={component.key}>
                  <div className="quoteComponentCardHeader">
                    <strong>Composant {index + 1}</strong>
                    <button
                      type="button"
                      className="iconButton"
                      onClick={() => removeComponent(index)}
                      disabled={components.length === 1}
                      aria-label={`Supprimer le composant ${index + 1}`}
                      title="Supprimer le composant"
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>

                  <div className="quoteComponentGrid">
                    <label className="quoteLineField quoteLineFieldWide">
                      <span>Désignation du composant</span>
                      <input
                        value={component.description}
                        onChange={(event) =>
                          updateComponent(index, { description: event.target.value })
                        }
                        maxLength={4000}
                        required
                      />
                    </label>

                    <label className="quoteLineField">
                      <span>Quantité / formule</span>
                      <input
                        value={component.quantityInput}
                        onChange={(event) =>
                          updateComponent(index, { quantityInput: event.target.value })
                        }
                        placeholder="1 ou 2+3"
                        required
                      />
                    </label>

                    <label className="quoteLineField">
                      <span>Unité</span>
                      <input
                        value={component.unit}
                        onChange={(event) => updateComponent(index, { unit: event.target.value })}
                        maxLength={40}
                      />
                    </label>

                    <label className="quoteLineField">
                      <span>Coût unitaire HT</span>
                      <input
                        inputMode="decimal"
                        value={component.costPriceEuros}
                        onChange={(event) =>
                          updateComponent(index, { costPriceEuros: event.target.value })
                        }
                        placeholder="Pour calculer la marge"
                      />
                    </label>

                    <label className="quoteLineField">
                      <span>Prix de vente unitaire HT</span>
                      <input
                        inputMode="decimal"
                        value={component.unitPriceEuros}
                        onChange={(event) =>
                          updateComponent(index, { unitPriceEuros: event.target.value })
                        }
                        required
                      />
                    </label>

                    <div className="quoteComponentTotal">
                      <span>Coût total</span>
                      <strong>{costTotal === null ? "Non renseigné" : formatMoney(costTotal)}</strong>
                    </div>
                    <div className="quoteComponentTotal">
                      <span>Vente totale</span>
                      <strong>{total === null ? "À vérifier" : formatMoney(total)}</strong>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className={`quoteOuvragePrice${priceForced ? " isForced" : ""}`}>
              <div className="quoteOuvrageMetric">
                <span>Coût HT de l’ouvrage</span>
                <strong>
                  {calculatedUnitCost === null ? "À renseigner" : formatMoney(calculatedUnitCost)}
                </strong>
              </div>
              <div className="quoteOuvrageMetric">
                <span>Prix calculé HT</span>
                <strong>
                  {calculatedUnitPrice === null ? "À calculer" : formatMoney(calculatedUnitPrice)}
                </strong>
              </div>
              <div className="quoteOuvrageMetric quoteOuvrageRetainedPrice">
                <span>Prix retenu HT</span>
                {priceForced ? (
                  <div className="quoteForcedInputWrap">
                    <input
                      inputMode="decimal"
                      value={forcedUnitPriceEuros}
                      onChange={(event) => setForcedUnitPriceEuros(event.target.value)}
                      aria-label="Prix unitaire HT forcé de l’ouvrage"
                      required
                    />
                    <small className="quoteForcedBadge">
                      <LockKeyhole size={11} aria-hidden="true" /> Forcé
                    </small>
                  </div>
                ) : (
                  <strong>
                    {calculatedUnitPrice === null ? "À calculer" : formatMoney(calculatedUnitPrice)}
                  </strong>
                )}
              </div>
              <div
                className={`quoteOuvrageMetric quoteMarginMetric${
                  currentMarginAmount !== null && currentMarginAmount < 0 ? " isNegative" : ""
                }`}
              >
                <span>Marge de l’ouvrage</span>
                <strong>
                  {currentMarginAmount === null
                    ? "À renseigner"
                    : `${formatMoney(currentMarginAmount)} · ${formatPercent(currentMarginPercent)}`}
                </strong>
              </div>
              <div className="quoteOuvragePriceActions">
                {priceForced ? (
                  <button type="button" className="secondaryButton" onClick={resetForcedPrice}>
                    <RotateCcw size={14} aria-hidden="true" /> Revenir au prix calculé
                  </button>
                ) : (
                  <button
                    type="button"
                    className="secondaryButton"
                    onClick={enableForcedPrice}
                    disabled={calculatedUnitPrice === null}
                  >
                    <LockKeyhole size={14} aria-hidden="true" /> Forcer le prix
                  </button>
                )}
              </div>
              <small className="quoteOuvragePriceHelp">
                La marge utilise le coût des composants. Le prix forcé remplace uniquement le prix de
                vente de l’ouvrage, sans modifier sa composition.
              </small>
            </div>
          </div>

          {error ? <div className="quoteLineError">{error}</div> : null}

          <div className="quoteLineActions">
            <button type="button" className="secondaryButton" onClick={closeForm} disabled={saving}>
              Annuler
            </button>
            <button type="submit" className="primaryButton" disabled={saving}>
              {saving ? "Enregistrement…" : editingLineId ? "Enregistrer" : "Ajouter l’ouvrage"}
            </button>
          </div>
        </form>
      ) : null}

      {lines.length === 0 ? (
        <div className="quoteLinesNoData">
          <strong>Le devis est vide.</strong>
          <span>Ajoute son premier ouvrage, puis compose-le avec ses composants.</span>
        </div>
      ) : (
        <div className="quoteLinesTable">
          <div className="quoteLinesTableHeader">
            <span>Ouvrage</span>
            <span>Composants</span>
            <span>Qté</span>
            <span>Unité</span>
            <span>PU HT</span>
            <span>Marge</span>
            <span />
          </div>
          {lines.map((line) => {
            const expanded = expandedLineIds.has(line.id);
            const lineComponents = line.components ?? [];
            const componentCount = lineComponents.length;
            const salePriceCents = line.unitPriceCents ?? 0;
            const costPriceCents = calculateQuoteOuvrageUnitCostCents(lineComponents);
            const marginAmountCents =
              costPriceCents === null ? null : salePriceCents - costPriceCents;
            const marginPercent = calculateQuoteOuvrageMarginPercent(
              salePriceCents,
              costPriceCents,
            );
            return (
              <div className="quoteOuvrageGroup" key={line.id}>
                <div className="quoteLineRow">
                  <div className="quoteLineDescription">
                    {componentCount > 0 ? (
                      <button
                        type="button"
                        className="quoteExpandButton"
                        onClick={() => toggleLine(line.id)}
                        aria-label={expanded ? "Masquer les composants" : "Afficher les composants"}
                      >
                        {expanded ? (
                          <ChevronDown size={16} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={16} aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      <span className="quoteExpandSpacer" />
                    )}
                    <div>
                      <strong>{line.description}</strong>
                      {componentCount === 0 ? (
                        <small>Ancien format, sans détail composant</small>
                      ) : null}
                    </div>
                  </div>
                  <span>{componentCount || "—"}</span>
                  <span>{line.quantityFormula ?? line.quantity}</span>
                  <span>{line.unit || "—"}</span>
                  <div className="quotePriceCell">
                    <strong>{formatMoney(salePriceCents)}</strong>
                    {line.forcedUnitPriceCents !== undefined ? (
                      <small className="quoteForcedBadge">
                        <LockKeyhole size={10} aria-hidden="true" /> Forcé
                      </small>
                    ) : null}
                  </div>
                  <div
                    className={`quoteMarginCell${
                      marginAmountCents !== null && marginAmountCents < 0
                        ? " isNegative"
                        : marginAmountCents === null
                          ? " isMissing"
                          : ""
                    }`}
                  >
                    {marginAmountCents === null ? (
                      <span>À renseigner</span>
                    ) : (
                      <>
                        <strong>{formatMoney(marginAmountCents)}</strong>
                        <small>{formatPercent(marginPercent)}</small>
                      </>
                    )}
                  </div>
                  <span>
                    {editable ? (
                      <button
                        type="button"
                        className="iconButton"
                        onClick={() => openEditOuvrage(line)}
                        aria-label={`Modifier ${line.description}`}
                        title="Modifier l’ouvrage"
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                </div>

                {expanded && componentCount > 0 ? (
                  <div className="quoteComponentsPreview">
                    <div className="quoteComponentsPreviewHeader">
                      <span>Composant</span>
                      <span>Qté</span>
                      <span>Unité</span>
                      <span>Coût U. HT</span>
                      <span>Vente U. HT</span>
                      <span>Total HT</span>
                    </div>
                    {lineComponents.map((component) => {
                      const componentCost = quoteOuvrageComponentCostPriceCents(component);
                      return (
                        <div className="quoteComponentPreviewRow" key={component.id}>
                          <strong>{component.description}</strong>
                          <span>{component.quantityFormula ?? component.quantity}</span>
                          <span>{component.unit || "—"}</span>
                          <span>{componentCost === null ? "—" : formatMoney(componentCost)}</span>
                          <span>{formatMoney(component.unitPriceCents)}</span>
                          <span>
                            {formatMoney(Math.round(component.quantity * component.unitPriceCents))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
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
        .quoteComponentsEditorHeader,
        .quoteComponentCardHeader,
        .quoteOuvragePriceActions,
        .quoteForcedInputWrap,
        .quoteForcedBadge {
          display: flex;
          align-items: center;
        }
        .quoteLinesHeader,
        .quoteLineFormHeader,
        .quoteComponentsEditorHeader,
        .quoteComponentCardHeader {
          justify-content: space-between;
          gap: 16px;
        }
        .quoteLinesHeaderActions {
          justify-content: flex-end;
          gap: 8px;
          flex-wrap: wrap;
        }
        .quoteLinesHeader :global(.primaryButton),
        .quoteLineActions :global(button),
        .quoteComponentsEditorHeader :global(.secondaryButton),
        .quoteOuvragePriceActions :global(.secondaryButton) {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
        }
        .quoteLinesHeader p,
        .quoteLinesHeader h2,
        .quoteLineFormHeader p,
        .quoteLineFormHeader h3,
        .quoteComponentsEditorHeader p,
        .quoteComponentsEditorHeader h4 {
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
        .quoteComponentGrid {
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
        .quoteLineField span,
        .quoteComponentTotal span,
        .quoteOuvrageMetric span {
          font-size: 11px;
          font-weight: 800;
          color: var(--muted);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .quoteLineField input,
        .quoteLineField textarea,
        .quoteForcedInputWrap input {
          width: 100%;
          border: 1px solid var(--border);
          border-radius: 7px;
          background: #fff;
        }
        .quoteLineField textarea {
          resize: vertical;
        }
        .quoteComponentsEditor {
          padding: 14px;
          display: grid;
          gap: 12px;
          border: 1px solid #e1daf4;
          border-radius: 10px;
          background: #fff;
        }
        .quoteComponentCard {
          padding: 12px;
          display: grid;
          gap: 10px;
          border: 1px solid var(--border);
          border-radius: 9px;
          background: #fcfbff;
        }
        .quoteComponentCardHeader strong {
          font-size: 12px;
        }
        .quoteComponentTotal {
          align-self: end;
          min-height: 38px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 0 10px;
          border-radius: 7px;
          background: var(--surface-soft);
        }
        .quoteOuvragePrice {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          padding: 12px;
          border: 1px solid transparent;
          border-radius: 9px;
          background: #f3f0fb;
        }
        .quoteOuvragePrice.isForced {
          border-color: #c9bfe8;
          background: #faf8ff;
        }
        .quoteOuvrageMetric {
          min-width: 0;
          padding: 9px 10px;
          display: grid;
          gap: 4px;
          border-radius: 8px;
          background: #fff;
        }
        .quoteOuvrageMetric strong {
          font-size: 15px;
          color: var(--text);
        }
        .quoteMarginMetric strong {
          color: #31724b;
        }
        .quoteMarginMetric.isNegative strong {
          color: #a53d3d;
        }
        .quoteForcedInputWrap {
          gap: 8px;
        }
        .quoteForcedInputWrap input {
          min-width: 0;
        }
        .quoteForcedBadge {
          width: fit-content;
          gap: 4px;
          padding: 3px 6px;
          border-radius: 999px;
          background: #ece7fa;
          color: #6554b5;
          font-size: 9px;
          font-weight: 800;
          white-space: nowrap;
        }
        .quoteOuvragePriceActions {
          grid-column: 1 / -1;
          justify-content: flex-end;
        }
        .quoteOuvragePriceHelp {
          grid-column: 1 / -1;
          color: var(--muted);
          font-size: 10px;
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
          grid-template-columns: minmax(250px, 1fr) 82px 78px 70px 125px 135px 42px;
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
        .quoteOuvrageGroup + .quoteOuvrageGroup {
          border-top: 1px solid var(--border);
        }
        .quoteLineRow {
          min-height: 62px;
          font-size: 12px;
        }
        .quoteLineDescription {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .quoteLineDescription > div {
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .quoteLineDescription strong {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .quoteLineDescription small {
          color: var(--muted);
          font-size: 9px;
        }
        .quoteExpandButton,
        .quoteExpandSpacer {
          width: 24px;
          height: 24px;
          flex: 0 0 24px;
        }
        .quoteExpandButton {
          display: inline-grid;
          place-items: center;
          padding: 0;
          border: 0;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
        }
        .quoteExpandButton:hover {
          color: var(--accent);
        }
        .quotePriceCell,
        .quoteMarginCell {
          min-width: 0;
          display: grid;
          gap: 3px;
          justify-items: start;
        }
        .quotePriceCell strong,
        .quoteMarginCell strong {
          white-space: nowrap;
        }
        .quoteMarginCell {
          color: #31724b;
        }
        .quoteMarginCell small {
          font-weight: 800;
        }
        .quoteMarginCell.isNegative {
          color: #a53d3d;
        }
        .quoteMarginCell.isMissing {
          color: var(--muted);
          font-size: 10px;
          font-weight: 700;
        }
        .quoteComponentsPreview {
          margin: 0 18px 12px 49px;
          overflow: hidden;
          border: 1px solid #e4def2;
          border-radius: 8px;
          background: #fcfbff;
        }
        .quoteComponentsPreviewHeader,
        .quoteComponentPreviewRow {
          display: grid;
          grid-template-columns: minmax(210px, 1fr) 75px 70px 105px 105px 105px;
          gap: 10px;
          align-items: center;
          padding: 8px 12px;
        }
        .quoteComponentsPreviewHeader {
          background: #f6f3fc;
          color: var(--muted);
          font-size: 9px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .quoteComponentPreviewRow {
          min-height: 40px;
          border-top: 1px solid #ebe6f4;
          font-size: 11px;
        }
        .quoteComponentPreviewRow strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @media (max-width: 1000px) {
          .quoteLineGrid,
          .quoteComponentGrid,
          .quoteOuvragePrice {
            grid-template-columns: 1fr;
          }
          .quoteLineFieldWide,
          .quoteOuvragePriceActions,
          .quoteOuvragePriceHelp {
            grid-column: auto;
          }
          .quoteLinesTable {
            overflow-x: auto;
          }
          .quoteLinesTableHeader,
          .quoteLineRow {
            min-width: 930px;
          }
          .quoteComponentsPreview {
            min-width: 790px;
          }
        }
      `}</style>
    </section>
  );
}

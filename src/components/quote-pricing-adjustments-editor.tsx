"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  QuoteOption,
  QuotePricingAdjustment,
  QuotePricingConfig,
} from "@/lib/quotes/adjustments";
import { calculateQuoteAdjustedPricing } from "@/lib/quotes/adjustments";
import type { QuoteItem, QuoteLine } from "@/lib/quotes/model";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type PricingApiResponse = {
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

function parsePositiveNumber(value: string): number {
  const parsed = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("NUMBER_INVALID");
  return parsed;
}

function parseNonNegativeNumber(value: string): number {
  const parsed = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("NUMBER_INVALID");
  return parsed;
}

function eurosToCents(value: string): number {
  const cents = Math.round(parseNonNegativeNumber(value) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("NUMBER_INVALID");
  return cents;
}

function itemLabel(item: QuoteItem): string {
  if (item.kind === "SECTION") return `Groupe · ${item.title}`;
  if (item.kind === "SUBSECTION") return `Sous-groupe · ${item.title}`;
  if (item.kind === "LINE") return `Ligne · ${item.description}`;
  return item.text;
}

function pricingErrorLabel(code: string): string {
  if (code === "QUOTE_NOT_EDITABLE") return "Seul un brouillon peut être modifié.";
  if (code === "QUOTE_OPTION_TARGET_DUPLICATE") return "Cet élément est déjà une option.";
  if (code === "QUOTE_PASS_THROUGH_PERCENT_INVALID") {
    return "Le total des pourcentages répercutés doit rester inférieur à 100 %.";
  }
  if (code === "QUOTE_LINE_NOT_FOUND" || code === "QUOTE_OPTION_TARGET_NOT_FOUND") {
    return "L’élément ciblé n’existe plus.";
  }
  return "La modification du chiffrage n’a pas pu être enregistrée.";
}

async function postPricing(body: Record<string, unknown>): Promise<NativeQuotesPayload> {
  const response = await fetch("/api/desktop/quotes/pricing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as PricingApiResponse;
  if (!response.ok || !data.payload) throw new Error(data.error ?? "QUOTES_PRICING_MUTATION_FAILED");
  return data.payload;
}

function PoseHoursRow({
  quoteId,
  line,
  hours,
  editable,
  onSaved,
  onError,
}: {
  quoteId: string;
  line: QuoteLine;
  hours: number;
  editable: boolean;
  onSaved: (payload: NativeQuotesPayload) => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState(String(hours).replace(".", ","));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!editable || saving) return;
    try {
      const nextHours = parseNonNegativeNumber(value || "0");
      if (nextHours === hours) return;
      setSaving(true);
      const payload = await postPricing({
        action: "setLinePoseHours",
        quoteId,
        lineId: line.id,
        hours: nextHours,
      });
      onSaved(payload);
    } catch (error) {
      onError(pricingErrorLabel(error instanceof Error ? error.message : ""));
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="poseRow">
      <span>{line.description}</span>
      <input
        value={value}
        disabled={!editable || saving}
        inputMode="decimal"
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        aria-label={`Heures de pose ${line.description}`}
      />
      <small>h</small>
      <style jsx>{`
        .poseRow {
          display: grid;
          grid-template-columns: minmax(180px, 1fr) 82px 16px;
          gap: 7px;
          align-items: center;
          padding: 5px 0;
        }
        .poseRow > span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 750;
        }
        input {
          width: 100%;
          box-sizing: border-box;
          padding: 7px 8px;
          border: 1px solid #d9d2e8;
          border-radius: 7px;
          background: white;
          color: var(--text);
          text-align: right;
          font: inherit;
        }
        small {
          color: var(--muted);
          font-weight: 800;
        }
      `}</style>
    </label>
  );
}

export function QuotePricingAdjustmentsEditor({
  quote,
  canWrite,
  onSaved,
}: {
  quote: NativeQuoteRecord;
  canWrite: boolean;
  onSaved: (payload: NativeQuotesPayload) => void;
}) {
  const editable = canWrite && quote.status === "DRAFT";
  const [kind, setKind] = useState<"PERCENTAGE" | "POSE_HOURS">("PERCENTAGE");
  const [label, setLabel] = useState("Commission architecte");
  const [value, setValue] = useState("5");
  const [costRate, setCostRate] = useState("0");
  const [marginPercent, setMarginPercent] = useState("0");
  const [marginTreatment, setMarginTreatment] = useState<"MARGED" | "PASS_THROUGH">(
    "PASS_THROUGH",
  );
  const [applyToOptions, setApplyToOptions] = useState(true);
  const [optionTargetId, setOptionTargetId] = useState("");
  const [optionLabel, setOptionLabel] = useState("Option");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const lines = useMemo(
    () => quote.model.items.filter((item): item is QuoteLine => item.kind === "LINE"),
    [quote.model.items],
  );
  const optionTargets = useMemo(
    () =>
      quote.model.items.filter(
        (item) => item.kind === "LINE" || item.kind === "SECTION" || item.kind === "SUBSECTION",
      ),
    [quote.model.items],
  );
  const optionByTarget = useMemo(
    () => new Map(quote.pricingConfig.options.map((option) => [option.targetItemId, option])),
    [quote.pricingConfig.options],
  );
  const poseHours = useMemo(
    () => new Map(quote.pricingConfig.linePoseHours.map((entry) => [entry.lineId, entry.hours])),
    [quote.pricingConfig.linePoseHours],
  );
  const pricing = useMemo(
    () => calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig),
    [quote.model.items, quote.pricingConfig],
  );

  async function saveAdjustment(adjustment: QuotePricingAdjustment) {
    const payload = await postPricing({ action: "upsertAdjustment", quoteId: quote.id, adjustment });
    onSaved(payload);
  }

  async function addAdjustment() {
    if (!editable || saving) return;
    setError("");
    try {
      setSaving(true);
      const id = globalThis.crypto.randomUUID();
      if (kind === "PERCENTAGE") {
        await saveAdjustment({
          id,
          kind,
          label: label.trim(),
          active: true,
          applyToOptions,
          marginTreatment,
          percent: parsePositiveNumber(value),
        });
      } else {
        await saveAdjustment({
          id,
          kind,
          label: label.trim(),
          active: true,
          applyToOptions,
          marginTreatment,
          hours: parsePositiveNumber(value),
          costRateCents: eurosToCents(costRate),
          marginPercent: parseNonNegativeNumber(marginPercent),
        });
      }
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    } finally {
      setSaving(false);
    }
  }

  async function toggleAdjustment(adjustment: QuotePricingAdjustment) {
    if (!editable) return;
    setError("");
    try {
      await saveAdjustment({ ...adjustment, active: !adjustment.active });
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    }
  }

  async function removeAdjustment(adjustmentId: string) {
    if (!editable) return;
    setError("");
    try {
      const payload = await postPricing({ action: "removeAdjustment", quoteId: quote.id, adjustmentId });
      onSaved(payload);
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    }
  }

  async function addOption() {
    if (!editable || !optionTargetId || saving) return;
    const target = optionTargets.find((item) => item.id === optionTargetId);
    if (!target || target.kind === "COMMENT") return;
    setError("");
    try {
      setSaving(true);
      const option: QuoteOption = {
        id: globalThis.crypto.randomUUID(),
        targetItemId: target.id,
        targetKind: target.kind,
        label: optionLabel.trim() || itemLabel(target),
        status: "PENDING",
      };
      const payload = await postPricing({ action: "upsertOption", quoteId: quote.id, option });
      onSaved(payload);
      setOptionTargetId("");
      setOptionLabel("Option");
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    } finally {
      setSaving(false);
    }
  }

  async function setOptionStatus(option: QuoteOption, status: QuoteOption["status"]) {
    if (!editable) return;
    setError("");
    try {
      const payload = await postPricing({
        action: "upsertOption",
        quoteId: quote.id,
        option: { ...option, status },
      });
      onSaved(payload);
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    }
  }

  async function removeOption(optionId: string) {
    if (!editable) return;
    setError("");
    try {
      const payload = await postPricing({ action: "removeOption", quoteId: quote.id, optionId });
      onSaved(payload);
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    }
  }

  return (
    <section className="pricingCard">
      <div className="pricingHeader">
        <div>
          <p>Chiffrage interne</p>
          <h2>Ajustements, pose et options</h2>
        </div>
        <div className="pricingTotals">
          <span>Total principal <strong>{formatMoney(pricing.totalSaleCents)}</strong></span>
          <span>Options en attente <strong>{formatMoney(pricing.pendingOptionsSaleCents)}</strong></span>
          <span>Pose <strong>{pricing.totalPoseHours.toLocaleString("fr-FR")} h</strong></span>
        </div>
      </div>

      {error ? <div className="pricingError">{error}</div> : null}

      <div className="pricingGrid">
        <div className="pricingPanel">
          <h3>Ajustements internes</h3>
          <div className="adjustmentForm">
            <select value={kind} disabled={!editable} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="PERCENTAGE">Pourcentage</option>
              <option value="POSE_HOURS">Heures de pose / trajet</option>
            </select>
            <input value={label} disabled={!editable} onChange={(e) => setLabel(e.target.value)} placeholder="Libellé interne" />
            <input value={value} disabled={!editable} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={kind === "PERCENTAGE" ? "%" : "Heures"} />
            {kind === "POSE_HOURS" ? (
              <>
                <input value={costRate} disabled={!editable} onChange={(e) => setCostRate(e.target.value)} inputMode="decimal" placeholder="Coût €/h" />
                <input value={marginPercent} disabled={!editable || marginTreatment === "PASS_THROUGH"} onChange={(e) => setMarginPercent(e.target.value)} inputMode="decimal" placeholder="Marge %" />
              </>
            ) : null}
            <select value={marginTreatment} disabled={!editable} onChange={(e) => setMarginTreatment(e.target.value as typeof marginTreatment)}>
              <option value="PASS_THROUGH">Répercuté sans marge</option>
              <option value="MARGED">Margé</option>
            </select>
            <label className="inlineCheck">
              <input type="checkbox" checked={applyToOptions} disabled={!editable} onChange={(e) => setApplyToOptions(e.target.checked)} />
              Appliquer aux options
            </label>
            <button type="button" className="primaryButton" disabled={!editable || saving || !label.trim()} onClick={() => void addAdjustment()}>
              <Plus size={14} /> Ajouter
            </button>
          </div>

          <div className="adjustmentList">
            {quote.pricingConfig.adjustments.length === 0 ? <p className="emptyText">Aucun ajustement.</p> : null}
            {quote.pricingConfig.adjustments.map((adjustment) => (
              <div className="adjustmentRow" key={adjustment.id}>
                <button type="button" className={`stateButton${adjustment.active ? " isActive" : ""}`} disabled={!editable} onClick={() => void toggleAdjustment(adjustment)}>
                  {adjustment.active ? "Actif" : "Inactif"}
                </button>
                <div>
                  <strong>{adjustment.label}</strong>
                  <small>
                    {adjustment.kind === "PERCENTAGE" ? `${adjustment.percent.toLocaleString("fr-FR")} %` : `${adjustment.hours.toLocaleString("fr-FR")} h pose`}
                    {" · "}{adjustment.marginTreatment === "MARGED" ? "margé" : "sans marge"}
                    {adjustment.applyToOptions ? " · options incluses" : ""}
                  </small>
                </div>
                <button type="button" className="iconButton" aria-label={`Supprimer ${adjustment.label}`} disabled={!editable} onClick={() => void removeAdjustment(adjustment.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="pricingPanel">
          <h3>Heures de pose de base</h3>
          <p className="helper">Le trajet est réparti au prorata de ces heures.</p>
          <div className="poseList">
            {lines.length === 0 ? <p className="emptyText">Ajoute d’abord un ouvrage.</p> : null}
            {lines.map((line) => (
              <PoseHoursRow
                key={`${line.id}-${poseHours.get(line.id) ?? 0}`}
                quoteId={quote.id}
                line={line}
                hours={poseHours.get(line.id) ?? 0}
                editable={editable}
                onSaved={onSaved}
                onError={setError}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="pricingPanel optionPanel">
        <h3>Options client hors total</h3>
        <div className="optionForm">
          <select value={optionTargetId} disabled={!editable} onChange={(e) => setOptionTargetId(e.target.value)}>
            <option value="">Choisir une ligne ou un groupe…</option>
            {optionTargets
              .filter((item) => !optionByTarget.has(item.id))
              .map((item) => <option value={item.id} key={item.id}>{itemLabel(item)}</option>)}
          </select>
          <input value={optionLabel} disabled={!editable} onChange={(e) => setOptionLabel(e.target.value)} placeholder="Nom de l’option" />
          <button type="button" className="secondaryButton" disabled={!editable || saving || !optionTargetId} onClick={() => void addOption()}>
            <Plus size={14} /> Mettre en option
          </button>
        </div>

        <div className="optionList">
          {quote.pricingConfig.options.length === 0 ? <p className="emptyText">Aucune option.</p> : null}
          {quote.pricingConfig.options.map((option) => {
            const summary = pricing.options.find((item) => item.id === option.id);
            const target = optionTargets.find((item) => item.id === option.targetItemId);
            return (
              <div className="optionRow" key={option.id}>
                <div>
                  <strong>{option.label}</strong>
                  <small>{target ? itemLabel(target) : "Élément introuvable"} · {formatMoney(summary?.saleCents ?? 0)}</small>
                </div>
                <select value={option.status} disabled={!editable} onChange={(e) => void setOptionStatus(option, e.target.value as QuoteOption["status"])}>
                  <option value="PENDING">En attente</option>
                  <option value="RETAINED">Retenue</option>
                  <option value="REJECTED">Non retenue</option>
                </select>
                <button type="button" className="iconButton" aria-label={`Supprimer ${option.label}`} disabled={!editable} onClick={() => void removeOption(option.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {pricing.warnings.length > 0 ? (
        <p className="pricingWarning">Certaines heures de trajet ne peuvent pas être réparties tant qu’aucune heure de pose de base n’est renseignée.</p>
      ) : null}

      <style jsx>{`
        .pricingCard {
          display: grid;
          gap: 12px;
          padding: 14px;
          border: 1px solid #ddd5ee;
          border-radius: 14px;
          background: #fcfbff;
          box-shadow: 0 8px 24px rgba(70, 53, 116, 0.06);
        }
        .pricingHeader {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
        }
        .pricingHeader p {
          margin: 0 0 2px;
          color: #776a9d;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .pricingHeader h2, .pricingPanel h3 { margin: 0; color: var(--text); }
        .pricingHeader h2 { font-size: 17px; }
        .pricingPanel h3 { font-size: 13px; }
        .pricingTotals {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 7px;
        }
        .pricingTotals span {
          padding: 6px 8px;
          border-radius: 8px;
          background: #f1edf9;
          color: var(--muted);
          font-size: 10px;
          font-weight: 750;
        }
        .pricingTotals strong { color: var(--text); margin-left: 4px; }
        .pricingGrid {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
          gap: 10px;
        }
        .pricingPanel {
          display: grid;
          gap: 9px;
          padding: 11px;
          border: 1px solid #e6e0f1;
          border-radius: 10px;
          background: white;
        }
        .adjustmentForm, .optionForm {
          display: flex;
          gap: 6px;
          align-items: center;
          flex-wrap: wrap;
        }
        .adjustmentForm input, .adjustmentForm select, .optionForm input, .optionForm select, .optionRow select {
          min-height: 34px;
          box-sizing: border-box;
          padding: 6px 8px;
          border: 1px solid #d9d2e8;
          border-radius: 7px;
          background: white;
          color: var(--text);
          font: inherit;
          font-size: 12px;
        }
        .adjustmentForm > input:first-of-type { min-width: 180px; flex: 1 1 180px; }
        .adjustmentForm > input:not(:first-of-type) { width: 92px; }
        .optionForm select { min-width: 260px; flex: 1 1 320px; }
        .optionForm input { min-width: 180px; flex: 0 1 250px; }
        .inlineCheck {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: var(--muted);
          font-size: 11px;
          font-weight: 750;
        }
        .inlineCheck input { width: auto !important; min-height: 0; }
        .adjustmentList, .optionList, .poseList { display: grid; gap: 3px; }
        .adjustmentRow, .optionRow {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          padding: 7px 0;
          border-top: 1px solid #f0edf5;
        }
        .optionRow { grid-template-columns: minmax(0, 1fr) auto auto; }
        .adjustmentRow strong, .optionRow strong { display: block; font-size: 12px; }
        .adjustmentRow small, .optionRow small { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
        .stateButton {
          min-width: 55px;
          padding: 5px 7px;
          border: 1px solid #d9d2e8;
          border-radius: 999px;
          background: #f3f1f7;
          color: var(--muted);
          font-size: 10px;
          font-weight: 850;
        }
        .stateButton.isActive { background: #ece5fa; color: #5d467e; border-color: #cfc1e6; }
        .iconButton {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border: 1px solid #e0d9eb;
          border-radius: 7px;
          background: white;
          color: #846f92;
        }
        .primaryButton, .secondaryButton {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 34px;
        }
        .helper, .emptyText, .pricingWarning, .pricingError { margin: 0; font-size: 11px; }
        .helper, .emptyText { color: var(--muted); }
        .pricingWarning { color: #8a611c; font-weight: 750; }
        .pricingError {
          padding: 8px 10px;
          border-radius: 8px;
          background: #fff1f1;
          color: #9c3434;
          font-weight: 800;
        }
        @media (max-width: 950px) {
          .pricingGrid { grid-template-columns: 1fr; }
          .pricingHeader { flex-direction: column; }
          .pricingTotals { justify-content: flex-start; }
        }
      `}</style>
    </section>
  );
}

"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  calculateQuoteAdjustedPricing,
  type QuoteOption,
  type QuotePricingAdjustment,
} from "@/lib/quotes/adjustments";
import type { QuoteLine } from "@/lib/quotes/model";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type PricingApiResponse = {
  payload?: NativeQuotesPayload;
  error?: string;
};

type OptionTarget = Exclude<
  NativeQuoteRecord["model"]["items"][number],
  { kind: "COMMENT" }
>;

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
});

function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

function parseNumber(value: string, allowZero = false): number {
  const parsed = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) {
    throw new Error("NUMBER_INVALID");
  }
  return parsed;
}

function eurosToCents(value: string): number {
  const cents = Math.round(parseNumber(value, true) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("NUMBER_INVALID");
  return cents;
}

function itemLabel(item: OptionTarget): string {
  if (item.kind === "SECTION") return `Groupe · ${item.title}`;
  if (item.kind === "SUBSECTION") return `Sous-groupe · ${item.title}`;
  return `Ligne · ${item.description}`;
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
  if (code === "NUMBER_INVALID") return "La valeur saisie n’est pas valide.";
  return "La modification du chiffrage n’a pas pu être enregistrée.";
}

async function postPricing(body: Record<string, unknown>): Promise<NativeQuotesPayload> {
  const response = await fetch("/api/desktop/quotes/pricing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as PricingApiResponse;
  if (!response.ok || !data.payload) {
    throw new Error(data.error ?? "QUOTES_PRICING_MUTATION_FAILED");
  }
  return data.payload;
}

function PoseHoursInput({
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
      const nextHours = parseNumber(value || "0", true);
      if (nextHours === hours) return;
      setSaving(true);
      onSaved(
        await postPricing({
          action: "setLinePoseHours",
          quoteId,
          lineId: line.id,
          hours: nextHours,
        }),
      );
    } catch (error) {
      onError(pricingErrorLabel(error instanceof Error ? error.message : ""));
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="poseRow">
      <span title={line.description}>{line.description}</span>
      <input
        aria-label={`Heures de pose ${line.description}`}
        disabled={!editable || saving}
        inputMode="decimal"
        value={value}
        onBlur={() => void save()}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <small>h</small>
      <style jsx>{`
        .poseRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 82px 16px;
          gap: 7px;
          align-items: center;
        }
        .poseRow span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 750;
        }
        .poseRow input {
          width: 100%;
          box-sizing: border-box;
          padding: 7px 8px;
          border: 1px solid #d9d2e8;
          border-radius: 7px;
          text-align: right;
        }
        .poseRow small {
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
        (item): item is OptionTarget => item.kind !== "COMMENT",
      ),
    [quote.model.items],
  );
  const optionTargetIds = useMemo(
    () => new Set(quote.pricingConfig.options.map((option) => option.targetItemId)),
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
    onSaved(
      await postPricing({
        action: "upsertAdjustment",
        quoteId: quote.id,
        adjustment,
      }),
    );
  }

  async function addAdjustment() {
    if (!editable || saving || !label.trim()) return;
    setError("");
    setSaving(true);
    try {
      const common = {
        id: globalThis.crypto.randomUUID(),
        label: label.trim(),
        active: true,
        applyToOptions,
        marginTreatment,
      } as const;
      if (kind === "PERCENTAGE") {
        await saveAdjustment({ ...common, kind, percent: parseNumber(value) });
      } else {
        await saveAdjustment({
          ...common,
          kind,
          hours: parseNumber(value),
          costRateCents: eurosToCents(costRate),
          marginPercent: parseNumber(marginPercent, true),
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
      onSaved(
        await postPricing({
          action: "removeAdjustment",
          quoteId: quote.id,
          adjustmentId,
        }),
      );
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    }
  }

  async function addOption() {
    if (!editable || saving || !optionTargetId) return;
    const target = optionTargets.find((item) => item.id === optionTargetId);
    if (!target) return;
    setError("");
    setSaving(true);
    try {
      const option: QuoteOption = {
        id: globalThis.crypto.randomUUID(),
        targetItemId: target.id,
        targetKind: target.kind,
        label: optionLabel.trim() || itemLabel(target),
        status: "PENDING",
      };
      onSaved(await postPricing({ action: "upsertOption", quoteId: quote.id, option }));
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
      onSaved(
        await postPricing({
          action: "upsertOption",
          quoteId: quote.id,
          option: { ...option, status },
        }),
      );
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    }
  }

  async function removeOption(optionId: string) {
    if (!editable) return;
    setError("");
    try {
      onSaved(await postPricing({ action: "removeOption", quoteId: quote.id, optionId }));
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    }
  }

  return (
    <section className="pricingCard">
      <header>
        <div>
          <p>Chiffrage interne</p>
          <h2>Ajustements, pose et options</h2>
        </div>
        <div className="totals">
          <span>
            Total principal <strong>{formatMoney(pricing.totalSaleCents)}</strong>
          </span>
          <span>
            Options en attente <strong>{formatMoney(pricing.pendingOptionsSaleCents)}</strong>
          </span>
          <span>
            Pose <strong>{pricing.totalPoseHours.toLocaleString("fr-FR")} h</strong>
          </span>
        </div>
      </header>

      {error ? <div className="error">{error}</div> : null}

      <div className="columns">
        <div className="panel">
          <h3>Ajustements internes</h3>
          <div className="formRow">
            <select
              disabled={!editable}
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              <option value="PERCENTAGE">Pourcentage</option>
              <option value="POSE_HOURS">Heures de pose / trajet</option>
            </select>
            <input
              disabled={!editable}
              placeholder="Libellé interne"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <input
              disabled={!editable}
              inputMode="decimal"
              placeholder={kind === "PERCENTAGE" ? "%" : "Heures"}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
            {kind === "POSE_HOURS" ? (
              <>
                <input
                  disabled={!editable}
                  inputMode="decimal"
                  placeholder="Coût €/h"
                  value={costRate}
                  onChange={(event) => setCostRate(event.target.value)}
                />
                <input
                  disabled={!editable || marginTreatment === "PASS_THROUGH"}
                  inputMode="decimal"
                  placeholder="Marge %"
                  value={marginPercent}
                  onChange={(event) => setMarginPercent(event.target.value)}
                />
              </>
            ) : null}
            <select
              disabled={!editable}
              value={marginTreatment}
              onChange={(event) =>
                setMarginTreatment(event.target.value as typeof marginTreatment)
              }
            >
              <option value="PASS_THROUGH">Répercuté sans marge</option>
              <option value="MARGED">Margé</option>
            </select>
            <label className="checkbox">
              <input
                checked={applyToOptions}
                disabled={!editable}
                type="checkbox"
                onChange={(event) => setApplyToOptions(event.target.checked)}
              />
              Appliquer aux options
            </label>
            <button
              className="primaryButton compact"
              disabled={!editable || saving || !label.trim()}
              type="button"
              onClick={() => void addAdjustment()}
            >
              <Plus size={14} /> Ajouter
            </button>
          </div>

          <div className="list">
            {quote.pricingConfig.adjustments.length === 0 ? (
              <p className="empty">Aucun ajustement.</p>
            ) : null}
            {quote.pricingConfig.adjustments.map((adjustment) => (
              <div className="listRow" key={adjustment.id}>
                <button
                  className={`state${adjustment.active ? " active" : ""}`}
                  disabled={!editable}
                  type="button"
                  onClick={() => void toggleAdjustment(adjustment)}
                >
                  {adjustment.active ? "Actif" : "Inactif"}
                </button>
                <div>
                  <strong>{adjustment.label}</strong>
                  <small>
                    {adjustment.kind === "PERCENTAGE"
                      ? `${adjustment.percent.toLocaleString("fr-FR")} %`
                      : `${adjustment.hours.toLocaleString("fr-FR")} h pose`}
                    {" · "}
                    {adjustment.marginTreatment === "MARGED" ? "margé" : "sans marge"}
                    {adjustment.applyToOptions ? " · options incluses" : ""}
                  </small>
                </div>
                <button
                  aria-label={`Supprimer ${adjustment.label}`}
                  className="iconButton"
                  disabled={!editable}
                  type="button"
                  onClick={() => void removeAdjustment(adjustment.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3>Heures de pose de base</h3>
          <p className="hint">Le trajet est réparti au prorata de ces heures.</p>
          <div className="poseList">
            {lines.length === 0 ? <p className="empty">Ajoute d’abord un ouvrage.</p> : null}
            {lines.map((line) => (
              <PoseHoursInput
                editable={editable}
                hours={poseHours.get(line.id) ?? 0}
                key={`${line.id}-${poseHours.get(line.id) ?? 0}`}
                line={line}
                quoteId={quote.id}
                onError={setError}
                onSaved={onSaved}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Options client hors total</h3>
        <div className="formRow optionForm">
          <select
            disabled={!editable}
            value={optionTargetId}
            onChange={(event) => setOptionTargetId(event.target.value)}
          >
            <option value="">Choisir une ligne ou un groupe…</option>
            {optionTargets
              .filter((item) => !optionTargetIds.has(item.id))
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {itemLabel(item)}
                </option>
              ))}
          </select>
          <input
            disabled={!editable}
            placeholder="Nom de l’option"
            value={optionLabel}
            onChange={(event) => setOptionLabel(event.target.value)}
          />
          <button
            className="secondaryButton compact"
            disabled={!editable || saving || !optionTargetId}
            type="button"
            onClick={() => void addOption()}
          >
            <Plus size={14} /> Mettre en option
          </button>
        </div>

        <div className="list">
          {quote.pricingConfig.options.length === 0 ? (
            <p className="empty">Aucune option.</p>
          ) : null}
          {quote.pricingConfig.options.map((option) => {
            const summary = pricing.options.find((entry) => entry.id === option.id);
            const target = optionTargets.find((item) => item.id === option.targetItemId);
            return (
              <div className="optionRow" key={option.id}>
                <div>
                  <strong>{option.label}</strong>
                  <small>
                    {target ? itemLabel(target) : "Élément introuvable"} ·{" "}
                    {formatMoney(summary?.saleCents ?? 0)}
                  </small>
                </div>
                <select
                  disabled={!editable}
                  value={option.status}
                  onChange={(event) =>
                    void setOptionStatus(option, event.target.value as QuoteOption["status"])
                  }
                >
                  <option value="PENDING">En attente</option>
                  <option value="RETAINED">Retenue</option>
                  <option value="REJECTED">Non retenue</option>
                </select>
                <button
                  aria-label={`Supprimer ${option.label}`}
                  className="iconButton"
                  disabled={!editable}
                  type="button"
                  onClick={() => void removeOption(option.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {pricing.warnings.length > 0 ? (
        <p className="warning">
          Certaines heures de trajet ne peuvent pas être réparties tant qu’aucune heure de
          pose de base n’est renseignée.
        </p>
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
        header {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
        }
        header p {
          margin: 0 0 2px;
          color: #776a9d;
          font-size: 10px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        h2,
        h3 {
          margin: 0;
          color: var(--text);
        }
        h2 {
          font-size: 17px;
        }
        h3 {
          font-size: 13px;
        }
        .totals {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 7px;
        }
        .totals span {
          padding: 6px 8px;
          border-radius: 8px;
          background: #f1edf9;
          color: var(--muted);
          font-size: 10px;
          font-weight: 750;
        }
        .totals strong {
          margin-left: 4px;
          color: var(--text);
        }
        .columns {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
          gap: 10px;
        }
        .panel {
          display: grid;
          gap: 9px;
          padding: 11px;
          border: 1px solid #e6e0f1;
          border-radius: 10px;
          background: white;
        }
        .formRow {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }
        .formRow input,
        .formRow select,
        .optionRow select {
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
        .formRow > input:first-of-type {
          min-width: 180px;
          flex: 1 1 180px;
        }
        .formRow > input:not(:first-of-type) {
          width: 92px;
        }
        .optionForm select {
          min-width: 260px;
          flex: 1 1 320px;
        }
        .optionForm input {
          min-width: 180px;
          flex: 0 1 250px;
        }
        .checkbox {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: var(--muted);
          font-size: 11px;
          font-weight: 750;
        }
        .checkbox input {
          width: auto !important;
          min-height: 0;
        }
        .compact {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          min-height: 34px;
        }
        .list,
        .poseList {
          display: grid;
          gap: 6px;
        }
        .listRow,
        .optionRow {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          padding-top: 7px;
          border-top: 1px solid #f0edf5;
        }
        .optionRow {
          grid-template-columns: minmax(0, 1fr) auto auto;
        }
        .list strong {
          display: block;
          font-size: 12px;
        }
        .list small {
          display: block;
          margin-top: 2px;
          color: var(--muted);
          font-size: 10px;
        }
        .state {
          min-width: 55px;
          padding: 5px 7px;
          border: 1px solid #d9d2e8;
          border-radius: 999px;
          background: #f3f1f7;
          color: var(--muted);
          font-size: 10px;
          font-weight: 850;
        }
        .state.active {
          border-color: #cfc1e6;
          background: #ece5fa;
          color: #5d467e;
        }
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
        .hint,
        .empty,
        .warning {
          margin: 0;
          color: var(--muted);
          font-size: 11px;
        }
        .warning {
          color: #8a611c;
          font-weight: 750;
        }
        .error {
          padding: 8px 10px;
          border-radius: 8px;
          background: #fff1f1;
          color: #9c3434;
          font-size: 11px;
          font-weight: 800;
        }
        @media (max-width: 950px) {
          .columns {
            grid-template-columns: 1fr;
          }
          header {
            flex-direction: column;
          }
          .totals {
            justify-content: flex-start;
          }
        }
      `}</style>
    </section>
  );
}

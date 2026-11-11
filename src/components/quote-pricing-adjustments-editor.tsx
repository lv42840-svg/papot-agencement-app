"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { quoteRevisionHeaders } from "@/lib/quotes/concurrency";
import {
  calculateQuoteAdjustedPricing,
  type QuotePricingAdjustment,
} from "@/lib/quotes/adjustments";
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

function parseNumber(valeur: string, allowZero = false): number {
  const analyse = Number(valeur.trim().replace(",", "."));
  if (!Number.isFinite(analyse) || analyse < 0 || (!allowZero && analyse === 0)) {
    throw new Error("NUMBER_INVALID");
  }
  return analyse;
}

function parsePositiveInteger(valeur: string): number {
  const analyse = parseNumber(valeur);
  if (!Number.isInteger(analyse)) throw new Error("NUMBER_INVALID");
  return analyse;
}

function parseMoneyCents(valeur: string): number {
  return Math.round(parseNumber(valeur) * 100);
}

function adjustmentValueLabel(adjustment: QuotePricingAdjustment): string {
  if (adjustment.kind === "PERCENTAGE") {
    return `${adjustment.percent.toLocaleString("fr-FR")} %`;
  }
  if (adjustment.kind === "POSE_HOURS") {
    return `${adjustment.hours.toLocaleString("fr-FR")} h pose`;
  }
  const nightsLabel = adjustment.nights > 1 ? "nuits" : "nuit";
  return `${adjustment.nights.toLocaleString("fr-FR")} ${nightsLabel} × ${formatMoney(adjustment.pricePerNightCents)} = ${formatMoney(adjustment.nights * adjustment.pricePerNightCents)}`;
}

function pricingErrorLabel(code: string): string {
  if (code === "QUOTE_VERSION_CONFLICT")
    return "Ce devis a été modifié ailleurs. Recharge-le avant de recommencer.";
  if (code === "QUOTE_NOT_EDITABLE") return "Seul un brouillon peut être modifié.";
  if (code === "QUOTE_OPTION_TARGET_DUPLICATE") return "Cet élément est déjà une option.";
  if (code === "QUOTE_PASS_THROUGH_PERCENT_INVALID") {
    return "Le total des pourcentages répercutés doit rester inférieur à 100 %.";
  }
  if (code === "QUOTE_OPTION_TARGET_NOT_FOUND") return "L’élément ciblé n’existe plus.";
  if (code === "NUMBER_INVALID") return "La valeur saisie n’est pas valide.";
  if (code === "QUOTE_CUSTOMER_DISCOUNT_TOO_HIGH") {
    return "La remise client ne peut pas dépasser le total du devis.";
  }
  return "La modification du chiffrage n’a pas pu être enregistrée.";
}

function pricingWarningLabel(code: string): string {
  if (code.startsWith("QUOTE_POSE_HOURS_NO_BASE:")) {
    return "Le trajet ne peut pas être réparti : aucune ligne du périmètre ne contient d’heures « Heure pose ».";
  }
  if (code.startsWith("QUOTE_POSE_HOURS_COST_MISSING:")) {
    return "Un trajet sans marge ne peut pas être valorisé correctement car un coût « Heure pose » manque.";
  }
  if (code.startsWith("QUOTE_POSE_HOURS_ZERO_RATE:")) {
    return "Un tarif « Heure pose » vaut 0 €. Les heures sont bien ajoutées, mais leur prix n’augmente pas.";
  }
  if (code.startsWith("QUOTE_HOTEL_NO_POSE_HOURS:")) {
    return "L’hôtel ne peut pas être réparti : aucune ligne du devis principal ne contient d’heures de pose.";
  }
  if (code.startsWith("QUOTE_HOTEL_MARGIN_RATE_MISSING:")) {
    return "Une part d’hôtel a été répercutée sans marge car le coefficient coût / vente de l’« Heure pose » ne peut pas être calculé.";
  }
  return "Un ajustement de chiffrage nécessite une vérification.";
}

async function postPricing(
  corps: Record<string, unknown>,
  updatedAt: string,
): Promise<NativeQuotesPayload> {
  const reponse = await fetch("/api/desktop/quotes/pricing", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...quoteRevisionHeaders(updatedAt),
    },
    body: JSON.stringify(corps),
  });
  const donnees = (await reponse.json()) as PricingApiResponse;
  if (!reponse.ok || !donnees.payload) {
    throw new Error(donnees.error ?? "QUOTES_PRICING_MUTATION_FAILED");
  }
  return donnees.payload;
}

export function QuotePricingAdjustmentsEditor({
  quote,
  canWrite,
  onSaved,
}: {
  quote: NativeQuoteRecord;
  canWrite: boolean;
  onSaved: (contenu: NativeQuotesPayload) => void;
}) {
  const editable = canWrite && quote.status === "DRAFT";
  const postPricingForQuote = (corps: Record<string, unknown>) =>
    postPricing(corps, quote.updatedAt);
  const [kind, setKind] = useState<"PERCENTAGE" | "POSE_HOURS" | "HOTEL">("PERCENTAGE");
  const [libelle, setLabel] = useState("Commission architecte");
  const [valeur, setValue] = useState("5");
  const [hotelNights, setHotelNights] = useState("1");
  const [hotelPricePerNight, setHotelPricePerNight] = useState("120");
  const [marginTreatment, setMarginTreatment] = useState<"MARGED" | "PASS_THROUGH">("PASS_THROUGH");
  const [applyToOptions, setApplyToOptions] = useState(true);
  const [discountKind, setDiscountKind] = useState<"PERCENTAGE" | "AMOUNT">(
    quote.pricingConfig.customerDiscount?.kind ?? "PERCENTAGE",
  );
  const [discountValue, setDiscountValue] = useState(() => {
    const discount = quote.pricingConfig.customerDiscount;
    if (!discount) return "";
    return discount.kind === "PERCENTAGE"
      ? String(discount.percent).replace(".", ",")
      : String(discount.amountCents / 100).replace(".", ",");
  });
  const [savingDiscount, setSavingDiscount] = useState(false);
  const [sauvegardeEnCours, setSaving] = useState(false);
  const [erreur, setError] = useState("");

  const pricing = useMemo(
    () => calculateQuoteAdjustedPricing(quote.model.items, quote.pricingConfig),
    [quote.model.items, quote.pricingConfig],
  );
  const poseLines = useMemo(
    () => pricing.lines.filter((ligne) => ligne.basePoseHours > 0),
    [pricing.lines],
  );
  const warningLabels = useMemo(
    () => Array.from(new Set(pricing.warnings.map(pricingWarningLabel))),
    [pricing.warnings],
  );

  useEffect(() => {
    const discount = quote.pricingConfig.customerDiscount;
    setDiscountKind(discount?.kind ?? "PERCENTAGE");
    setDiscountValue(
      !discount
        ? ""
        : discount.kind === "PERCENTAGE"
          ? String(discount.percent).replace(".", ",")
          : String(discount.amountCents / 100).replace(".", ","),
    );
  }, [quote.id, quote.pricingConfig.customerDiscount]);

  function changeKind(nextKind: "PERCENTAGE" | "POSE_HOURS" | "HOTEL") {
    setKind(nextKind);
    if (nextKind === "POSE_HOURS") {
      setLabel("Déplacement chantier");
      setValue("8");
      setMarginTreatment("MARGED");
      setApplyToOptions(false);
      return;
    }
    if (nextKind === "HOTEL") {
      setLabel("Hôtel chantier");
      setHotelNights("1");
      setHotelPricePerNight("120");
      setMarginTreatment("PASS_THROUGH");
      setApplyToOptions(false);
      return;
    }
    setLabel("Commission architecte");
    setValue("5");
    setMarginTreatment("PASS_THROUGH");
    setApplyToOptions(true);
  }

  async function saveAdjustment(adjustment: QuotePricingAdjustment) {
    onSaved(
      await postPricingForQuote({
        action: "upsertAdjustment",
        quoteId: quote.id,
        adjustment,
      }),
    );
  }

  async function addAdjustment() {
    if (!editable || sauvegardeEnCours || !libelle.trim()) return;
    setError("");
    setSaving(true);
    try {
      const id = globalThis.crypto.randomUUID();
      const cleanLabel = libelle.trim();
      if (kind === "HOTEL") {
        await saveAdjustment({
          id,
          kind: "HOTEL",
          label: cleanLabel,
          active: true,
          applyToOptions: false,
          marginTreatment,
          nights: parsePositiveInteger(hotelNights),
          pricePerNightCents: parseMoneyCents(hotelPricePerNight),
        });
        return;
      }

      const common = {
        id,
        label: cleanLabel,
        active: true,
        applyToOptions,
        marginTreatment,
      } as const;
      if (kind === "PERCENTAGE") {
        await saveAdjustment({ ...common, kind, percent: parseNumber(valeur) });
      } else {
        await saveAdjustment({ ...common, kind, hours: parseNumber(valeur) });
      }
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    } finally {
      setSaving(false);
    }
  }

  async function saveCustomerDiscount() {
    if (!editable || savingDiscount || !discountValue.trim()) return;
    setError("");
    setSavingDiscount(true);
    try {
      const discount =
        discountKind === "PERCENTAGE"
          ? { kind: "PERCENTAGE" as const, percent: parseNumber(discountValue) }
          : { kind: "AMOUNT" as const, amountCents: parseMoneyCents(discountValue) };
      onSaved(
        await postPricingForQuote({
          action: "setCustomerDiscount",
          quoteId: quote.id,
          discount,
        }),
      );
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    } finally {
      setSavingDiscount(false);
    }
  }

  async function clearCustomerDiscount() {
    if (!editable || savingDiscount) return;
    setError("");
    setSavingDiscount(true);
    try {
      onSaved(
        await postPricingForQuote({
          action: "clearCustomerDiscount",
          quoteId: quote.id,
        }),
      );
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    } finally {
      setSavingDiscount(false);
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
        await postPricingForQuote({
          action: "removeAdjustment",
          quoteId: quote.id,
          adjustmentId,
        }),
      );
    } catch (caught) {
      setError(pricingErrorLabel(caught instanceof Error ? caught.message : ""));
    }
  }

  return (
    <section className="pricingCard">
      <header>
        <div>
          <p>Chiffrage interne</p>
          <h2>Ajustements, pose et hôtel</h2>
        </div>
        <div className="totals">
          <span>
            Total principal <strong>{formatMoney(pricing.totalSaleCents)}</strong>
          </span>
          <span>
            Options en attente <strong>{formatMoney(pricing.pendingOptionsSaleCents)}</strong>
          </span>
          <span>
            Pose ferme <strong>{pricing.totalPoseHours.toLocaleString("fr-FR")} h</strong>
          </span>
        </div>
      </header>

      {erreur ? <div className="error">{erreur}</div> : null}

      <div className="customerDiscount">
        <div>
          <strong>Remise client</strong>
          <span>
            {pricing.customerDiscountCents > 0
              ? `−${formatMoney(pricing.customerDiscountCents)} sur ${formatMoney(pricing.grossSaleCents)}`
              : "Aucune remise appliquée"}
          </span>
        </div>
        <div className="customerDiscountControls">
          <select
            value={discountKind}
            disabled={!editable || savingDiscount}
            onChange={(evenement) =>
              setDiscountKind(evenement.target.value as "PERCENTAGE" | "AMOUNT")
            }
            aria-label="Type de remise client"
          >
            <option value="PERCENTAGE">%</option>
            <option value="AMOUNT">€</option>
          </select>
          <input
            value={discountValue}
            disabled={!editable || savingDiscount}
            onChange={(evenement) => setDiscountValue(evenement.target.value)}
            inputMode="decimal"
            placeholder={discountKind === "PERCENTAGE" ? "Ex. 5" : "Ex. 100"}
            aria-label="Valeur de la remise client"
          />
          <button
            type="button"
            className="primaryButton compact"
            disabled={!editable || savingDiscount || !discountValue.trim()}
            onClick={() => void saveCustomerDiscount()}
          >
            {savingDiscount ? "…" : "Appliquer"}
          </button>
          {quote.pricingConfig.customerDiscount ? (
            <button
              type="button"
              className="secondaryButton compact"
              disabled={!editable || savingDiscount}
              onClick={() => void clearCustomerDiscount()}
            >
              Retirer
            </button>
          ) : null}
        </div>
      </div>

      <div className="columns">
        <div className="panel">
          <h3>Ajustements internes</h3>
          <p className="hint">
            Ils modifient les prix ou les heures sans créer de ligne visible pour le client.
          </p>
          <div className="formRow">
            <select
              disabled={!editable}
              value={kind}
              onChange={(evenement) => changeKind(evenement.target.value as typeof kind)}
            >
              <option value="PERCENTAGE">Pourcentage</option>
              <option value="POSE_HOURS">Heures de pose / trajet</option>
              <option value="HOTEL">Hôtel</option>
            </select>
            <input
              disabled={!editable}
              placeholder="Libellé interne"
              value={libelle}
              onChange={(evenement) => setLabel(evenement.target.value)}
            />
            {kind === "HOTEL" ? (
              <>
                <input
                  disabled={!editable}
                  inputMode="numeric"
                  placeholder="Nuits"
                  value={hotelNights}
                  onChange={(evenement) => setHotelNights(evenement.target.value)}
                />
                <input
                  disabled={!editable}
                  inputMode="decimal"
                  placeholder="€/nuit"
                  value={hotelPricePerNight}
                  onChange={(evenement) => setHotelPricePerNight(evenement.target.value)}
                />
              </>
            ) : (
              <input
                disabled={!editable}
                inputMode="decimal"
                placeholder={kind === "PERCENTAGE" ? "%" : "Heures"}
                value={valeur}
                onChange={(evenement) => setValue(evenement.target.value)}
              />
            )}
            <select
              disabled={!editable}
              value={marginTreatment}
              onChange={(evenement) =>
                setMarginTreatment(evenement.target.value as typeof marginTreatment)
              }
            >
              <option value="PASS_THROUGH">Répercuté sans marge</option>
              <option value="MARGED">Margé</option>
            </select>
            {kind === "HOTEL" ? (
              <span className="scopeNote">Devis principal</span>
            ) : (
              <label className="checkbox">
                <input
                  checked={applyToOptions}
                  disabled={!editable}
                  type="checkbox"
                  onChange={(evenement) => setApplyToOptions(evenement.target.checked)}
                />
                Appliquer aux options
              </label>
            )}
            <button
              className="primaryButton compact"
              disabled={!editable || sauvegardeEnCours || !libelle.trim()}
              type="button"
              onClick={() => void addAdjustment()}
            >
              <Plus size={14} /> Ajouter
            </button>
          </div>
          {kind === "HOTEL" ? (
            <p className="hint">
              Le total nuits × prix est réparti au prorata des heures de pose. En mode « Margé »,
              chaque part reprend le coefficient coût / vente de l’« Heure pose » de sa ligne.
            </p>
          ) : null}

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
                    {adjustmentValueLabel(adjustment)}
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
          <h3>Heures de pose détectées</h3>
          <p className="hint">
            Elles viennent automatiquement des composants « Heure pose ». Les trajets et l’hôtel
            sont répartis au prorata, sans ressaisie.
          </p>
          <div className="poseList">
            {poseLines.length === 0 ? (
              <p className="empty">Aucune heure de pose dans les ouvrages pour le moment.</p>
            ) : null}
            {poseLines.map((ligne) => (
              <div className="poseRow" key={ligne.lineId}>
                <span title={ligne.description}>{ligne.description}</span>
                <strong>{ligne.basePoseHours.toLocaleString("fr-FR")} h</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {warningLabels.map((warning) => (
        <p className="warning" key={warning}>
          {warning}
        </p>
      ))}

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
        .customerDiscount {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 11px;
          border: 1px solid #d9cfeb;
          border-radius: 10px;
          background: #f7f3ff;
        }
        .customerDiscount > div:first-child {
          display: grid;
          gap: 2px;
        }
        .customerDiscount strong {
          font-size: 12px;
          color: #4f3c93;
        }
        .customerDiscount span {
          color: var(--muted);
          font-size: 10px;
        }
        .customerDiscountControls {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .customerDiscountControls select,
        .customerDiscountControls input {
          min-height: 34px;
          box-sizing: border-box;
          border: 1px solid #d9d2e8;
          border-radius: 7px;
          background: #fff;
          color: var(--text);
          font: inherit;
          font-size: 12px;
        }
        .customerDiscountControls select {
          width: 58px;
          padding: 6px 8px;
        }
        .customerDiscountControls input {
          width: 110px;
          padding: 6px 8px;
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
        .formRow select {
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
        .checkbox,
        .scopeNote {
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
        .listRow {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          padding-top: 7px;
          border-top: 1px solid #f0edf5;
        }
        .poseRow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          padding-top: 6px;
          border-top: 1px solid #f0edf5;
          font-size: 11px;
        }
        .poseRow span {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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
          .customerDiscount {
            align-items: flex-start;
            flex-direction: column;
          }
        }
      `}</style>
    </section>
  );
}

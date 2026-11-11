"use client";

import { CheckCircle2, Percent, Save, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { quoteHasCompleteWorkSchedule, resolveQuoteLineVatRate } from "@/lib/quotes/legal-details";
import type { QuoteLine } from "@/lib/quotes/model";
import { quoteRevisionHeaders } from "@/lib/quotes/concurrency";
import type { NativeQuoteRecord, NativeQuotesPayload } from "@/lib/quotes/store";

type LegalResponse = {
  payload?: NativeQuotesPayload;
  error?: string;
};

function rateInput(valeur: number): string {
  return String(valeur).replace(".", ",");
}

function parseRate(valeur: string): number | null {
  const analyse = Number(valeur.trim().replace(",", "."));
  return Number.isFinite(analyse) && analyse >= 0 && analyse <= 100 ? analyse : null;
}

function errorLabel(code: string): string {
  if (code === "QUOTE_VERSION_CONFLICT")
    return "Ce devis a été modifié ailleurs. Recharge-le avant de recommencer.";
  if (code === "QUOTE_NOT_EDITABLE") return "Seul un devis brouillon peut être modifié.";
  if (code === "QUOTE_WORK_END_BEFORE_START") {
    return "La date de fin ne peut pas être antérieure au début des travaux.";
  }
  if (code === "QUOTE_LINE_NOT_FOUND") return "Cette ligne de devis n’existe plus.";
  if (code === "QUOTE_LEGAL_DETAILS_INVALID") return "Vérifie les informations saisies.";
  return "Les données légales du devis n’ont pas pu être enregistrées.";
}

export function QuoteLegalDetailsEditor({
  quote,
  canWrite,
  onSaved,
}: {
  quote: NativeQuoteRecord;
  canWrite: boolean;
  onSaved: (contenu: NativeQuotesPayload) => void;
}) {
  const editable = canWrite && quote.status === "DRAFT";
  const lignes = useMemo(
    () => quote.model.items.filter((element): element is QuoteLine => element.kind === "LINE"),
    [quote.model.items],
  );
  const [startDate, setStartDate] = useState(quote.workSchedule.startDate ?? "");
  const [duration, setDuration] = useState(quote.workSchedule.duration);
  const [endDate, setEndDate] = useState(quote.workSchedule.endDate ?? "");
  const [rates, setRates] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lignes.map((ligne) => [ligne.id, rateInput(resolveQuoteLineVatRate(quote, ligne.id))]),
    ),
  );
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [manageLineVat, setManageLineVat] = useState(false);
  const [erreur, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setStartDate(quote.workSchedule.startDate ?? "");
    setDuration(quote.workSchedule.duration);
    setEndDate(quote.workSchedule.endDate ?? "");
    setRates(
      Object.fromEntries(
        lignes.map((ligne) => [ligne.id, rateInput(resolveQuoteLineVatRate(quote, ligne.id))]),
      ),
    );
  }, [lignes, quote]);

  useEffect(() => {
    setManageLineVat(false);
  }, [quote.id]);

  async function patch(corps: Record<string, unknown>) {
    const reponse = await fetch(`/api/desktop/quotes/${quote.id}/legal`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...quoteRevisionHeaders(quote.updatedAt),
      },
      body: JSON.stringify(corps),
    });
    const donnees = (await reponse.json()) as LegalResponse;
    if (!reponse.ok || !donnees.payload)
      throw new Error(donnees.error ?? "QUOTE_LEGAL_UPDATE_FAILED");
    onSaved(donnees.payload);
    return donnees.payload;
  }

  async function saveSchedule() {
    if (!editable || savingSchedule) return;
    if (!startDate || !duration.trim() || !endDate) {
      setError("Début, durée et fin / date limite des travaux sont obligatoires.");
      return;
    }
    setSavingSchedule(true);
    setError("");
    setNotice("");
    try {
      await patch({
        action: "updateWorkSchedule",
        schedule: { startDate, duration, endDate },
      });
      setNotice("Début, durée et fin des travaux enregistrés.");
    } catch (saveError) {
      setError(
        errorLabel(saveError instanceof Error ? saveError.message : "QUOTE_LEGAL_UPDATE_FAILED"),
      );
    } finally {
      setSavingSchedule(false);
    }
  }

  async function saveLineRate(lineId: string, reset = false, nextValue?: string) {
    if (!editable || savingLineId) return;
    const analyse = reset
      ? quote.taxConfig.defaultRatePercent
      : parseRate(nextValue ?? rates[lineId] ?? "");
    if (analyse === null) {
      setError("Le taux de TVA doit être compris entre 0 et 100 %.");
      return;
    }
    setSavingLineId(lineId);
    setError("");
    setNotice("");
    try {
      const contenu = await patch({
        action: "setLineVatRate",
        lineId,
        ratePercent: analyse === quote.taxConfig.defaultRatePercent ? null : analyse,
      });
      const updated = contenu.quotes.find((candidat) => candidat.id === quote.id);
      if (updated) {
        setRates((courant) => ({
          ...courant,
          [lineId]: rateInput(resolveQuoteLineVatRate(updated, lineId)),
        }));
      }
      setNotice("TVA de la ligne enregistrée.");
    } catch (saveError) {
      setError(
        errorLabel(saveError instanceof Error ? saveError.message : "QUOTE_LEGAL_UPDATE_FAILED"),
      );
    } finally {
      setSavingLineId(null);
    }
  }

  const scheduleReady = quoteHasCompleteWorkSchedule(quote);

  return (
    <section className="panel quoteLegalPanel" aria-label="Données légales et TVA du devis">
      <div className="quoteLegalHeading">
        <div>
          <p className="eyebrow">Préparation du PDF</p>
          <h3>Données légales et TVA</h3>
          <p className="muted">
            Le PDF final utilisera ces informations. Le taux client est la valeur par défaut et les
            exceptions restent attachées à chaque ligne.
          </p>
        </div>
        <span className={`quoteLegalStatus${scheduleReady ? " isReady" : " isMissing"}`}>
          {scheduleReady ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
          {scheduleReady ? "Délais renseignés" : "Délais à compléter"}
        </span>
      </div>

      <div className="quoteLegalSchedule">
        <label>
          <span>Début des travaux</span>
          <input
            type="date"
            value={startDate}
            onChange={(evenement) => setStartDate(evenement.target.value)}
            disabled={!editable || savingSchedule}
          />
        </label>
        <label>
          <span>Durée prévisionnelle</span>
          <input
            value={duration}
            onChange={(evenement) => setDuration(evenement.target.value)}
            placeholder="Ex. 3 semaines"
            maxLength={240}
            disabled={!editable || savingSchedule}
          />
        </label>
        <label>
          <span>Fin / date limite des travaux</span>
          <input
            type="date"
            value={endDate}
            onChange={(evenement) => setEndDate(evenement.target.value)}
            disabled={!editable || savingSchedule}
          />
        </label>
        {editable ? (
          <button
            className="primaryButton quoteLegalSaveSchedule"
            type="button"
            onClick={() => void saveSchedule()}
            disabled={savingSchedule}
          >
            <Save size={14} /> {savingSchedule ? "Enregistrement…" : "Enregistrer les délais"}
          </button>
        ) : null}
      </div>

      <div className="quoteVatSection">
        <div className="quoteVatTitle">
          <div>
            <Percent size={16} aria-hidden="true" />
            <strong>TVA</strong>
            <span className="quoteVatDefault">
              {rateInput(quote.taxConfig.defaultRatePercent)} % par défaut
            </span>
          </div>
          <label className="quoteVatToggle">
            <input
              type="checkbox"
              checked={manageLineVat}
              onChange={(evenement) => setManageLineVat(evenement.target.checked)}
              disabled={lignes.length === 0}
            />
            <span>TVA différente par ligne</span>
          </label>
        </div>

        {!manageLineVat ? (
          <p className="muted quoteVatCollapsed">
            {quote.taxConfig.lineOverrides.length > 0
              ? `${quote.taxConfig.lineOverrides.length} taux spécifique${quote.taxConfig.lineOverrides.length > 1 ? "s" : ""} enregistré${quote.taxConfig.lineOverrides.length > 1 ? "s" : ""}.`
              : "Toutes les lignes utilisent le taux client par défaut."}
          </p>
        ) : lignes.length === 0 ? (
          <p className="muted quoteVatEmpty">Ajoute un ouvrage pour régler sa TVA.</p>
        ) : (
          <div className="quoteVatRows">
            {lignes.map((ligne) => {
              const overridden = quote.taxConfig.lineOverrides.some(
                (override) => override.lineId === ligne.id,
              );
              return (
                <div className="quoteVatRow" key={ligne.id}>
                  <div>
                    <strong>{ligne.description}</strong>
                    <small>{overridden ? "Taux spécifique" : "Taux client par défaut"}</small>
                  </div>
                  <label>
                    <span className="srOnly">TVA de {ligne.description}</span>
                    <select
                      value={rates[ligne.id] ?? rateInput(quote.taxConfig.defaultRatePercent)}
                      onChange={(evenement) => {
                        const suivant = evenement.target.value;
                        setRates((courant) => ({ ...courant, [ligne.id]: suivant }));
                        void saveLineRate(ligne.id, false, suivant);
                      }}
                      disabled={!editable || savingLineId !== null}
                      aria-label={`TVA de ${ligne.description}`}
                    >
                      {[0, 2.1, 5.5, 10, 20]
                        .map(rateInput)
                        .filter(
                          (rate, indice, all) =>
                            all.indexOf(rate) === indice || rate === rates[ligne.id],
                        )
                        .map((rate) => (
                          <option key={rate} value={rate}>
                            {rate} %
                          </option>
                        ))}
                      {!["0", "2,1", "5,5", "10", "20"].includes(
                        rates[ligne.id] ?? rateInput(quote.taxConfig.defaultRatePercent),
                      ) ? (
                        <option value={rates[ligne.id]}>{rates[ligne.id]} %</option>
                      ) : null}
                    </select>
                  </label>
                  {editable && overridden ? (
                    <div className="quoteVatActions">
                      <button
                        className="secondaryButton"
                        type="button"
                        onClick={() => void saveLineRate(ligne.id, true)}
                        disabled={savingLineId !== null}
                      >
                        Défaut
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {erreur ? <div className="quoteLegalMessage isError">{erreur}</div> : null}
      {notice ? <div className="quoteLegalMessage isSuccess">{notice}</div> : null}

      <style jsx>{`
        .quoteLegalPanel {
          padding: 16px 18px;
          display: grid;
          gap: 14px;
        }
        .quoteLegalHeading,
        .quoteVatTitle,
        .quoteVatRow,
        .quoteVatActions {
          display: flex;
          align-items: center;
        }
        .quoteLegalHeading {
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--border);
        }
        .quoteLegalHeading h3,
        .quoteLegalHeading p {
          margin-bottom: 3px;
        }
        .quoteLegalHeading .muted {
          max-width: 760px;
        }
        .quoteLegalStatus {
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 9px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 800;
        }
        .quoteLegalStatus.isReady {
          background: #eaf7ef;
          color: #347850;
        }
        .quoteLegalStatus.isMissing {
          background: #fff2df;
          color: #9a641f;
        }
        .quoteLegalSchedule {
          display: grid;
          grid-template-columns: minmax(160px, 1fr) minmax(200px, 1.4fr) minmax(180px, 1fr) auto;
          gap: 10px;
          align-items: end;
        }
        .quoteLegalSchedule label {
          display: grid;
          gap: 5px;
        }
        .quoteLegalSchedule label > span {
          color: var(--muted);
          font-size: 11px;
          font-weight: 750;
        }
        .quoteLegalSchedule input {
          min-height: 38px;
        }
        .quoteLegalSaveSchedule {
          min-height: 38px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .quoteVatSection {
          display: grid;
          gap: 9px;
          padding-top: 4px;
        }
        .quoteVatTitle {
          justify-content: space-between;
          gap: 12px;
        }
        .quoteVatTitle > div {
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }
        .quoteVatTitle > span {
          color: var(--muted);
          font-size: 11px;
        }
        .quoteVatToggle {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          padding: 10px 11px;
          border: 1px solid #e3ddea;
          border-radius: 10px;
          background: #faf9fb;
          cursor: pointer;
        }
        .quoteVatToggle input {
          margin-top: 2px;
        }
        .quoteVatToggle span {
          display: grid;
          gap: 2px;
        }
        .quoteVatToggle small {
          color: #7a7280;
          font-size: 11px;
        }
        .quoteVatCollapsed {
          margin: 0;
          font-size: 11px;
        }
        .quoteVatRows {
          display: grid;
          gap: 6px;
        }
        .quoteVatRow {
          min-height: 48px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 110px auto;
          gap: 10px;
          padding: 7px 9px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #fff;
        }
        .quoteVatRow > div:first-child {
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .quoteVatRow > div:first-child strong {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
        }
        .quoteVatRow small {
          color: var(--muted);
          font-size: 10px;
        }
        .quoteVatRow label {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .quoteVatRow label input {
          width: 82px;
          min-height: 34px;
          text-align: right;
        }
        .quoteVatRow label b {
          font-size: 11px;
        }
        .quoteVatActions {
          gap: 5px;
        }
        .quoteVatActions button {
          min-height: 34px;
          padding: 0 8px;
          font-size: 10px;
        }
        .quoteVatEmpty {
          margin: 0;
        }
        .quoteLegalMessage {
          padding: 8px 10px;
          border-radius: 7px;
          font-size: 12px;
        }
        .quoteLegalMessage.isError {
          background: #fff0f0;
          color: #9c3434;
        }
        .quoteLegalMessage.isSuccess {
          background: #eff9f3;
          color: #347850;
        }
        .srOnly {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        @media (max-width: 900px) {
          .quoteLegalSchedule,
          .quoteVatRow {
            grid-template-columns: 1fr;
          }
          .quoteVatActions {
            justify-content: flex-start;
          }
        }
      `}</style>
    </section>
  );
}

"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { productionActivityLabel } from "@/lib/production-activity";
import { calculateQuoteComponentCheck } from "@/lib/quotes/component-check";
import type { NativeQuoteRecord } from "@/lib/quotes/store";

const quantityFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const hourFormatter = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatQuantity(value: number): string {
  return quantityFormatter.format(value);
}

function formatHours(value: number): string {
  return `${hourFormatter.format(value)} h`;
}

export function QuoteComponentCheck({ quote }: { quote: NativeQuoteRecord }) {
  const [open, setOpen] = useState(false);
  const check = useMemo(
    () => calculateQuoteComponentCheck(quote.model.items, quote.pricingConfig),
    [quote.model.items, quote.pricingConfig],
  );

  const hasPendingOptions =
    check.pendingOptionHours.total > 0 || check.rows.some((row) => row.pendingOptionQuantity > 0);
  const hasRejectedOptions =
    check.rejectedOptionHours.total > 0 || check.rows.some((row) => row.rejectedOptionQuantity > 0);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button type="button" className="secondaryButton" onClick={() => setOpen(true)}>
        Σ Composants
      </button>

      {open ? (
        <div
          className="quoteCheckBackdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            className="quoteCheckDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quote-component-check-title"
          >
            <div className="quoteCheckHeader">
              <div>
                <h2 id="quote-component-check-title">Contrôle du devis</h2>
                <p>
                  Cumul des composants de tous les ouvrages, multiplié par la quantité de chaque
                  ouvrage.
                </p>
              </div>
              <button
                type="button"
                className="quoteCheckClose"
                onClick={() => setOpen(false)}
                aria-label="Fermer le contrôle"
                title="Fermer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="quoteCheckHours" aria-label="Heures prévues pour le chantier">
              <div className="quoteCheckHourCard isTotal">
                <span>Total heures</span>
                <strong>{formatHours(check.plannedHours.total)}</strong>
              </div>
              <div className="quoteCheckHourCard">
                <span>BE</span>
                <strong>{formatHours(check.plannedHours.be)}</strong>
              </div>
              <div className="quoteCheckHourCard">
                <span>Atelier</span>
                <strong>{formatHours(check.plannedHours.atelier)}</strong>
              </div>
              <div className="quoteCheckHourCard">
                <span>Pose</span>
                <strong>{formatHours(check.plannedHours.pose)}</strong>
              </div>
            </div>

            {hasPendingOptions ? (
              <div className="quoteCheckNotice">
                Options en attente non comptées dans le prévu chantier :{" "}
                <strong>{formatHours(check.pendingOptionHours.total)}</strong>.
              </div>
            ) : null}

            <div className="quoteCheckTableWrap">
              <table className="quoteCheckTable">
                <thead>
                  <tr>
                    <th>Composant</th>
                    <th>Activité</th>
                    <th>Unité</th>
                    <th className="isNumber">Prévu chantier</th>
                    {hasPendingOptions ? <th className="isNumber">Options en attente</th> : null}
                    {hasRejectedOptions ? <th className="isNumber">Options refusées</th> : null}
                    <th className="isNumber">Ouvrages</th>
                  </tr>
                </thead>
                <tbody>
                  {check.rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="quoteCheckEmpty">
                        Aucun composant n’est encore renseigné dans ce devis.
                      </td>
                    </tr>
                  ) : (
                    check.rows.map((row) => (
                      <tr key={row.key}>
                        <td className="quoteCheckName">{row.name}</td>
                        <td>{row.activity ? productionActivityLabel(row.activity) : "—"}</td>
                        <td>{row.unit || "u"}</td>
                        <td className="isNumber isStrong">{formatQuantity(row.plannedQuantity)}</td>
                        {hasPendingOptions ? (
                          <td className="isNumber">
                            {row.pendingOptionQuantity > 0
                              ? formatQuantity(row.pendingOptionQuantity)
                              : "—"}
                          </td>
                        ) : null}
                        {hasRejectedOptions ? (
                          <td className="isNumber">
                            {row.rejectedOptionQuantity > 0
                              ? formatQuantity(row.rejectedOptionQuantity)
                              : "—"}
                          </td>
                        ) : null}
                        <td className="isNumber">{row.ouvrageCount}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="quoteCheckFootnote">
              <span>
                Les options retenues sont incluses dans « Prévu chantier ». Les options en attente
                et refusées restent séparées pour éviter de gonfler les besoins réels.
              </span>
              <span>
                Les heures de pose ajoutées dans les ajustements sont incluses dans le total Pose,
                même si elles ne correspondent pas à une quantité de composant précise.
              </span>
            </div>
          </section>

          <style jsx>{`
            .quoteCheckBackdrop {
              position: fixed;
              inset: 0;
              z-index: 1000;
              display: grid;
              place-items: center;
              padding: 24px;
              background: rgba(15, 23, 42, 0.42);
            }
            .quoteCheckDialog {
              width: min(1100px, 96vw);
              max-height: min(860px, 92vh);
              overflow: auto;
              border: 1px solid #ddd6fe;
              border-radius: 16px;
              background: #fff;
              box-shadow: 0 28px 70px rgba(15, 23, 42, 0.22);
            }
            .quoteCheckHeader {
              position: sticky;
              top: 0;
              z-index: 2;
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 18px;
              padding: 18px 20px 14px;
              border-bottom: 1px solid #ede9fe;
              background: rgba(255, 255, 255, 0.96);
              backdrop-filter: blur(8px);
            }
            .quoteCheckHeader h2 {
              margin: 0;
              font-size: 19px;
              color: #312e81;
            }
            .quoteCheckHeader p {
              margin: 5px 0 0;
              color: #64748b;
              font-size: 13px;
            }
            .quoteCheckClose {
              display: inline-grid;
              place-items: center;
              width: 34px;
              height: 34px;
              border: 1px solid #ddd6fe;
              border-radius: 9px;
              background: #fff;
              color: #4c1d95;
              cursor: pointer;
            }
            .quoteCheckHours {
              display: grid;
              grid-template-columns: repeat(4, minmax(0, 1fr));
              gap: 10px;
              padding: 16px 20px 10px;
            }
            .quoteCheckHourCard {
              display: grid;
              gap: 4px;
              padding: 12px 14px;
              border: 1px solid #e2e8f0;
              border-radius: 11px;
              background: #f8fafc;
            }
            .quoteCheckHourCard.isTotal {
              border-color: #c4b5fd;
              background: #f5f3ff;
            }
            .quoteCheckHourCard span {
              color: #64748b;
              font-size: 12px;
              font-weight: 700;
            }
            .quoteCheckHourCard strong {
              color: #111827;
              font-size: 20px;
            }
            .quoteCheckNotice {
              margin: 4px 20px 12px;
              padding: 9px 12px;
              border: 1px solid #fde68a;
              border-radius: 9px;
              background: #fffbeb;
              color: #92400e;
              font-size: 12px;
            }
            .quoteCheckTableWrap {
              margin: 0 20px;
              overflow: auto;
              border: 1px solid #e2e8f0;
              border-radius: 12px;
            }
            .quoteCheckTable {
              width: 100%;
              min-width: 760px;
              border-collapse: collapse;
              font-size: 13px;
            }
            .quoteCheckTable th,
            .quoteCheckTable td {
              padding: 10px 12px;
              border-bottom: 1px solid #eef2f7;
              text-align: left;
              white-space: nowrap;
            }
            .quoteCheckTable th {
              position: sticky;
              top: 0;
              z-index: 1;
              background: #f8fafc;
              color: #475569;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
            }
            .quoteCheckTable tbody tr:last-child td {
              border-bottom: 0;
            }
            .quoteCheckTable tbody tr:hover td {
              background: #fafafa;
            }
            .quoteCheckTable .isNumber {
              text-align: right;
              font-variant-numeric: tabular-nums;
            }
            .quoteCheckTable .isStrong {
              font-weight: 800;
              color: #312e81;
            }
            .quoteCheckName {
              min-width: 260px;
              max-width: 480px;
              overflow: hidden;
              text-overflow: ellipsis;
              font-weight: 700;
              color: #1e293b;
            }
            .quoteCheckEmpty {
              padding: 26px !important;
              color: #64748b;
              text-align: center !important;
            }
            .quoteCheckFootnote {
              display: grid;
              gap: 5px;
              padding: 13px 20px 18px;
              color: #64748b;
              font-size: 11px;
              line-height: 1.45;
            }
            @media (max-width: 760px) {
              .quoteCheckBackdrop {
                padding: 8px;
              }
              .quoteCheckDialog {
                width: 100%;
                max-height: 96vh;
              }
              .quoteCheckHours {
                grid-template-columns: repeat(2, minmax(0, 1fr));
                padding-inline: 12px;
              }
              .quoteCheckTableWrap,
              .quoteCheckNotice {
                margin-inline: 12px;
              }
              .quoteCheckHeader,
              .quoteCheckFootnote {
                padding-inline: 12px;
              }
            }
          `}</style>
        </div>
      ) : null}
    </>
  );
}

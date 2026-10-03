"use client";

import Link from "next/link";
import { AlertTriangle, BadgeEuro, Clock3, ReceiptText, TrendingUp } from "lucide-react";
import type { ChantierRecord } from "@/lib/chantiers/domain";
import {
  calculateChantierProfitability,
  type ChantierActualCostSnapshot,
} from "@/lib/chantiers/profitability";
import type { CommercialCase } from "@/lib/commercial/domain";
import type { NativeQuotesPayload } from "@/lib/quotes/store";

const moneyFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const numberFormatter = new Intl.NumberFormat("fr-FR", {
  maximumFractionDigits: 2,
});

function money(value: number | null): string {
  return value === null ? "Non disponible" : moneyFormatter.format(value / 100);
}

function percent(value: number | null): string {
  return value === null ? "" : numberFormatter.format(value) + " %";
}

function hours(value: number): string {
  return numberFormatter.format(value) + " h";
}

function tone(value: number | null): string {
  if (value === null) return "isNeutral";
  return value < 0 ? "isNegative" : "isPositive";
}

export function ChantierProfitabilityPanel({
  chantier,
  commercialCase,
  quotes,
  actualCosts,
}: {
  chantier: ChantierRecord;
  commercialCase: CommercialCase | null;
  quotes: NativeQuotesPayload;
  actualCosts?: ChantierActualCostSnapshot;
}) {
  const result = calculateChantierProfitability(chantier, commercialCase, quotes, actualCosts);

  return (
    <section className="chantierProfitability">
      <header className="chantierProfitabilityHeader">
        <BadgeEuro size={19} />
        <div>
          <strong>Rentabilité globale du chantier</strong>
          <span>Vendu, déboursé, heures et coûts réels, sans rentabilité ligne par ligne.</span>
        </div>
      </header>

      {result.missingRetainedQuoteIds.length > 0 ? (
        <div className="chantierProfitabilityWarning">
          <AlertTriangle size={15} />
          Un devis retenu n&apos;est plus résolu. Les montants globaux sont masqués pour éviter un
          total partiel trompeur.
        </div>
      ) : null}

      <div className="chantierProfitabilityCards">
        <Metric
          label="Vendu HT"
          value={money(result.soldCents)}
          detail={
            result.soldCents === null
              ? "Aucun devis natif retenu exploitable"
              : result.retainedQuotes.length + " devis / TS retenu(s)"
          }
        />
        <Metric
          label="Déboursé prévu"
          value={money(result.plannedDisbursementCents)}
          detail={
            result.plannedDisbursementCents === null
              ? "Coûts prévus incomplets, aucune estimation inventée"
              : "Calculé depuis les devis retenus"
          }
        />
        <Metric
          label="Marge prévue"
          value={money(result.plannedMarginCents)}
          detail={
            result.plannedMarginCents === null
              ? "Non calculable avec les données actuelles"
              : percent(result.plannedMarginPercent)
          }
          className={tone(result.plannedMarginCents)}
        />
        <Metric
          label="Marge réelle"
          value={money(result.actualMarginCents)}
          detail={
            result.actualMarginCents === null
              ? "En attente des coûts réels Heures + Achats"
              : percent(result.actualMarginPercent)
          }
          className={tone(result.actualMarginCents) + " isStrong"}
        />
      </div>

      <div className="chantierProfitabilityColumns">
        <section className="chantierProfitabilityBlock">
          <BlockTitle
            icon={<Clock3 size={16} />}
            title="Heures chantier"
            subtitle="Heures vendues des devis / TS retenus et réalisé actuellement enregistré."
          />
          <div className="chantierProfitabilityRows">
            <HoursRow label="BE" planned={result.plannedHours.be} actual={result.actualHours.be} />
            <HoursRow
              label="Atelier"
              planned={result.plannedHours.workshop}
              actual={result.actualHours.workshop}
            />
            <HoursRow
              label="Pose"
              planned={result.plannedHours.install}
              actual={result.actualHours.install}
            />
            <HoursRow
              label="Total"
              planned={result.plannedHours.total}
              actual={result.actualHours.total}
              total
            />
          </div>
        </section>

        <section className="chantierProfitabilityBlock">
          <BlockTitle
            icon={<ReceiptText size={16} />}
            title="Coûts réels"
            subtitle="Un coût n'est pris en compte que lorsqu'une vraie source le fournit."
          />
          <div className="chantierProfitabilityRows">
            <CostRow
              label="Heures réelles valorisées"
              value={result.actualLaborCostCents}
              missing="Module Heures / coûts mensuels non raccordé"
            />
            <CostRow
              label="Achats / commandes"
              value={result.actualPurchaseCostCents}
              missing="Module Achats / commandes non raccordé"
            />
            <CostRow
              label="Total coûts réels"
              value={result.actualTotalCostCents}
              missing="Disponible quand les deux sources sont complètes"
              total
            />
          </div>
          <p className="chantierProfitabilityNote">
            Le coût des heures réelles ne reprend jamais le coût horaire prévu du devis. Il attend
            le coût horaire réel du mois de chaque personne.
          </p>
        </section>
      </div>

      <section className="chantierProfitabilityBlock">
        <BlockTitle
          icon={<TrendingUp size={16} />}
          title="Composition du vendu"
          subtitle="Contrôle par devis retenu, sans ventilation de marge par ligne."
        />
        {result.retainedQuotes.length === 0 ? (
          <div className="chantierProfitabilityEmpty">Aucun devis natif retenu à afficher.</div>
        ) : (
          <div className="chantierProfitabilityQuotes">
            {result.retainedQuotes.map((quote) => (
              <article key={quote.quoteId}>
                <div>
                  <strong>
                    {quote.quoteKind === "TS" ? "TS · " : ""}
                    {quote.quoteNumber ?? quote.subject}
                  </strong>
                  <span>
                    {quote.subject} · {quote.variantName} · V{quote.version}
                  </span>
                </div>
                <div className="chantierProfitabilityQuoteMoney">
                  <span>
                    Vendu <b>{money(quote.saleCents)}</b>
                  </span>
                  <span>
                    Déboursé <b>{money(quote.plannedDisbursementCents)}</b>
                  </span>
                </div>
                <Link href={"/devis/" + quote.quoteId}>Ouvrir</Link>
              </article>
            ))}
          </div>
        )}
      </section>

      <style jsx>{`
        .chantierProfitability {
          display: grid;
          gap: 12px;
        }
        .chantierProfitabilityHeader {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #6251ba;
        }
        .chantierProfitabilityHeader > div {
          display: grid;
          gap: 2px;
        }
        .chantierProfitabilityHeader strong {
          color: #4f4956;
          font-size: 16px;
        }
        .chantierProfitabilityHeader span {
          color: #817b88;
          font-size: 11px;
        }
        .chantierProfitabilityWarning {
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #efd19c;
          border-radius: 9px;
          background: #fffaf0;
          color: #9a6418;
          font-size: 11px;
        }
        .chantierProfitabilityCards {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        .chantierProfitabilityColumns {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .chantierProfitabilityBlock {
          padding: 12px;
          display: grid;
          gap: 10px;
          border: 1px solid #e7e2ed;
          border-radius: 10px;
          background: white;
        }
        .chantierProfitabilityRows {
          display: grid;
          gap: 4px;
        }
        .chantierProfitabilityNote {
          margin: 0;
          color: #8a8390;
          font-size: 10px;
          line-height: 1.45;
        }
        .chantierProfitabilityQuotes {
          display: grid;
          gap: 6px;
        }
        .chantierProfitabilityQuotes article {
          padding: 9px 10px;
          display: grid;
          grid-template-columns: minmax(180px, 1fr) auto auto;
          gap: 12px;
          align-items: center;
          border: 1px solid #ece8f0;
          border-radius: 8px;
          background: #fdfcff;
        }
        .chantierProfitabilityQuotes article > div:first-child {
          min-width: 0;
          display: grid;
          gap: 2px;
        }
        .chantierProfitabilityQuotes article > div:first-child span {
          overflow: hidden;
          color: #8b8491;
          font-size: 10px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .chantierProfitabilityQuoteMoney {
          display: grid;
          grid-template-columns: auto auto;
          gap: 12px;
          color: #817a87;
          font-size: 10px;
        }
        .chantierProfitabilityQuoteMoney span {
          display: grid;
          gap: 2px;
        }
        .chantierProfitabilityQuoteMoney b {
          color: #554e5b;
          font-size: 11px;
        }
        .chantierProfitabilityQuotes a {
          min-height: 31px;
          padding: 0 9px;
          display: inline-flex;
          align-items: center;
          border: 1px solid #b2a4e4;
          border-radius: 7px;
          background: #f8f5ff;
          color: #6552bf;
          font-size: 10px;
          font-weight: 750;
          text-decoration: none;
        }
        .chantierProfitabilityEmpty {
          padding: 18px;
          border: 1px dashed #ddd7e4;
          border-radius: 8px;
          color: #8e8794;
          font-size: 11px;
          text-align: center;
        }
        @media (max-width: 980px) {
          .chantierProfitabilityCards {
            grid-template-columns: 1fr 1fr;
          }
          .chantierProfitabilityColumns {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 680px) {
          .chantierProfitabilityCards {
            grid-template-columns: 1fr;
          }
          .chantierProfitabilityQuotes article {
            grid-template-columns: 1fr;
          }
          .chantierProfitabilityQuoteMoney {
            grid-template-columns: 1fr 1fr;
          }
        }
      `}</style>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  className = "",
}: {
  label: string;
  value: string;
  detail: string;
  className?: string;
}) {
  return (
    <div className={"chantierProfitabilityMetric " + className}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <style jsx>{`
        .chantierProfitabilityMetric {
          min-height: 102px;
          padding: 12px;
          display: grid;
          align-content: center;
          gap: 5px;
          border: 1px solid #e7e2ed;
          border-radius: 10px;
          background: white;
        }
        .chantierProfitabilityMetric > span {
          color: #77707d;
          font-size: 10px;
          font-weight: 800;
        }
        .chantierProfitabilityMetric > strong {
          color: #4c4652;
          font-size: 20px;
          font-variant-numeric: tabular-nums;
        }
        .chantierProfitabilityMetric > small {
          color: #918a96;
          font-size: 9px;
          line-height: 1.35;
        }
        .chantierProfitabilityMetric.isStrong {
          border-color: #cfc4f0;
          background: #faf8ff;
        }
        .chantierProfitabilityMetric.isPositive > strong {
          color: #377852;
        }
        .chantierProfitabilityMetric.isNegative {
          border-color: #edc8c0;
          background: #fff8f6;
        }
        .chantierProfitabilityMetric.isNegative > strong {
          color: #b14f3c;
        }
      `}</style>
    </div>
  );
}

function BlockTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="chantierProfitabilityBlockTitle">
      {icon}
      <span>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <style jsx>{`
        .chantierProfitabilityBlockTitle {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #6251ba;
        }
        .chantierProfitabilityBlockTitle span {
          display: grid;
          gap: 2px;
        }
        .chantierProfitabilityBlockTitle strong {
          color: #514b58;
          font-size: 13px;
        }
        .chantierProfitabilityBlockTitle small {
          color: #817b88;
          font-size: 10px;
        }
      `}</style>
    </div>
  );
}

function HoursRow({
  label,
  planned,
  actual,
  total = false,
}: {
  label: string;
  planned: number;
  actual: number;
  total?: boolean;
}) {
  return (
    <div className={"chantierProfitabilityHoursRow" + (total ? " isTotal" : "")}>
      <strong>{label}</strong>
      <span>
        Vendu <b>{hours(planned)}</b>
      </span>
      <span>
        Réel <b>{hours(actual)}</b>
      </span>
      <style jsx>{`
        .chantierProfitabilityHoursRow {
          min-height: 34px;
          padding: 6px 8px;
          display: grid;
          grid-template-columns: minmax(80px, 1fr) auto auto;
          gap: 12px;
          align-items: center;
          border-bottom: 1px solid #f0edf3;
          font-size: 10px;
        }
        .chantierProfitabilityHoursRow > span {
          color: #817a87;
        }
        .chantierProfitabilityHoursRow b {
          margin-left: 4px;
          color: #554e5b;
        }
        .chantierProfitabilityHoursRow.isTotal {
          border-radius: 7px;
          background: #f8f5ff;
        }
      `}</style>
    </div>
  );
}

function CostRow({
  label,
  value,
  missing,
  total = false,
}: {
  label: string;
  value: number | null;
  missing: string;
  total?: boolean;
}) {
  return (
    <div className={"chantierProfitabilityCostRow" + (total ? " isTotal" : "")}>
      <strong>{label}</strong>
      <span className={value === null ? "isMissing" : undefined}>
        {value === null ? missing : money(value)}
      </span>
      <style jsx>{`
        .chantierProfitabilityCostRow {
          min-height: 38px;
          padding: 6px 8px;
          display: grid;
          grid-template-columns: minmax(140px, 0.8fr) minmax(180px, 1.2fr);
          gap: 10px;
          align-items: center;
          border-bottom: 1px solid #f0edf3;
          font-size: 10px;
        }
        .chantierProfitabilityCostRow > span {
          justify-self: end;
          color: #554e5b;
          font-weight: 750;
          text-align: right;
        }
        .chantierProfitabilityCostRow > span.isMissing {
          color: #9a7a45;
          font-weight: 650;
        }
        .chantierProfitabilityCostRow.isTotal {
          border-radius: 7px;
          background: #f8f5ff;
        }
      `}</style>
    </div>
  );
}

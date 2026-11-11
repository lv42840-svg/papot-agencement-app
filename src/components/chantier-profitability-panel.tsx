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

function money(valeur: number | null): string {
  return valeur === null ? "Non disponible" : moneyFormatter.format(valeur / 100);
}

function percent(valeur: number | null): string {
  return valeur === null ? "" : numberFormatter.format(valeur) + " %";
}

function hours(valeur: number): string {
  return numberFormatter.format(valeur) + " h";
}

function tone(valeur: number | null): string {
  if (valeur === null) return "isNeutral";
  return valeur < 0 ? "isNegative" : "isPositive";
}

export function ChantierProfitabilityPanel({
  chantier,
  commercialCase,
  quotes,
  actualCosts,
  actualLaborCostProvisional = false,
  committedPurchasesCents = null,
}: {
  chantier: ChantierRecord;
  commercialCase: CommercialCase | null;
  quotes: NativeQuotesPayload;
  actualCosts?: ChantierActualCostSnapshot;
  actualLaborCostProvisional?: boolean;
  committedPurchasesCents?: number | null;
}) {
  const resultat = calculateChantierProfitability(
    chantier,
    commercialCase,
    quotes,
    actualCosts,
    committedPurchasesCents,
  );

  return (
    <section className="chantierProfitability">
      <header className="chantierProfitabilityHeader">
        <BadgeEuro size={19} />
        <div>
          <strong>Rentabilité globale du chantier</strong>
          <span>Vendu, déboursé, heures et coûts réels, sans rentabilité ligne par ligne.</span>
        </div>
      </header>

      {resultat.missingRetainedQuoteIds.length > 0 ? (
        <div className="chantierProfitabilityWarning">
          <AlertTriangle size={15} />
          Un devis retenu n&apos;est plus résolu. Les montants globaux sont masqués pour éviter un
          total partiel trompeur.
        </div>
      ) : null}

      <h3 className="chantierProfitabilityCardsLabel">Prévisionnel depuis le devis</h3>
      <div className="chantierProfitabilityCards">
        <Metric
          label="Vendu prévu HT"
          value={money(resultat.soldCents)}
          detail={
            resultat.soldCents === null
              ? "Aucun devis natif retenu exploitable"
              : resultat.retainedQuotes.length + " devis / TS retenu(s)"
          }
        />
        <Metric
          label="Achats et frais prévus (hors heures)"
          value={money(resultat.plannedDisbursementCents)}
          detail={
            resultat.plannedDisbursementCents === null
              ? "Coûts prévus incomplets, aucune estimation inventée"
              : "Calculé depuis les devis retenus"
          }
        />
        <Metric
          label="Coût des heures prévues"
          value={money(resultat.plannedLaborCostCents)}
          detail={
            resultat.plannedLaborCostCents === null
              ? "Taux horaire manquant ou nul dans un devis : coût à compléter"
              : "BE, atelier et pose valorisés au taux du devis"
          }
        />
        <Metric
          label="Coût total prévu"
          value={money(resultat.plannedTotalCostCents)}
          detail="Achats, frais et heures du devis"
        />
        <Metric
          label="Marge prévue"
          value={money(resultat.plannedMarginCents)}
          detail={
            resultat.plannedMarginCents === null
              ? "Non calculable avec les données actuelles"
              : percent(resultat.plannedMarginPercent) + " · heures déjà déduites"
          }
          className={tone(resultat.plannedMarginCents)}
        />
      </div>

      <h3 className="chantierProfitabilityCardsLabel">Réalisé à ce jour</h3>
      <div className="chantierProfitabilityCards">
        <Metric
          label="Facturé client HT"
          value={money(resultat.actualRevenueCents)}
          detail={
            resultat.actualRevenueCents === null
              ? "Factures clients à raccorder à la comptabilité"
              : "Factures émises nettes des avoirs"
          }
        />
        <Metric
          label="Achats et frais réels HT"
          value={money(resultat.actualPurchaseCostCents)}
          detail="En attente du rapprochement Pennylane : factures fournisseurs validées"
        />
        <Metric
          label={
            actualLaborCostProvisional
              ? "Coût des heures réalisées · estimé"
              : "Coût des heures réalisées"
          }
          value={money(resultat.actualLaborCostCents)}
          detail={
            resultat.actualLaborCostCents === null
              ? "Coût employeur manquant pour un mois clos ou son mois précédent, ou accès Paie requis"
              : actualLaborCostProvisional
                ? "Mois en cours valorisé au taux du mois précédent"
                : "Heures saisies valorisées au coût employeur"
          }
        />
        <Metric
          label="Coût total réel"
          value={money(resultat.actualTotalCostCents)}
          detail="Disponible après validation des achats facturés"
        />
        <Metric
          label="Marge réelle"
          value={money(resultat.actualMarginCents)}
          detail="Non disponible avant rapprochement des factures"
          className={tone(resultat.actualMarginCents) + " isStrong"}
        />
      </div>
      <p className="chantierProfitabilityNote">
        Les BC engagés restent visibles dans les achats ci-dessous, sans être assimilés à des
        factures. Le coût horaire du mois en cours est une estimation jusqu’à saisie de la paie
        réelle.
      </p>

      <h3 className="chantierProfitabilityCardsLabel">Consommation du budget à date</h3>
      <div className="chantierProfitabilityCards">
        <Metric
          label="Heures réalisées + BC engagés"
          value={money(resultat.knownCostCommitmentsCents)}
          detail="Heures au coût employeur et BC HT, sans les assimiler à des factures"
        />
        <Metric
          label="Budget total restant à couvrir"
          value={money(resultat.remainingCostBudgetCents)}
          detail="Budget total du devis moins heures réalisées et BC engagés ; reste à produire non inclus"
          className={tone(resultat.remainingCostBudgetCents)}
        />
        <Metric
          label="Budget heures restant"
          value={money(resultat.remainingLaborBudgetCents)}
          detail="Coût des heures prévu moins coût des heures effectivement saisies"
          className={tone(resultat.remainingLaborBudgetCents)}
        />
      </div>
      {resultat.remainingCostBudgetCents !== null && resultat.remainingCostBudgetCents < 0 ? (
        <div className="chantierProfitabilityWarning" role="alert">
          <AlertTriangle size={15} />
          Dépassement du budget total de coûts de {money(-resultat.remainingCostBudgetCents)}
          avant même les travaux et achats restant à réaliser.
        </div>
      ) : null}
      {resultat.remainingLaborBudgetCents !== null && resultat.remainingLaborBudgetCents < 0 ? (
        <div className="chantierProfitabilityWarning" role="alert">
          <AlertTriangle size={15} />
          Dépassement du budget main-d&apos;œuvre de {money(-resultat.remainingLaborBudgetCents)}.
        </div>
      ) : null}
      <p className="chantierProfitabilityNote">
        Ce suivi de budget n&apos;est ni une marge à terminaison ni un résultat réel : les BC ne
        sont pas des factures, et les achats ou heures restant à faire sont exclus.
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Link
          href={`/achats?chantierId=${encodeURIComponent(chantier.id)}`}
          className="secondaryButton"
        >
          Nouveau bon de commande pour ce chantier
        </Link>
      </div>
      <div className="chantierProfitabilityColumns">
        <section className="chantierProfitabilityBlock">
          <BlockTitle
            icon={<Clock3 size={16} />}
            title="Heures prévues depuis le devis"
            subtitle="BE, atelier et pose des devis / TS retenus, comparés au temps réellement saisi."
          />
          <div className="chantierProfitabilityRows">
            <HoursRow
              label="BE"
              planned={resultat.plannedHours.be}
              actual={resultat.actualHours.be}
            />
            <HoursRow
              label="Atelier"
              planned={resultat.plannedHours.workshop}
              actual={resultat.actualHours.workshop}
            />
            <HoursRow
              label="Pose"
              planned={resultat.plannedHours.install}
              actual={resultat.actualHours.install}
            />
            <HoursRow
              label="Total"
              planned={resultat.plannedHours.total}
              actual={resultat.actualHours.total}
              total
            />
          </div>
        </section>

        <section className="chantierProfitabilityBlock">
          <BlockTitle
            icon={<ReceiptText size={16} />}
            title="Achats prévus extraits du devis"
            subtitle="Fournitures et prestations externes des devis / TS retenus, hors heures de travail."
          />
          <div className="chantierProfitabilityRows">
            <CostRow
              label="Budget d'achats identifiés HT"
              value={resultat.plannedPurchasesCents}
              missing="Budget incomplet : vérifier les composants non chiffrés ou non classés"
              total
            />
            <CostRow
              label="Achats engagés (BC) HT"
              value={resultat.committedPurchasesCents}
              missing="Accès au module Achats requis"
            />
            <CostRow
              label="Écart engagé - prévu HT"
              value={resultat.purchaseBudgetOverrunCents}
              missing="Écart indisponible si le devis ou les BC sont incomplets"
            />
            {resultat.purchaseBudgetOverrunCents !== null &&
            resultat.purchaseBudgetOverrunCents > 0 ? (
              <div className="chantierProfitabilityWarning">
                <AlertTriangle size={15} />
                Dépassement du budget achats : {money(resultat.purchaseBudgetOverrunCents)} HT
              </div>
            ) : null}
          </div>
          <div style={{ maxHeight: 340, overflow: "auto" }}>
            {resultat.plannedPurchaseLines.length === 0 ? (
              <p className="chantierProfitabilityNote">
                Aucun composant d&apos;achat identifié dans les devis retenus.
              </p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Devis / ouvrage</th>
                    <th style={{ textAlign: "left" }}>Achat prévu</th>
                    <th style={{ textAlign: "right" }}>Quantité</th>
                    <th style={{ textAlign: "right" }}>Coût HT</th>
                  </tr>
                </thead>
                <tbody>
                  {resultat.plannedPurchaseLines.map((element) => (
                    <tr key={`${element.quoteId}:${element.quoteLineId}:${element.componentId}`}>
                      <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                        <strong>{element.quoteReference}</strong>
                        <div>{element.quoteLineDescription}</div>
                      </td>
                      <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                        {element.description}
                      </td>
                      <td
                        style={{ padding: 6, borderBottom: "1px solid #eee", textAlign: "right" }}
                      >
                        {numberFormatter.format(element.quantity)} {element.unit}
                      </td>
                      <td
                        style={{ padding: 6, borderBottom: "1px solid #eee", textAlign: "right" }}
                      >
                        {money(element.totalCostCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {resultat.purchaseClassificationWarnings.length > 0 ? (
            <div className="chantierProfitabilityWarning">
              <AlertTriangle size={15} />
              <span>
                {resultat.purchaseClassificationWarnings.length} élément(s) à classer ou chiffrer :{" "}
                {resultat.purchaseClassificationWarnings
                  .map((warning) => `${warning.quoteReference} · ${warning.description}`)
                  .join(" ; ")}
              </span>
            </div>
          ) : null}
          <p className="chantierProfitabilityNote">
            Ce sont des achats prévus, pas des commandes passées. Les frais annexes et ajustements
            du devis peuvent rester dans le déboursé prévu sans figurer dans cette liste.
          </p>
        </section>
      </div>

      <section className="chantierProfitabilityBlock">
        <BlockTitle
          icon={<TrendingUp size={16} />}
          title="Composition du vendu"
          subtitle="Contrôle par devis retenu, sans ventilation de marge par ligne."
        />
        {resultat.retainedQuotes.length === 0 ? (
          <div className="chantierProfitabilityEmpty">Aucun devis natif retenu à afficher.</div>
        ) : (
          <div className="chantierProfitabilityQuotes">
            {resultat.retainedQuotes.map((quote) => (
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
        .chantierProfitabilityCardsLabel {
          margin: 4px 0 0;
          color: #6251ba;
          font-size: 12px;
          font-weight: 800;
        }
        .chantierProfitabilityCards {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
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
  label: libelle,
  value: valeur,
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
      <span>{libelle}</span>
      <strong>{valeur}</strong>
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
  title: titre,
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
        <strong>{titre}</strong>
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
  label: libelle,
  planned,
  actual: reel,
  total = false,
}: {
  label: string;
  planned: number;
  actual: number;
  total?: boolean;
}) {
  return (
    <div className={"chantierProfitabilityHoursRow" + (total ? " isTotal" : "")}>
      <strong>{libelle}</strong>
      <span>
        Vendu <b>{hours(planned)}</b>
      </span>
      <span>
        Réel <b>{hours(reel)}</b>
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
  label: libelle,
  value: valeur,
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
      <strong>{libelle}</strong>
      <span className={valeur === null ? "isMissing" : undefined}>
        {valeur === null ? missing : money(valeur)}
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

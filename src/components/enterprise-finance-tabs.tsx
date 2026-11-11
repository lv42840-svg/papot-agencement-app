"use client";

import { useEffect, useState, type ReactNode } from "react";
import { parisCurrentMonth } from "@/lib/payroll/monthly-labor-costs";
import type { MonthlyFinancialResult } from "@/lib/pilotage/monthly-financial-result";
import type { MonthlyConsumption } from "@/lib/pilotage/monthly-consumption";

type MonthlyPosition = {
  month: string;
  asOf: string;
  sourcesConnected: boolean;
  financial: MonthlyFinancialResult;
  commitments: {
    chantierCents: number;
    savCents: number;
    generalExpensesCents: number;
    totalCents: number;
  } | null;
  consumption: MonthlyConsumption | null;
  canReadPurchases: boolean;
  canReadPlanning: boolean;
  canReadPayroll: boolean;
};

const money = (valeur: number | null | undefined) =>
  valeur == null
    ? "Non disponible"
    : (valeur / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const heures = (valeur: number | undefined) =>
  valeur === undefined
    ? "Non disponible"
    : `${valeur.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;

export function EnterpriseFinanceTabs({ chantierView }: { chantierView: ReactNode }) {
  const [tab, setTab] = useState<"monthly" | "chantiers">("monthly");
  return (
    <div>
      <nav
        aria-label="Vues de rentabilité"
        style={{ display: "flex", gap: 10, padding: "18px 22px", flexWrap: "wrap" }}
      >
        <button
          type="button"
          className={tab === "monthly" ? "primaryButton" : "secondaryButton"}
          aria-pressed={tab === "monthly"}
          onClick={() => setTab("monthly")}
        >
          Situation mensuelle entreprise
        </button>
        <button
          type="button"
          className={tab === "chantiers" ? "primaryButton" : "secondaryButton"}
          aria-pressed={tab === "chantiers"}
          onClick={() => setTab("chantiers")}
        >
          Budgets et suivi des chantiers
        </button>
      </nav>
      {tab === "monthly" ? (
        <MonthlyCompanyPosition />
      ) : (
        <>
          <p style={{ margin: "0 22px 16px" }}>
            Suivi cumulé des chantiers : devis prévisionnels, heures consommées et commandes
            engagées. Cette vue ne constitue pas le résultat mensuel de l’entreprise.
          </p>
          {chantierView}
        </>
      )}
    </div>
  );
}

function MonthlyCompanyPosition() {
  const [mois, setMonth] = useState(() => parisCurrentMonth());
  const [revision, setRevision] = useState(0);
  const [donnees, setData] = useState<MonthlyPosition | null>(null);
  const [erreur, setError] = useState<{ month: string; text: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const reponse = await fetch(
          `/api/desktop/pilotage/monthly-position?month=${encodeURIComponent(mois)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!reponse.ok)
          throw new Error("Situation mensuelle indisponible. Vérifie tes droits puis actualise.");
        const resultat = (await reponse.json()) as MonthlyPosition;
        if (!controller.signal.aborted) {
          setData(resultat);
          setError(null);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setData(null);
          setError({
            month: mois,
            text: cause instanceof Error ? cause.message : "Chargement impossible.",
          });
        }
      }
    })();
    return () => controller.abort();
  }, [mois, revision]);
  const courant = donnees?.month === mois ? donnees : null;
  const activeError = erreur?.month === mois ? erreur.text : null;
  const financial = courant?.financial;
  const lignesTableau = courant
    ? [
        {
          label: "Chantiers, y compris fermés, archivés et annulés",
          consumption: courant.consumption?.chantier,
          commitment: courant.commitments?.chantierCents,
        },
        {
          label: "SAV",
          consumption: courant.consumption?.sav,
          commitment: courant.commitments?.savCents,
        },
        {
          label: "Frais généraux",
          consumption: courant.consumption?.generalExpenses,
          commitment: courant.commitments?.generalExpensesCents,
        },
        {
          label: "Total unique",
          consumption: courant.consumption?.total,
          commitment: courant.commitments?.totalCents,
        },
      ]
    : [];
  return (
    <main style={{ padding: 22, maxWidth: 1480, margin: "0 auto", display: "grid", gap: 18 }}>
      <header>
        <h1>Situation mensuelle entreprise</h1>
        <p>
          Les factures réelles du mois sont distinctes des devis signés et des engagements de
          commande.
        </p>
      </header>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ display: "grid", gap: 5 }}>
          Mois analysé
          <input
            type="month"
            min="2000-01"
            max="2100-12"
            value={mois}
            onChange={(evenement) => {
              if (/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(evenement.target.value))
                setMonth(evenement.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="secondaryButton"
          onClick={() => setRevision((valeur) => valeur + 1)}
        >
          Actualiser
        </button>
      </div>
      {activeError ? <p role="alert">{activeError}</p> : null}
      {!courant && !activeError ? <p>Chargement…</p> : null}
      {courant && financial ? (
        <>
          {!financial.complete ? (
            <p role="status">
              Résultat non disponible : les factures clients, fournisseurs et le total de paie
              validé ne sont pas encore raccordés pour ce mois. Aucun devis, projet de facture ou BC
              ne les remplace.
            </p>
          ) : null}
          <section
            aria-label="Résultat mensuel facturé"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {[
              ["CA facturé net HT", financial.invoicedRevenueCents],
              ["Charges fournisseurs nettes HT", financial.supplierExpenseCents],
              ["Coût total du personnel validé", financial.payrollExpenseCents],
              ["Résultat mensuel facturé", financial.resultCents],
            ].map(([libelle, valeur]) => (
              <article
                key={String(libelle)}
                style={{ background: "white", borderRadius: 12, padding: 18 }}
              >
                <h2 style={{ fontSize: 16 }}>{libelle}</h2>
                <strong style={{ fontSize: 22 }}>{money(valeur as number | null)}</strong>
              </article>
            ))}
          </section>
          <section
            style={{ background: "white", padding: 18, borderRadius: 12, display: "grid", gap: 12 }}
          >
            <h2>Consommation et engagements, présentés séparément</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                    <th>Destination</th>
                    <th>Heures saisies du mois</th>
                    <th>Valorisation de ces heures</th>
                    <th>Engagements actuels HT, toutes dates</th>
                  </tr>
                </thead>
                <tbody>
                  {lignesTableau.map((ligneTableau) => (
                    <tr key={ligneTableau.label} style={{ borderBottom: "1px solid #eee" }}>
                      <th scope="row" style={{ padding: 12, textAlign: "left" }}>
                        {ligneTableau.label}
                      </th>
                      <td style={{ padding: 12 }}>{heures(ligneTableau.consumption?.hours)}</td>
                      <td style={{ padding: 12 }}>
                        {money(ligneTableau.consumption?.valuedCostCents)}
                      </td>
                      <td style={{ padding: 12 }}>{money(ligneTableau.commitment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              La valorisation porte uniquement sur les heures déjà saisies, pas sur toute la paie.
              Les engagements représentent les commandes actuellement actives, pas les factures du
              mois. Ces montants ne s’ajoutent pas une seconde fois au résultat facturé.
            </p>
            {courant.consumption?.provisional ? (
              <p>Coût horaire du mois en cours : valeur provisoire du mois précédent.</p>
            ) : null}
            {courant.consumption?.estimatedMonthSplit ? (
              <p>
                Semaines à cheval sur deux mois : ventilation estimée selon les horaires habituels,
                sans modifier les heures saisies.
              </p>
            ) : null}
            {courant.canReadPayroll && (courant.consumption?.total.unvaluedHours ?? 0) > 0 ? (
              <p>
                {heures(courant.consumption?.total.unvaluedHours)} sans coût mensuel disponible. Le
                total de valorisation reste indisponible.
              </p>
            ) : null}
            {!courant.canReadPayroll ? (
              <p>Valorisation salariale masquée : accès Planning et Paie requis.</p>
            ) : null}
            {!courant.canReadPlanning ? (
              <p>Heures non consultables : droit Planning requis.</p>
            ) : null}
            {!courant.canReadPurchases ? (
              <p>Engagements non consultables : droit Achats requis.</p>
            ) : null}
          </section>
          <small>
            Lecture des données PAPOT :{" "}
            {new Date(courant.asOf).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}. Ce n’est
            pas une synchronisation Pennylane.
          </small>
        </>
      ) : null}
    </main>
  );
}

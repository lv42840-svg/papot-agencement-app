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

const money = (value: number | null | undefined) =>
  value == null
    ? "Non disponible"
    : (value / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const hours = (value: number | undefined) =>
  value === undefined
    ? "Non disponible"
    : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;

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
            engagées. Cette vue ne constitue pas le résultat mensuel de l'entreprise.
          </p>
          {chantierView}
        </>
      )}
    </div>
  );
}

function MonthlyCompanyPosition() {
  const [month, setMonth] = useState(() => parisCurrentMonth());
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<MonthlyPosition | null>(null);
  const [error, setError] = useState<{ month: string; text: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `/api/desktop/pilotage/monthly-position?month=${encodeURIComponent(month)}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok)
          throw new Error("Situation mensuelle indisponible. Vérifie tes droits puis actualise.");
        const result = (await response.json()) as MonthlyPosition;
        if (!controller.signal.aborted) {
          setData(result);
          setError(null);
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setData(null);
          setError({
            month,
            text: cause instanceof Error ? cause.message : "Chargement impossible.",
          });
        }
      }
    })();
    return () => controller.abort();
  }, [month, revision]);
  const current = data?.month === month ? data : null;
  const activeError = error?.month === month ? error.text : null;
  const financial = current?.financial;
  const rows = current
    ? [
        {
          label: "Chantiers, y compris fermés, archivés et annulés",
          consumption: current.consumption?.chantier,
          commitment: current.commitments?.chantierCents,
        },
        {
          label: "SAV",
          consumption: current.consumption?.sav,
          commitment: current.commitments?.savCents,
        },
        {
          label: "Frais généraux",
          consumption: current.consumption?.generalExpenses,
          commitment: current.commitments?.generalExpensesCents,
        },
        {
          label: "Total unique",
          consumption: current.consumption?.total,
          commitment: current.commitments?.totalCents,
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
            value={month}
            onChange={(event) => {
              if (/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(event.target.value))
                setMonth(event.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="secondaryButton"
          onClick={() => setRevision((value) => value + 1)}
        >
          Actualiser
        </button>
      </div>
      {activeError ? <p role="alert">{activeError}</p> : null}
      {!current && !activeError ? <p>Chargement…</p> : null}
      {current && financial ? (
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
            ].map(([label, value]) => (
              <article
                key={String(label)}
                style={{ background: "white", borderRadius: 12, padding: 18 }}
              >
                <h2 style={{ fontSize: 16 }}>{label}</h2>
                <strong style={{ fontSize: 22 }}>{money(value as number | null)}</strong>
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
                  {rows.map((row) => (
                    <tr key={row.label} style={{ borderBottom: "1px solid #eee" }}>
                      <th scope="row" style={{ padding: 12, textAlign: "left" }}>
                        {row.label}
                      </th>
                      <td style={{ padding: 12 }}>{hours(row.consumption?.hours)}</td>
                      <td style={{ padding: 12 }}>{money(row.consumption?.valuedCostCents)}</td>
                      <td style={{ padding: 12 }}>{money(row.commitment)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              La valorisation porte uniquement sur les heures déjà saisies, pas sur toute la paie.
              Les engagements représentent les commandes actuellement actives, pas les factures du
              mois. Ces montants ne s'ajoutent pas une seconde fois au résultat facturé.
            </p>
            {current.consumption?.provisional ? (
              <p>Coût horaire du mois en cours : valeur provisoire du mois précédent.</p>
            ) : null}
            {current.consumption?.estimatedMonthSplit ? (
              <p>
                Semaines à cheval sur deux mois : ventilation estimée selon les horaires habituels,
                sans modifier les heures saisies.
              </p>
            ) : null}
            {current.canReadPayroll && (current.consumption?.total.unvaluedHours ?? 0) > 0 ? (
              <p>
                {hours(current.consumption?.total.unvaluedHours)} sans coût mensuel disponible. Le
                total de valorisation reste indisponible.
              </p>
            ) : null}
            {!current.canReadPayroll ? (
              <p>Valorisation salariale masquée : accès Planning et Paie requis.</p>
            ) : null}
            {!current.canReadPlanning ? (
              <p>Heures non consultables : droit Planning requis.</p>
            ) : null}
            {!current.canReadPurchases ? (
              <p>Engagements non consultables : droit Achats requis.</p>
            ) : null}
          </section>
          <small>
            Lecture des données PAPOT :{" "}
            {new Date(current.asOf).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}. Ce n'est
            pas une synchronisation Pennylane.
          </small>
        </>
      ) : null}
    </main>
  );
}

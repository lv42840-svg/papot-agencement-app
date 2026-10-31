"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  companyProfitabilityTotals,
  type CompanyProfitabilityRow,
} from "@/lib/pilotage/company-profitability";

const euro = (cents: number | null) =>
  cents === null
    ? "Incomplet"
    : (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const hours = (value: number) => value.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + " h";
const statuses: Record<CompanyProfitabilityRow["status"], string> = {
  ACTIVE: "Actif",
  DONE: "Terminé",
  ARCHIVED: "Archivé",
  CANCELLED: "Annulé",
};

export function EnterpriseProfitabilityWorkspace() {
  const [rows, setRows] = useState<CompanyProfitabilityRow[] | null>(null);
  const [error, setError] = useState("");
  const [year, setYear] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");

  async function reload() {
    try {
      setError("");
      const response = await fetch("/api/desktop/pilotage/rentabilite", { cache: "no-store" });
      if (!response.ok) throw new Error(
        response.status === 403
          ? "Accès Pilotage global, Chantiers, Commercial, Devis et Achats nécessaire."
          : "Impossible de charger la rentabilité entreprise.",
      );
      const result = (await response.json()) as { rows: CompanyProfitabilityRow[] };
      setRows(result.rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    }
  }
  useEffect(() => { void reload(); }, []);

  const years = useMemo(
    () => [...new Set((rows ?? []).map((row) => row.launchYear))].sort((a, b) => b - a),
    [rows],
  );
  const filtered = (rows ?? [])
    .filter((row) => year === "ALL" || row.launchYear === Number(year))
    .filter((row) => status === "ALL" || row.status === status)
    .filter((row) => (row.name + " " + row.clientName).toLocaleLowerCase("fr-FR")
      .includes(search.toLocaleLowerCase("fr-FR").trim()))
    .sort((a, b) => {
      if (a.missingData !== b.missingData) return a.missingData ? 1 : -1;
      return (a.plannedMarginCents ?? 0) - (b.plannedMarginCents ?? 0);
    });
  const total = companyProfitabilityTotals(filtered);
  const overrun = filtered.filter((row) =>
    row.plannedPurchasesCents !== null &&
    row.committedPurchasesCents > row.plannedPurchasesCents).length;
  const overtime = filtered.filter((row) =>
    row.plannedHours > 0 && row.actualHours > row.plannedHours).length;

  return (
    <main style={{ padding: 22, maxWidth: 1560, margin: "0 auto", display: "grid", gap: 20 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1>Rentabilité entreprise</h1>
          <p>
            Prévisionnel des chantiers et travaux supplémentaires retenus. Le coût des heures BE,
            atelier et pose est compté dans le coût prévu, sans double déduction.
          </p>
        </div>
        <button type="button" className="secondaryButton" onClick={() => void reload()}>Actualiser</button>
      </header>
      <p>
        <strong>Ce tableau n&apos;est pas un résultat comptable.</strong> Les ventes sont issues des
        devis retenus, non des factures clients. Les achats engagés sont des BC, non des factures
        fournisseurs. Les coûts réels complets nécessitent Pennylane.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {!rows && !error ? <p>Calcul des chantiers en cours…</p> : null}
      {rows && (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label>Année de lancement
              <select aria-label="Filtrer par année" value={year} onChange={(e) => setYear(e.target.value)}>
                <option value="ALL">Toutes les années</option>
                {years.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>État du chantier
              <select aria-label="Filtrer par état" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="ALL">Tous</option>
                <option value="ACTIVE">Actifs</option>
                <option value="DONE">Terminés</option>
                <option value="ARCHIVED">Archivés</option>
              </select>
            </label>
            <label>Rechercher
              <input aria-label="Rechercher chantier ou client" value={search}
                onChange={(e) => setSearch(e.target.value)} placeholder="Chantier ou client" />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            {[
              ["Chantiers", String(total.chantierCount)],
              ["Vendu prévu HT", euro(total.soldCents)],
              ["Coût des heures prévues", euro(total.plannedLaborCostCents)],
              ["Autres coûts prévus", euro(total.plannedOtherCostCents)],
              ["Coût total prévu HT", euro(total.plannedTotalCostCents)],
              ["Marge prévue HT", euro(total.plannedMarginCents)],
              ["BC engagés HT", euro(total.committedPurchasesCents)],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "white", borderRadius: 10, padding: 15 }}>
                <div style={{ fontSize: 12, color: "#6f677a" }}>{label}</div>
                <strong style={{ fontSize: 20 }}>{value}</strong>
              </div>
            ))}
          </div>
          {total.incompleteCount > 0 ? (
            <p role="status" style={{ color: "#a35018" }}>
              {total.incompleteCount} chantier(s) ont des coûts prévus incomplets.
              Les totaux financiers incomplets ne sont pas affichés pour éviter une marge surestimée.
              Vérifie les taux horaires et les prix d&apos;achat dans les devis.
            </p>
          ) : null}
          <p>
            <strong>{overrun}</strong> chantier(s) avec achats commandés au-dessus du budget ;
            {" "}<strong>{overtime}</strong> avec dépassement d&apos;heures ;
            {" "}<strong>{hours(total.actualHours)}</strong> enregistrées pour
            {" "}<strong>{hours(total.plannedHours)}</strong> prévues.
          </p>
          <section style={{ background: "white", padding: 14, borderRadius: 12, overflowX: "auto" }}>
            <h2>Rentabilité par chantier ({filtered.length})</h2>
            <table style={{ width: "100%", minWidth: 1180, borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "2px solid #ded8e9" }}>
                  <th>Chantier / client</th><th>État</th>
                  <th style={{ textAlign: "right" }}>Vendu HT</th>
                  <th style={{ textAlign: "right" }}>Heures prévues (€)</th>
                  <th style={{ textAlign: "right" }}>Achats + frais prévus</th>
                  <th style={{ textAlign: "right" }}>Coût total prévu</th>
                  <th style={{ textAlign: "right" }}>Marge prévue</th>
                  <th style={{ textAlign: "right" }}>BC engagés</th>
                  <th style={{ textAlign: "right" }}>Heures prévues / réelles</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.chantierId} style={{ borderBottom: "1px solid #ece8f0" }}>
                    <td style={{ padding: 8 }}>
                      <Link href={`/chantiers/${encodeURIComponent(row.chantierId)}`}>
                        <strong>{row.name}</strong>
                      </Link>
                      <div style={{ fontSize: 11 }}>{row.clientName}</div>
                      {row.missingData ? <small style={{ color: "#a35018" }}>Coûts à compléter</small> : null}
                    </td>
                    <td style={{ padding: 8 }}>{statuses[row.status]}</td>
                    {[row.soldCents, row.plannedLaborCostCents, row.plannedOtherCostCents,
                      row.plannedTotalCostCents, row.plannedMarginCents,
                      row.committedPurchasesCents].map((value, index) => (
                        <td key={index} style={{ padding: 8, textAlign: "right", whiteSpace: "nowrap" }}>
                          {euro(value)}
                        </td>
                      ))}
                    <td style={{ padding: 8, textAlign: "right", whiteSpace: "nowrap" }}>
                      {hours(row.plannedHours)} / {hours(row.actualHours)}
                      {row.plannedHours > 0 && row.actualHours > row.plannedHours
                        ? <div style={{ color: "#b33138" }}>Dépassement</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filtered.length ? <p>Aucun chantier pour ces filtres.</p> : null}
          </section>
        </>
      )}
    </main>
  );
}

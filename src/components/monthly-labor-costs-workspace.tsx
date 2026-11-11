"use client";

import { EditHistory, type EditEvent } from "./edit-history";

import { useCallback, useEffect, useState } from "react";
import { EDIT_CONFLICT_MESSAGE } from "@/lib/edit-history";
import { parisCurrentMonth } from "@/lib/payroll/monthly-labor-costs";

type Person = { id: string; name: string; holdingHours?: number };
type MonthlyRow = {
  personId: string;
  month: string;
  employerCostCents: number;
  workedHours: number;
  hourlyRateEuro: number | null;
  sourceType: "SALARY" | "HOLDING";
  revision: number;
  derivedHoldingHours?: number | null;
  updatedAt: string;
  updatedBy: string;
};
type Snapshot = {
  editHistory: EditEvent[];
  editRevisions: Record<string, number>;
  month: string;
  editable: boolean;
  people: Person[];
  records: MonthlyRow[];
  history?: Array<{
    personId: string;
    previous: MonthlyRow | null;
    next: MonthlyRow;
    at: string;
    by: string;
  }>;
};
type Draft = { cost: string; hours: string; sourceType: "SALARY" | "HOLDING" };

function previousMonth(): string {
  const courant = parisCurrentMonth();
  const [annee, mois] = courant.split("-").map(Number);
  return mois === 1 ? String(annee - 1) + "-12" : annee + "-" + String(mois - 1).padStart(2, "0");
}

function displayMoney(valeur: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(valeur);
}
function decimal(texte: string): number | null {
  const normalized = texte.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function MonthlyLaborCostsWorkspace() {
  const [mois, setMonth] = useState(previousMonth);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [brouillons, setDrafts] = useState<Record<string, Draft>>({});
  const [chargement, setLoading] = useState(true);
  const [sauvegardeEnCours, setSaving] = useState<string | null>(null);
  const [erreur, setError] = useState("");
  const [message, setMessage] = useState("");
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const reponse = await fetch(
        "/api/desktop/payroll/monthly-labor-costs?month=" + encodeURIComponent(mois),
        { cache: "no-store" },
      );
      if (reponse.status === 403) {
        setForbidden(true);
        setSnapshot(null);
        return;
      }
      const corps = (await reponse.json()) as Snapshot & { error?: string };
      if (!reponse.ok) throw new Error(corps.error ?? "Chargement impossible.");
      setForbidden(false);
      setSnapshot(corps);
      setDrafts({});
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [mois]);

  useEffect(() => {
    void load();
  }, [load]);

  function rowDraft(personId: string): Draft {
    const ligneTableau = snapshot?.records.find((element) => element.personId === personId);
    return (
      brouillons[personId] ?? {
        cost: ligneTableau
          ? (ligneTableau.employerCostCents / 100).toFixed(2).replace(".", ",")
          : "",
        hours: ligneTableau
          ? String(ligneTableau.derivedHoldingHours ?? ligneTableau.workedHours).replace(".", ",")
          : "",
        sourceType: ligneTableau?.sourceType ?? "SALARY",
      }
    );
  }

  async function save(personId: string) {
    if (!snapshot?.editable || sauvegardeEnCours) return;
    const brouillon = rowDraft(personId);
    const cout = decimal(brouillon.cost);
    const heures = decimal(brouillon.hours);
    if (cout === null || heures === null || heures < 0 || heures > 744 || cout > 1_000_000) {
      setMessage("Renseigne un montant valide et des heures comprises entre 0 et 744.");
      return;
    }
    setSaving(personId);
    setMessage("");
    try {
      const reponse = await fetch("/api/desktop/payroll/monthly-labor-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveMonthlyLaborCost",
          expectedRevision: snapshot.editRevisions?.[`${mois}:${personId}`] ?? 0,
          month: mois,
          personId,
          employerCostCents: Math.round(cout * 100),
          workedHours: heures,
          sourceType: brouillon.sourceType,
        }),
      });
      const corps = (await reponse.json()) as Snapshot & { error?: string };
      if (!reponse.ok)
        throw new Error(
          corps.error === "EDIT_VERSION_CONFLICT"
            ? EDIT_CONFLICT_MESSAGE
            : (corps.error ?? "Enregistrement impossible."),
        );
      setSnapshot((old) =>
        old
          ? {
              ...corps,
              records: [
                ...old.records.filter((ligneTableau) => ligneTableau.personId !== personId),
                ...corps.records.filter((ligneTableau) => ligneTableau.personId === personId),
              ],
              editRevisions: {
                ...old.editRevisions,
                [`${mois}:${personId}`]: corps.editRevisions[`${mois}:${personId}`],
              },
            }
          : corps,
      );
      setDrafts((old) => {
        const suivant = { ...old };
        delete suivant[personId];
        return suivant;
      });
      setMessage("Coût mensuel enregistré. La valorisation des chantiers est actualisée.");
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Enregistrement impossible. Si une autre personne a corrigé ce mois, actualise les valeurs.",
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="papotMonthlyCosts">
      <header>
        <p className="eyebrow">PAPOT AGENCEMENT · HEURES</p>
        <h2>Coûts mensuels · salariés et holding</h2>
        <p>
          Après chaque paie, saisis le coût employeur des salariés ou le montant HT de la facture
          holding pour le dirigeant, et les heures travaillées. Le coût horaire sert à valoriser les
          heures déjà affectées aux chantiers. Les heures saisies ne sont jamais modifiées.
        </p>
      </header>
      <div className="monthlyCostsPeriod">
        <label htmlFor="monthly-cost-month">Mois de paie (terminé)</label>
        <input
          id="monthly-cost-month"
          aria-label="Mois des coûts salariaux"
          type="month"
          value={mois}
          max={parisCurrentMonth()}
          disabled={chargement || sauvegardeEnCours !== null}
          onChange={(evenement) => {
            if (/^\d{4}-\d{2}$/.test(evenement.target.value)) setMonth(evenement.target.value);
          }}
        />
      </div>
      {chargement ? <p className="monthlyCostsNotice">Chargement…</p> : null}
      {forbidden ? (
        <p className="monthlyCostsNotice" role="alert">
          Accès réservé aux utilisateurs autorisés au module Paie. Les montants salariaux restent
          confidentiels.
        </p>
      ) : null}
      {erreur ? (
        <p className="monthlyCostsNotice" role="alert">
          {erreur}
        </p>
      ) : null}
      {snapshot && !chargement ? (
        <>
          {!snapshot.editable ? (
            <p className="monthlyCostsNotice">
              Lecture seule : droit de modification du module Paie requis.
            </p>
          ) : null}
          <div className="monthlyCostsTableWrap">
            <table className="monthlyCostsTable">
              <thead>
                <tr>
                  <th scope="col">Salarié</th>
                  <th scope="col">Origine du coût</th>
                  <th scope="col">Coût mensuel (€)</th>
                  <th scope="col">Heures travaillées</th>
                  <th scope="col">Coût réel / heure</th>
                  <th scope="col">Validation</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.people.map((personne) => {
                  const valeur = rowDraft(personne.id);
                  const cout = decimal(valeur.cost);
                  const heures = decimal(valeur.hours);
                  const stored = snapshot.records.find(
                    (enregistrement) => enregistrement.personId === personne.id,
                  );
                  const automaticHours =
                    snapshot.people.find((p) => p.id === personne.id)?.holdingHours ?? null;
                  const effectiveHours =
                    valeur.sourceType === "HOLDING" && automaticHours !== null
                      ? automaticHours
                      : heures;
                  const rate =
                    cout !== null && effectiveHours !== null && effectiveHours > 0
                      ? cout / effectiveHours
                      : null;
                  // Holding hours are recomputed on the server for every save.
                  const changed = brouillons[personne.id] !== undefined;
                  return (
                    <tr key={personne.id}>
                      <th scope="row">
                        {personne.name}
                        {stored ? (
                          <small>Enregistré pour ce mois</small>
                        ) : (
                          <small>À compléter</small>
                        )}
                      </th>
                      <td>
                        <select
                          aria-label={"Source de coût " + personne.name}
                          value={valeur.sourceType}
                          disabled={!snapshot.editable || sauvegardeEnCours !== null}
                          onChange={(evenement) =>
                            setDrafts((old) => ({
                              ...old,
                              [personne.id]: {
                                ...valeur,
                                sourceType: evenement.target.value as "SALARY" | "HOLDING",
                              },
                            }))
                          }
                        >
                          <option value="SALARY">Salarié</option>
                          <option value="HOLDING">Facture holding HT</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={"Coût mensuel " + personne.name}
                          value={valeur.cost}
                          placeholder="0,00"
                          disabled={!snapshot.editable || sauvegardeEnCours !== null}
                          onChange={(evenement) =>
                            setDrafts((old) => ({
                              ...old,
                              [personne.id]: { ...valeur, cost: evenement.target.value },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={"Heures travaillées " + personne.name}
                          value={
                            valeur.sourceType === "HOLDING" && automaticHours !== null
                              ? String(automaticHours).replace(".", ",")
                              : valeur.hours
                          }
                          placeholder="0"
                          disabled={
                            !snapshot.editable ||
                            sauvegardeEnCours !== null ||
                            valeur.sourceType === "HOLDING"
                          }
                          onChange={(evenement) =>
                            setDrafts((old) => ({
                              ...old,
                              [personne.id]: { ...valeur, hours: evenement.target.value },
                            }))
                          }
                          onKeyDown={(evenement) => {
                            if (evenement.key === "Enter") {
                              evenement.preventDefault();
                              void save(personne.id);
                            }
                          }}
                        />
                      </td>
                      <td className="monthlyCostsRate">
                        {rate === null ? "Non calculable (0 h)" : displayMoney(rate) + " / h"}
                      </td>
                      <td>
                        <button
                          className="secondaryButton"
                          type="button"
                          disabled={!snapshot.editable || !changed || sauvegardeEnCours !== null}
                          onClick={() => void save(personne.id)}
                        >
                          {sauvegardeEnCours === personne.id ? "Enregistrement…" : "Enregistrer"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {snapshot.people.length === 0 ? (
                  <tr>
                    <td colSpan={6}>Aucun salarié connu.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="monthlyCostsNote">
            Pour une semaine à cheval sur deux mois, la ventilation est estimée selon les horaires
            habituels des jours ouvrés du salarié. Pour le mois en cours, PAPOT utilise
            provisoirement le coût horaire employeur du mois précédent. Les mois clôturés exigent
            leur propre paie ; si elle manque, le coût du chantier reste non calculable.
          </p>
        </>
      ) : null}
      {message ? (
        <p className="monthlyCostsNotice" role="status">
          {message}
        </p>
      ) : null}
      {snapshot ? (
        <EditHistory events={snapshot.editHistory ?? []} people={snapshot.people} />
      ) : null}
      <style jsx global>{`
        .papotMonthlyCosts {
          display: grid;
          gap: 16px;
          color: #29223c;
          padding-bottom: 30px;
        }
        .papotMonthlyCosts h2 {
          margin: 4px 0 8px;
          font-size: 22px;
        }
        .papotMonthlyCosts header p:not(.eyebrow) {
          max-width: 920px;
          font-size: 13px;
          color: #746b83;
        }
        .monthlyCostsPeriod {
          display: flex;
          align-items: center;
          gap: 14px;
          background: #f6f2fc;
          border: 1px solid #e5dbf0;
          padding: 14px;
          border-radius: 10px;
          flex-wrap: wrap;
        }
        .monthlyCostsPeriod label {
          font-weight: 800;
          font-size: 13px;
        }
        .monthlyCostsPeriod input {
          padding: 9px;
          background: white;
          border: 1px solid #cec4dd;
          border-radius: 7px;
        }
        .monthlyCostsTableWrap {
          overflow-x: auto;
          border: 1px solid #ded5e9;
          border-radius: 10px;
        }
        .monthlyCostsTable {
          width: 100%;
          border-collapse: collapse;
          background: white;
          min-width: 760px;
        }
        .monthlyCostsTable th,
        .monthlyCostsTable td {
          text-align: left;
          padding: 12px;
          border-bottom: 1px solid #e8e2f0;
          font-size: 12px;
        }
        .monthlyCostsTable thead th {
          background: #eae3f6;
          color: #53417a;
        }
        .monthlyCostsTable tbody tr:nth-child(even) {
          background: #fcfaff;
        }
        .monthlyCostsTable tbody th small {
          display: block;
          margin-top: 4px;
          font-weight: 500;
          color: #80758e;
        }
        .monthlyCostsTable input {
          width: 155px;
          max-width: 100%;
          border: 1px solid #d8ceea;
          border-radius: 6px;
          padding: 9px;
          text-align: right;
        }
        .monthlyCostsRate {
          color: #5a488b;
          font-weight: 800;
          white-space: nowrap;
        }
        .monthlyCostsNote {
          font-size: 12px;
          color: #746b83;
          margin: 0;
        }
        .monthlyCostsNotice {
          padding: 12px;
          background: #f5f0ff;
          border-radius: 8px;
          font-size: 12px;
        }
      `}</style>
    </section>
  );
}

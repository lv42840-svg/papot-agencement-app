"use client";

import { EditHistory, type EditEvent } from "./edit-history";

import { useCallback, useEffect, useState } from "react";
import { EDIT_CONFLICT_MESSAGE } from "@/lib/edit-history";
import { parisCurrentMonth } from "@/lib/payroll/monthly-labor-costs";

type Person = { id: string; name: string };
type MonthlyRow = {
  personId: string;
  month: string;
  employerCostCents: number;
  workedHours: number;
  hourlyRateEuro: number;
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
};
type Draft = { cost: string; hours: string };

function previousMonth(): string {
  const current = parisCurrentMonth();
  const [year, month] = current.split("-").map(Number);
  return month === 1 ? String(year - 1) + "-12" : year + "-" + String(month - 1).padStart(2, "0");
}

function displayMoney(value: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);
}
function decimal(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function MonthlyLaborCostsWorkspace() {
  const [month, setMonth] = useState(previousMonth);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        "/api/desktop/payroll/monthly-labor-costs?month=" + encodeURIComponent(month),
        { cache: "no-store" },
      );
      if (response.status === 403) {
        setForbidden(true);
        setSnapshot(null);
        return;
      }
      const body = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Chargement impossible.");
      setForbidden(false);
      setSnapshot(body);
      setDrafts({});
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error ? cause.message : "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  function rowDraft(personId: string): Draft {
    const row = snapshot?.records.find((item) => item.personId === personId);
    return (
      drafts[personId] ?? {
        cost: row ? (row.employerCostCents / 100).toFixed(2).replace(".", ",") : "",
        hours: row ? String(row.workedHours).replace(".", ",") : "",
      }
    );
  }

  async function save(personId: string) {
    if (!snapshot?.editable || saving) return;
    const draft = rowDraft(personId);
    const cost = decimal(draft.cost);
    const hours = decimal(draft.hours);
    if (cost === null || hours === null || hours <= 0 || hours > 744 || cost > 1_000_000) {
      setMessage("Renseigne un coût employeur valide et des heures travaillées supérieures à 0.");
      return;
    }
    setSaving(personId);
    setMessage("");
    try {
      const response = await fetch("/api/desktop/payroll/monthly-labor-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveMonthlyLaborCost",
          expectedRevision: snapshot.editRevisions?.[`${month}:${personId}`] ?? 0,
          month,
          personId,
          employerCostCents: Math.round(cost * 100),
          workedHours: hours,
        }),
      });
      const body = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok)
        throw new Error(
          body.error === "EDIT_VERSION_CONFLICT"
            ? EDIT_CONFLICT_MESSAGE
            : (body.error ?? "Enregistrement impossible."),
        );
      setSnapshot((old) =>
        old
          ? {
              ...body,
              records: [
                ...old.records.filter((row) => row.personId !== personId),
                ...body.records.filter((row) => row.personId === personId),
              ],
              editRevisions: {
                ...old.editRevisions,
                [`${month}:${personId}`]: body.editRevisions[`${month}:${personId}`],
              },
            }
          : body,
      );
      setDrafts((old) => {
        const next = { ...old };
        delete next[personId];
        return next;
      });
      setMessage("Coût mensuel enregistré. La valorisation des chantiers est actualisée.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="papotMonthlyCosts">
      <header>
        <p className="eyebrow">PAPOT AGENCEMENT · HEURES</p>
        <h2>Coûts salariaux mensuels</h2>
        <p>
          Après chaque paie, saisis le coût total employeur (brut + charges patronales) et les
          heures travaillées. Le coût horaire sert à valoriser les heures déjà affectées aux
          chantiers. Les heures saisies ne sont jamais modifiées.
        </p>
      </header>
      <div className="monthlyCostsPeriod">
        <label htmlFor="monthly-cost-month">Mois de paie (terminé)</label>
        <input
          id="monthly-cost-month"
          aria-label="Mois des coûts salariaux"
          type="month"
          value={month}
          max={previousMonth()}
          disabled={loading || saving !== null}
          onChange={(event) => {
            if (/^\d{4}-\d{2}$/.test(event.target.value)) setMonth(event.target.value);
          }}
        />
      </div>
      {loading ? <p className="monthlyCostsNotice">Chargement…</p> : null}
      {forbidden ? (
        <p className="monthlyCostsNotice" role="alert">
          Accès réservé aux utilisateurs autorisés au module Paie. Les montants salariaux restent
          confidentiels.
        </p>
      ) : null}
      {error ? (
        <p className="monthlyCostsNotice" role="alert">
          {error}
        </p>
      ) : null}
      {snapshot && !loading ? (
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
                  <th scope="col">Coût employeur (€)</th>
                  <th scope="col">Heures travaillées</th>
                  <th scope="col">Coût réel / heure</th>
                  <th scope="col">Validation</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.people.map((person) => {
                  const value = rowDraft(person.id);
                  const cost = decimal(value.cost);
                  const hours = decimal(value.hours);
                  const rate = cost !== null && hours !== null && hours > 0 ? cost / hours : null;
                  const stored = snapshot.records.find((record) => record.personId === person.id);
                  const changed = drafts[person.id] !== undefined;
                  return (
                    <tr key={person.id}>
                      <th scope="row">
                        {person.name}
                        {stored ? (
                          <small>Enregistré pour ce mois</small>
                        ) : (
                          <small>À compléter</small>
                        )}
                      </th>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={"Coût total employeur " + person.name}
                          value={value.cost}
                          placeholder="0,00"
                          disabled={!snapshot.editable || saving !== null}
                          onChange={(event) =>
                            setDrafts((old) => ({
                              ...old,
                              [person.id]: { ...value, cost: event.target.value },
                            }))
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          inputMode="decimal"
                          aria-label={"Heures travaillées " + person.name}
                          value={value.hours}
                          placeholder="0"
                          disabled={!snapshot.editable || saving !== null}
                          onChange={(event) =>
                            setDrafts((old) => ({
                              ...old,
                              [person.id]: { ...value, hours: event.target.value },
                            }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void save(person.id);
                            }
                          }}
                        />
                      </td>
                      <td className="monthlyCostsRate">
                        {rate === null ? "—" : displayMoney(rate) + " / h"}
                      </td>
                      <td>
                        <button
                          className="secondaryButton"
                          type="button"
                          disabled={!snapshot.editable || !changed || saving !== null}
                          onClick={() => void save(person.id)}
                        >
                          {saving === person.id ? "Enregistrement…" : "Enregistrer"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {snapshot.people.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Aucun salarié connu.</td>
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

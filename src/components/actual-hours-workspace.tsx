"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isoWeekKey, isoWeekMonday, weekDateRangeLabel } from "@/lib/planning/time-markers";

type Activity = "BE" | "WORKSHOP" | "INSTALL";
type Hours = { be: number; workshop: number; install: number };
type Person = { id: string; name: string; endDate: string | null; inactiveSince: string | null };
type Chantier = {
  id: string;
  name: string;
  reference: string | null;
  status: string;
  plannedHours: Hours;
  actualHours: Hours;
  weekHours: Hours;
  remainingHours: Hours;
};
type RecordRow = {
  chantierId: string;
  userId: string;
  activity: Activity;
  week: string;
  hours: number;
  personName: string;
};
type HoursSnapshot = {
  week: string;
  editable: boolean;
  weekIsPast: boolean;
  people: Person[];
  chantiers: Chantier[];
  records: RecordRow[];
};

function relativeWeek(week: string, offset: number): string {
  const monday = isoWeekMonday(week);
  monday.setUTCDate(monday.getUTCDate() + offset * 7);
  return isoWeekKey(
    new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate(), 12),
  );
}

function lastCompletedWeek() {
  return relativeWeek(isoWeekKey(new Date()), -1);
}

const formatHours = (hours: number) =>
  new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(hours);
const inputHours = (hours: number) => (hours === 0 ? "" : String(hours).replace(".", ","));
function parseHours(value: string): number | null {
  const raw = value.trim().replace(",", ".");
  if (!raw) return 0;
  if (!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 168 ? parsed : null;
}

const keyFor = (personId: string, activity: Activity) => personId + ":" + activity;

export function ActualHoursWorkspace() {
  const [week, setWeek] = useState(lastCompletedWeek);
  const [data, setData] = useState<HoursSnapshot | null>(null);
  const [chantierId, setChantierId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/desktop/planning/actual-hours?week=${encodeURIComponent(week)}`,
        {
          cache: "no-store",
        },
      );
      const json = (await response.json()) as HoursSnapshot & { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Impossible de charger les heures.");
      setData(json);
      setDrafts({});
      setChantierId((old) =>
        json.chantiers.some((item) => item.id === old)
          ? old
          : (json.chantiers.find((item) =>
              json.records.some((record) => record.chantierId === item.id),
            )?.id ??
            json.chantiers[0]?.id ??
            ""),
      );
      setError("");
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Impossible de charger les heures.");
    } finally {
      setLoading(false);
    }
  }, [week]);

  useEffect(() => {
    void load();
  }, [load]);

  const chantier = useMemo(
    () => data?.chantiers.find((item) => item.id === chantierId) ?? null,
    [data, chantierId],
  );
  const currentRecords = useMemo(() => {
    const index = new Map<string, number>();
    for (const row of data?.records ?? []) {
      if (row.chantierId === chantierId) index.set(keyFor(row.userId, row.activity), row.hours);
    }
    return index;
  }, [data?.records, chantierId]);

  function valueFor(personId: string, activity: Activity): string {
    const key = keyFor(personId, activity);
    return drafts[key] ?? inputHours(currentRecords.get(key) ?? 0);
  }
  function rowTotals(personId: string) {
    const be = parseHours(valueFor(personId, "BE")) ?? 0;
    const workshop = parseHours(valueFor(personId, "WORKSHOP")) ?? 0;
    const install = parseHours(valueFor(personId, "INSTALL")) ?? 0;
    return be + workshop + install;
  }

  async function savePerson(personId: string) {
    if (!data?.editable || saving || !chantier) return;
    const be = parseHours(valueFor(personId, "BE"));
    const workshop = parseHours(valueFor(personId, "WORKSHOP"));
    const install = parseHours(valueFor(personId, "INSTALL"));
    if ([be, workshop, install].some((value) => value === null)) {
      setMessage("Saisis des heures positives, au maximum deux décimales (ex. 7,5).");
      return;
    }
    const hours = { be: be!, workshop: workshop!, install: install! };
    if (hours.be + hours.workshop + hours.install > 168) {
      setMessage("Le total d'une personne ne peut pas dépasser 168 h par semaine.");
      return;
    }
    setSaving(personId);
    setMessage("");
    try {
      const response = await fetch("/api/desktop/planning/actual-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveActualHoursRow",
          week,
          chantierId,
          userId: personId,
          ...hours,
        }),
      });
      const json = (await response.json()) as HoursSnapshot & { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Enregistrement impossible.");
      setData(json);
      setDrafts((old) => {
        const copy = { ...old };
        for (const activity of ["BE", "WORKSHOP", "INSTALL"] as const) {
          delete copy[keyFor(personId, activity)];
        }
        return copy;
      });
      setMessage("Heures réelles enregistrées pour cette personne et ce chantier.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSaving(null);
    }
  }

  const activeTotals = data?.people.reduce(
    (acc, person) => {
      const byPerson = ["BE", "WORKSHOP", "INSTALL"] as const;
      for (const activity of byPerson) {
        acc[activity] += parseHours(valueFor(person.id, activity)) ?? 0;
      }
      return acc;
    },
    { BE: 0, WORKSHOP: 0, INSTALL: 0 },
  ) ?? { BE: 0, WORKSHOP: 0, INSTALL: 0 };

  return (
    <section className="papotActualHours">
      <div className="actualHoursHeader">
        <div>
          <p className="eyebrow">PAPOT AGENCEMENT · PRODUCTION</p>
          <h1>Saisie des heures réelles</h1>
          <p>
            Chaque semaine écoulée, renseigne les heures par chantier et par personne, puis
            répartis-les entre BE, Atelier et Pose.
          </p>
        </div>
        <div className="actualHoursActions">
          <Link className="secondaryButton" href="/planning">
            Grand planning
          </Link>
          <Link className="secondaryButton" href={`/planning/${week}`}>
            Petit planning
          </Link>
        </div>
      </div>

      <div className="actualHoursFilters">
        <label>
          Semaine écoulée
          <div className="actualHoursWeekControls">
            <button
              type="button"
              className="secondaryButton"
              onClick={() => setWeek(relativeWeek(week, -1))}
            >
              ←
            </button>
            <input
              aria-label="Semaine de saisie"
              type="week"
              value={week}
              onChange={(event) => {
                if (/^\d{4}-W\d{2}$/.test(event.target.value)) setWeek(event.target.value);
              }}
            />
            <button
              type="button"
              className="secondaryButton"
              disabled={relativeWeek(week, 1) === isoWeekKey(new Date())}
              onClick={() => setWeek(relativeWeek(week, 1))}
            >
              →
            </button>
          </div>
          <small>{weekDateRangeLabel(week)}</small>
        </label>
        <label>
          Chantier
          <select
            value={chantierId}
            onChange={(event) => {
              setChantierId(event.target.value);
              setDrafts({});
            }}
            disabled={loading || !data || data.chantiers.length === 0}
          >
            {data?.chantiers.length === 0 ? <option value="">Aucun chantier</option> : null}
            {data?.chantiers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.reference ? item.reference + " · " : ""}
                {item.name}
              </option>
            ))}
          </select>
          <small>
            {chantier?.status === "ACTIVE"
              ? "En cours"
              : chantier?.status === "DONE"
                ? "Terminé (corrections possibles)"
                : chantier?.status === "ARCHIVED"
                  ? "Archivé (historique)"
                  : ""}
          </small>
        </label>
      </div>

      {loading ? <p className="actualHoursNotice">Chargement des heures…</p> : null}
      {error ? (
        <p className="actualHoursNotice" role="alert">
          {error}{" "}
          <button type="button" onClick={() => void load()}>
            Réessayer
          </button>
        </p>
      ) : null}
      {data && chantier && !loading ? (
        <>
          {!data.weekIsPast ? (
            <p className="actualHoursNotice">
              Cette semaine n'est pas terminée. Sélectionne une semaine écoulée pour saisir du
              réalisé.
            </p>
          ) : null}
          {!data.editable && data.weekIsPast ? (
            <p className="actualHoursNotice">
              Lecture seule. La permission « Saisir les heures passées » est nécessaire pour
              modifier.
            </p>
          ) : null}

          <div className="actualHoursMetrics">
            <div>
              <small>Prévu chantier</small>
              <strong>
                {formatHours(
                  chantier.plannedHours.be +
                    chantier.plannedHours.workshop +
                    chantier.plannedHours.install,
                )}{" "}
                h
              </strong>
            </div>
            <div>
              <small>Réalisé cumulé</small>
              <strong>
                {formatHours(
                  chantier.actualHours.be +
                    chantier.actualHours.workshop +
                    chantier.actualHours.install,
                )}{" "}
                h
              </strong>
            </div>
            <div>
              <small>Reste à faire estimé</small>
              <strong>
                {formatHours(
                  chantier.remainingHours.be +
                    chantier.remainingHours.workshop +
                    chantier.remainingHours.install,
                )}{" "}
                h
              </strong>
            </div>
            <div>
              <small>Semaine {week.slice(-2)}</small>
              <strong>
                {formatHours(
                  chantier.weekHours.be + chantier.weekHours.workshop + chantier.weekHours.install,
                )}{" "}
                h
              </strong>
            </div>
          </div>

          <div className="actualHoursTableWrap">
            <table className="actualHoursTable">
              <thead>
                <tr>
                  <th scope="col">Personnel</th>
                  <th scope="col">BE (h)</th>
                  <th scope="col">Atelier (h)</th>
                  <th scope="col">Pose (h)</th>
                  <th scope="col">Total (h)</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((person) => {
                  const dirty = (["BE", "WORKSHOP", "INSTALL"] as const).some(
                    (activity) => drafts[keyFor(person.id, activity)] !== undefined,
                  );
                  return (
                    <tr key={person.id}>
                      <th scope="row">{person.name}</th>
                      {(["BE", "WORKSHOP", "INSTALL"] as const).map((activity) => (
                        <td key={activity}>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`${person.name} ${activity}`}
                            value={valueFor(person.id, activity)}
                            placeholder="0"
                            disabled={!data.editable || saving !== null}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [keyFor(person.id, activity)]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void savePerson(person.id);
                              }
                            }}
                          />
                        </td>
                      ))}
                      <td className="actualHoursTotal">{formatHours(rowTotals(person.id))}</td>
                      <td>
                        <button
                          type="button"
                          className="secondaryButton"
                          disabled={!data.editable || saving !== null || !dirty}
                          onClick={() => void savePerson(person.id)}
                        >
                          {saving === person.id ? "Enregistrement…" : "Enregistrer"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {data.people.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      Ajoute une personne dans Gestion du personnel pour saisir ses heures.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total semaine / chantier</th>
                  <td>{formatHours(activeTotals.BE)} h</td>
                  <td>{formatHours(activeTotals.WORKSHOP)} h</td>
                  <td>{formatHours(activeTotals.INSTALL)} h</td>
                  <td>
                    {formatHours(activeTotals.BE + activeTotals.WORKSHOP + activeTotals.INSTALL)} h
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="actualHoursHint">
            Une ligne est enregistrée en une seule opération. Laisse un champ vide pour 0 h.
            Corriger des heures remplace le total de cette personne, activité, chantier et semaine,
            sans créer de doublon.
          </p>

          <div className="actualHoursBreakdown">
            <h2>Suivi du chantier · prévu / réalisé / restant</h2>
            <table>
              <thead>
                <tr>
                  <th>Activité</th>
                  <th>Prévu</th>
                  <th>Réalisé</th>
                  <th>Reste</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["BE", "be"],
                    ["Atelier", "workshop"],
                    ["Pose", "install"],
                  ] as const
                ).map(([label, key]) => (
                  <tr key={key}>
                    <th>{label}</th>
                    <td>{formatHours(chantier.plannedHours[key])} h</td>
                    <td>{formatHours(chantier.actualHours[key])} h</td>
                    <td>{formatHours(chantier.remainingHours[key])} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="actualHoursOtherSites">
            <h2>Autres chantiers avec du réalisé sur la semaine</h2>
            <div className="actualHoursSiteChips">
              {data.chantiers
                .filter(
                  (item) =>
                    item.weekHours.be + item.weekHours.workshop + item.weekHours.install > 0,
                )
                .map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={item.id === chantierId ? "isSelected" : ""}
                    onClick={() => {
                      setChantierId(item.id);
                      setDrafts({});
                    }}
                  >
                    {item.name} ·{" "}
                    {formatHours(
                      item.weekHours.be + item.weekHours.workshop + item.weekHours.install,
                    )}{" "}
                    h
                  </button>
                ))}
              {data.chantiers.every(
                (item) =>
                  item.weekHours.be + item.weekHours.workshop + item.weekHours.install === 0,
              ) ? (
                <p className="muted">Aucune heure réelle enregistrée pour cette semaine.</p>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
      {message ? (
        <p className="actualHoursNotice" role="status">
          {message}
        </p>
      ) : null}

      <style jsx global>{`
        .papotActualHours {
          display: grid;
          gap: 14px;
          color: #29223c;
          padding-bottom: 30px;
        }
        .actualHoursHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
          flex-wrap: wrap;
        }
        .actualHoursHeader h1 {
          margin: 4px 0 7px;
          font-size: 23px;
        }
        .actualHoursHeader p:not(.eyebrow) {
          font-size: 12px;
          color: #797186;
          max-width: 730px;
          margin: 0;
        }
        .actualHoursActions {
          display: flex;
          gap: 7px;
        }
        .actualHoursFilters {
          display: grid;
          grid-template-columns: minmax(220px, 300px) minmax(280px, 1fr);
          gap: 14px;
          padding: 15px;
          background: #f6f2fc;
          border: 1px solid #e5dbf0;
          border-radius: 10px;
        }
        .actualHoursFilters label {
          display: grid;
          gap: 7px;
          font-size: 12px;
          font-weight: 800;
        }
        .actualHoursFilters select,
        .actualHoursFilters input {
          background: white;
          padding: 9px;
          border-radius: 6px;
          border: 1px solid #cec4dd;
          width: 100%;
          min-width: 0;
        }
        .actualHoursFilters small {
          font-weight: 500;
          color: #80758e;
          font-size: 10px;
        }
        .actualHoursWeekControls {
          display: flex;
          gap: 5px;
        }
        .actualHoursWeekControls button {
          min-width: 34px;
        }
        .actualHoursMetrics {
          display: grid;
          grid-template-columns: repeat(4, minmax(120px, 1fr));
          gap: 10px;
        }
        .actualHoursMetrics > div {
          display: grid;
          gap: 5px;
          padding: 14px;
          background: white;
          border: 1px solid #e4ddec;
          border-radius: 8px;
        }
        .actualHoursMetrics small {
          font-size: 11px;
          color: #726783;
        }
        .actualHoursMetrics strong {
          font-size: 20px;
          color: #5a488b;
        }
        .actualHoursTableWrap {
          overflow-x: auto;
          border: 1px solid #d8d0e5;
          border-radius: 9px;
        }
        .actualHoursTable {
          border-collapse: collapse;
          width: 100%;
          min-width: 780px;
          background: white;
        }
        .actualHoursTable th,
        .actualHoursTable td {
          text-align: left;
          padding: 9px 12px;
          border-bottom: 1px solid #e8e2f0;
          font-size: 12px;
        }
        .actualHoursTable thead th {
          background: #eae3f6;
          color: #53417a;
          font-size: 11px;
        }
        .actualHoursTable tbody tr:nth-child(even) {
          background: #fcfaff;
        }
        .actualHoursTable input {
          width: 92px;
          max-width: 100%;
          border: 1px solid #d8ceea;
          border-radius: 6px;
          padding: 8px;
          background: white;
          text-align: right;
          font-size: 13px;
        }
        .actualHoursTable input:focus {
          outline: 2px solid #c2b4e3;
        }
        .actualHoursTable .actualHoursTotal {
          font-weight: 800;
          color: #4f4380;
        }
        .actualHoursTable tfoot {
          background: #e9e3f8;
          font-weight: 850;
        }
        .actualHoursNotice {
          font-size: 12px;
          padding: 12px;
          color: #66548d;
          background: #f5f0ff;
          border-radius: 8px;
        }
        .actualHoursHint {
          font-size: 11px;
          color: #6f6781;
          margin: 0;
        }
        .actualHoursBreakdown,
        .actualHoursOtherSites {
          padding: 14px;
          background: white;
          border: 1px solid #e4ddec;
          border-radius: 8px;
        }
        .actualHoursBreakdown h2,
        .actualHoursOtherSites h2 {
          font-size: 14px;
          margin: 0 0 10px;
        }
        .actualHoursBreakdown table {
          width: 100%;
          border-collapse: collapse;
        }
        .actualHoursBreakdown th,
        .actualHoursBreakdown td {
          text-align: left;
          padding: 8px;
          border-bottom: 1px solid #eee8f4;
          font-size: 12px;
        }
        .actualHoursSiteChips {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .actualHoursSiteChips button {
          background: #f8f5ff;
          color: #5d4c87;
          border: 1px solid #d2c5ec;
          border-radius: 6px;
          padding: 8px;
          font-size: 11px;
          cursor: pointer;
        }
        .actualHoursSiteChips button.isSelected {
          background: #dcd0f5;
          border-color: #947bc4;
        }
        @media (max-width: 800px) {
          .actualHoursFilters {
            grid-template-columns: 1fr;
          }
          .actualHoursMetrics {
            grid-template-columns: repeat(2, minmax(130px, 1fr));
          }
        }
      `}</style>
    </section>
  );
}

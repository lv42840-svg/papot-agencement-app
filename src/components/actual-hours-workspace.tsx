"use client";

import { EditHistory, type EditEvent } from "./edit-history";

import Link from "next/link";
import { EDIT_CONFLICT_MESSAGE } from "@/lib/edit-history";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isoWeekKey, isoWeekMonday, weekDateRangeLabel } from "@/lib/planning/time-markers";

type Activity = "BE" | "WORKSHOP" | "INSTALL";
type IndirectCategory = "SAV" | "GENERAL";
const INDIRECT_CATEGORIES = [
  { code: "SAV", label: "SAV" },
  { code: "GENERAL", label: "Frais généraux" },
] as const;
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
type IndirectRecord = {
  userId: string;
  week: string;
  category: IndirectCategory;
  hours: number;
};
type HoursSnapshot = {
  payrollWeekSignatures: Record<string, string>;
  editHistory: EditEvent[];
  editRevisions: Record<string, number>;
  week: string;
  editable: boolean;
  weekIsPast: boolean;
  people: Person[];
  chantiers: Chantier[];
  records: RecordRow[];
  indirectRecords: IndirectRecord[];
  suggestedChantierIds: Record<string, string[]>;
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

const keyFor = (chantierId: string, activity: Activity) => chantierId + ":" + activity;
const ACTIVITIES = ["BE", "WORKSHOP", "INSTALL"] as const;

export function ActualHoursWorkspace() {
  const [week, setWeek] = useState(lastCompletedWeek);
  const [data, setData] = useState<HoursSnapshot | null>(null);
  const [personId, setPersonId] = useState("");
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [extraChoice, setExtraChoice] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [indirectDrafts, setIndirectDrafts] = useState<Partial<Record<IndirectCategory, string>>>(
    {},
  );
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
      setIndirectDrafts({});
      setPersonId((old) =>
        json.people.some((person) => person.id === old) ? old : (json.people[0]?.id ?? ""),
      );
      setExtraIds([]);
      setExtraChoice("");
      setShowAdd(false);
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

  const selectedPerson = data?.people.find((person) => person.id === personId);
  const suggestedIds = data?.suggestedChantierIds?.[personId] ?? [];
  const plannedIds = new Set(suggestedIds);
  const recordedIds = useMemo(
    () =>
      new Set(
        data?.records
          .filter((entry) => entry.userId === personId)
          .map((entry) => entry.chantierId) ?? [],
      ),
    [data?.records, personId],
  );
  const visibleIds = new Set([...suggestedIds, ...recordedIds, ...extraIds]);
  const displayedChantiers =
    data?.chantiers.filter((chantier) => visibleIds.has(chantier.id)) ?? [];
  const availableChantiers =
    data?.chantiers.filter((chantier) => !visibleIds.has(chantier.id)) ?? [];
  const savedHours = useMemo(() => {
    const found = new Map<string, number>();
    for (const entry of data?.records ?? []) {
      if (entry.userId === personId) {
        found.set(keyFor(entry.chantierId, entry.activity), entry.hours);
      }
    }
    return found;
  }, [data?.records, personId]);

  const savedIndirectHours = useMemo(() => {
    const found = new Map<IndirectCategory, number>();
    for (const entry of data?.indirectRecords ?? []) {
      if (entry.userId === personId) found.set(entry.category, entry.hours);
    }
    return found;
  }, [data?.indirectRecords, personId]);

  function indirectValue(category: IndirectCategory): string {
    return indirectDrafts[category] ?? inputHours(savedIndirectHours.get(category) ?? 0);
  }
  function indirectHours(category: IndirectCategory): number {
    return parseHours(indirectValue(category)) ?? 0;
  }

  function cellValue(chantierId: string, activity: Activity): string {
    const key = keyFor(chantierId, activity);
    return drafts[key] ?? inputHours(savedHours.get(key) ?? 0);
  }
  function cellHours(chantierId: string, activity: Activity): number {
    return parseHours(cellValue(chantierId, activity)) ?? 0;
  }
  function totalForSite(chantierId: string): number {
    return ACTIVITIES.reduce((sum, activity) => sum + cellHours(chantierId, activity), 0);
  }
  const totalSiteWeek = displayedChantiers.reduce(
    (sum, chantier) => sum + totalForSite(chantier.id),
    0,
  );
  const totalIndirectWeek = INDIRECT_CATEGORIES.reduce(
    (sum, category) => sum + indirectHours(category.code),
    0,
  );
  const totalForWeek = totalSiteWeek + totalIndirectWeek;

  function choosePerson(nextId: string) {
    setPersonId(nextId);
    setDrafts({});
    setIndirectDrafts({});
    setExtraIds([]);
    setExtraChoice("");
    setShowAdd(false);
    setMessage("");
  }

  function addChantier() {
    if (!extraChoice || visibleIds.has(extraChoice)) return;
    setExtraIds((previous) => [...previous, extraChoice]);
    setExtraChoice("");
    setShowAdd(false);
  }

  async function saveChantier(chantierId: string) {
    if (!data?.editable || !personId || saving) return;
    const be = parseHours(cellValue(chantierId, "BE"));
    const workshop = parseHours(cellValue(chantierId, "WORKSHOP"));
    const install = parseHours(cellValue(chantierId, "INSTALL"));
    if (be === null || workshop === null || install === null) {
      setMessage(
        "Heures invalides : utilise un nombre positif avec deux décimales maximum (ex. 7,5).",
      );
      return;
    }
    if (be + workshop + install > 168) {
      setMessage("Une personne ne peut pas dépasser 168 h par chantier et par semaine.");
      return;
    }
    setSaving(chantierId);
    setMessage("");
    try {
      const response = await fetch("/api/desktop/planning/actual-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveActualHoursRow",
          expectedRevision: data.editRevisions?.[`${week}:${personId}:${chantierId}`] ?? 0,
          week,
          userId: personId,
          chantierId,
          be,
          workshop,
          install,
        }),
      });
      const json = (await response.json()) as HoursSnapshot & { error?: string };
      if (!response.ok)
        throw new Error(
          json.error === "EDIT_VERSION_CONFLICT"
            ? EDIT_CONFLICT_MESSAGE
            : (json.error ?? "Enregistrement impossible."),
        );
      setData((old) =>
        old
          ? {
              ...json,
              records: [
                ...old.records.filter(
                  (row) => !(row.userId === personId && row.chantierId === chantierId),
                ),
                ...json.records.filter(
                  (row) => row.userId === personId && row.chantierId === chantierId,
                ),
              ],
              indirectRecords: old.indirectRecords,
              editRevisions: {
                ...old.editRevisions,
                [`${week}:${personId}:${chantierId}`]:
                  json.editRevisions[`${week}:${personId}:${chantierId}`],
              },
            }
          : json,
      );
      setDrafts((old) => {
        const next = { ...old };
        for (const activity of ACTIVITIES) delete next[keyFor(chantierId, activity)];
        return next;
      });
      setMessage("Heures enregistrées pour ce salarié et ce chantier.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSaving(null);
    }
  }

  async function saveIndirect(category: IndirectCategory) {
    if (!data?.editable || !personId || saving) return;
    const hours = parseHours(indirectValue(category));
    if (hours === null) {
      setMessage("Heures invalides : utilise un nombre positif avec deux décimales maximum.");
      return;
    }
    setSaving("indirect:" + category);
    setMessage("");
    try {
      const response = await fetch("/api/desktop/planning/actual-hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveIndirectHoursRow",
          expectedRevision: data.editRevisions?.[`${week}:${personId}:indirect:${category}`] ?? 0,
          week,
          userId: personId,
          category,
          hours,
        }),
      });
      const json = (await response.json()) as HoursSnapshot & { error?: string };
      if (!response.ok)
        throw new Error(
          json.error === "EDIT_VERSION_CONFLICT"
            ? EDIT_CONFLICT_MESSAGE
            : (json.error ?? "Enregistrement impossible."),
        );
      setData((old) =>
        old
          ? {
              ...json,
              records: old.records,
              indirectRecords: [
                ...old.indirectRecords.filter(
                  (row) => !(row.userId === personId && row.category === category),
                ),
                ...json.indirectRecords.filter(
                  (row) => row.userId === personId && row.category === category,
                ),
              ],
              editRevisions: {
                ...old.editRevisions,
                [`${week}:${personId}:indirect:${category}`]:
                  json.editRevisions[`${week}:${personId}:indirect:${category}`],
              },
            }
          : json,
      );
      setIndirectDrafts((old) => {
        const next = { ...old };
        delete next[category];
        return next;
      });
      setMessage(
        category === "SAV"
          ? "Heures SAV enregistrées, sans rattachement à un chantier."
          : "Heures de frais généraux enregistrées.",
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Enregistrement impossible.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="papotActualHours">
      <div className="actualHoursHeader">
        <div>
          <p className="eyebrow">PAPOT AGENCEMENT · PRODUCTION</p>
          <h1>Saisie des heures réelles</h1>
          <p>
            Choisis une personne, puis retrouve ses chantiers de la semaine. Tu peux aussi ajouter
            un chantier absent du petit planning.
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
          1 · Salarié
          <select
            aria-label="Salarié concerné"
            value={personId}
            disabled={loading || !data?.people.length || saving !== null}
            onChange={(event) => choosePerson(event.target.value)}
          >
            {!data?.people.length ? <option value="">Aucun salarié</option> : null}
            {data?.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          2 · Semaine écoulée
          <div className="actualHoursWeekControls">
            <button
              type="button"
              className="secondaryButton"
              disabled={saving !== null}
              onClick={() => setWeek(relativeWeek(week, -1))}
            >
              ←
            </button>
            <input
              type="week"
              aria-label="Semaine de saisie"
              value={week}
              disabled={saving !== null}
              onChange={(event) => {
                if (/^\d{4}-W\d{2}$/.test(event.target.value)) setWeek(event.target.value);
              }}
            />
            <button
              type="button"
              className="secondaryButton"
              disabled={saving !== null || relativeWeek(week, 1) >= isoWeekKey(new Date())}
              onClick={() => setWeek(relativeWeek(week, 1))}
            >
              →
            </button>
          </div>
          <small>{weekDateRangeLabel(week)}</small>
        </label>
      </div>

      {loading ? <p className="actualHoursNotice">Chargement…</p> : null}
      {error ? (
        <p className="actualHoursNotice" role="alert">
          {error}{" "}
          <button type="button" onClick={() => void load()}>
            Réessayer
          </button>
        </p>
      ) : null}

      {data && !loading && selectedPerson ? (
        <>
          {!data.weekIsPast ? (
            <p className="actualHoursNotice">
              Cette semaine n&apos;est pas terminée. Choisis une semaine écoulée pour saisir les
              heures réelles.
            </p>
          ) : null}
          {data.weekIsPast && !data.editable ? (
            <p className="actualHoursNotice">
              Lecture seule : le droit « Saisir les heures passées » est requis.
            </p>
          ) : null}

          <div className="actualHoursMetrics">
            <div>
              <small>Salarié</small>
              <strong>{selectedPerson.name}</strong>
            </div>
            <div>
              <small>Chantiers prévus cette semaine</small>
              <strong>{suggestedIds.length}</strong>
            </div>
            <div>
              <small>Chantiers avec heures enregistrées</small>
              <strong>{recordedIds.size}</strong>
            </div>
            <div>
              <small>Total salarié / semaine</small>
              <strong>{formatHours(totalForWeek)} h</strong>
            </div>
          </div>

          <div className="actualHoursTableWrap">
            <table className="actualHoursTable">
              <thead>
                <tr>
                  <th scope="col">Chantier</th>
                  <th scope="col">BE (h)</th>
                  <th scope="col">Atelier (h)</th>
                  <th scope="col">Pose (h)</th>
                  <th scope="col">Total (h)</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {displayedChantiers.map((chantier) => {
                  const dirty = ACTIVITIES.some(
                    (activity) => drafts[keyFor(chantier.id, activity)] !== undefined,
                  );
                  return (
                    <tr key={chantier.id}>
                      <th scope="row">
                        {chantier.reference ? chantier.reference + " · " : ""}
                        {chantier.name}
                        <small className="actualHoursSiteSource">
                          {plannedIds.has(chantier.id)
                            ? "Prévu au petit planning"
                            : recordedIds.has(chantier.id)
                              ? "Heures déjà enregistrées"
                              : "Ajout manuel"}
                        </small>
                      </th>
                      {ACTIVITIES.map((activity) => (
                        <td key={activity}>
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={chantier.name + " " + activity}
                            value={cellValue(chantier.id, activity)}
                            placeholder="0"
                            disabled={!data.editable || saving !== null}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [keyFor(chantier.id, activity)]: event.target.value,
                              }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void saveChantier(chantier.id);
                              }
                            }}
                          />
                        </td>
                      ))}
                      <td className="actualHoursTotal">
                        {formatHours(totalForSite(chantier.id))} h
                      </td>
                      <td>
                        <button
                          className="secondaryButton"
                          type="button"
                          disabled={!data.editable || saving !== null || !dirty}
                          onClick={() => void saveChantier(chantier.id)}
                        >
                          {saving === chantier.id ? "Enregistrement…" : "Enregistrer"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {displayedChantiers.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      Aucun chantier prévu pour cette personne cette semaine. Utilise « + Ajouter un
                      chantier » pour saisir du réalisé.
                    </td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total chantiers / semaine</th>
                  {ACTIVITIES.map((activity) => (
                    <td key={activity}>
                      {formatHours(
                        displayedChantiers.reduce(
                          (sum, chantier) => sum + cellHours(chantier.id, activity),
                          0,
                        ),
                      )}{" "}
                      h
                    </td>
                  ))}
                  <td>{formatHours(totalSiteWeek)} h</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="actualHoursAddSite">
            {!showAdd ? (
              <button
                type="button"
                className="secondaryButton"
                disabled={!data.editable || saving !== null || availableChantiers.length === 0}
                onClick={() => setShowAdd(true)}
              >
                + Ajouter un chantier
              </button>
            ) : (
              <>
                <label>
                  Chantier supplémentaire
                  <select
                    aria-label="Chantier à ajouter"
                    value={extraChoice}
                    onChange={(event) => setExtraChoice(event.target.value)}
                  >
                    <option value="">Choisir un chantier…</option>
                    {availableChantiers.map((chantier) => (
                      <option key={chantier.id} value={chantier.id}>
                        {chantier.reference ? chantier.reference + " · " : ""}
                        {chantier.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={!extraChoice}
                  onClick={addChantier}
                >
                  Ajouter
                </button>
                <button
                  type="button"
                  className="secondaryButton"
                  onClick={() => {
                    setExtraChoice("");
                    setShowAdd(false);
                  }}
                >
                  Annuler
                </button>
              </>
            )}
          </div>
          <section className="actualHoursIndirectPanel" aria-label="Heures hors chantier">
            <h2>Heures hors chantier</h2>
            <p>Saisie simple : aucun SAV ni frais généraux n’est rattaché à un chantier.</p>
            <div className="actualHoursIndirectRows">
              {INDIRECT_CATEGORIES.map((entry) => {
                const dirty = indirectDrafts[entry.code] !== undefined;
                return (
                  <div className="actualHoursIndirectRow" key={entry.code}>
                    <label htmlFor={"indirect-" + entry.code}>{entry.label}</label>
                    <input
                      id={"indirect-" + entry.code}
                      aria-label={"Heures " + entry.label}
                      type="text"
                      inputMode="decimal"
                      value={indirectValue(entry.code)}
                      placeholder="0"
                      disabled={!data.editable || saving !== null}
                      onChange={(event) =>
                        setIndirectDrafts((old) => ({
                          ...old,
                          [entry.code]: event.target.value,
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void saveIndirect(entry.code);
                        }
                      }}
                    />
                    <span>h</span>
                    <button
                      type="button"
                      className="secondaryButton"
                      disabled={!data.editable || saving !== null || !dirty}
                      onClick={() => void saveIndirect(entry.code)}
                    >
                      {saving === "indirect:" + entry.code ? "Enregistrement…" : "Enregistrer"}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="actualHoursHint">
              Total heures hors chantier : {formatHours(totalIndirectWeek)} h. Ces heures sont
              valorisées avec le coût employeur mensuel et diminuent la rentabilité globale, pas
              celle d’un chantier.
            </p>
          </section>

          {totalForWeek > 168 ? (
            <p className="actualHoursNotice" role="alert">
              Le total chantiers + SAV + frais généraux dépasse 168 h pour cette semaine. Corrige
              les valeurs avant de les enregistrer.
            </p>
          ) : null}
          <p className="actualHoursHint">
            Les chantiers proposés viennent du petit planning. Les chantiers avec des heures déjà
            enregistrées restent visibles. Tu peux ajouter un chantier non prévu. Les heures réelles
            ne modifient pas les affectations du petit planning.
          </p>
        </>
      ) : null}

      {message ? (
        <p className="actualHoursNotice" role="status">
          {message}
        </p>
      ) : null}

      {data ? <EditHistory events={data.editHistory ?? []} people={data.people} /> : null}
      {data?.editable && personId ? (
        <button
          type="button"
          className="secondaryButton"
          disabled={
            !!saving || Object.keys(drafts).length > 0 || Object.keys(indirectDrafts).length > 0
          }
          onClick={async () => {
            const response = await fetch("/api/desktop/planning/actual-hours", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "confirmPayrollWeek",
                week,
                userId: personId,
                expectedSignature: data.payrollWeekSignatures[personId],
              }),
            });
            const result = await response.json();
            if (!response.ok) {
              setMessage(
                result.error === "EDIT_VERSION_CONFLICT"
                  ? EDIT_CONFLICT_MESSAGE
                  : "Validation impossible.",
              );
              return;
            }
            setData(result);
            setMessage("Semaine validée pour la préparation de paie.");
          }}
        >
          Valider la semaine pour la paie
        </button>
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
        .actualHoursSiteSource {
          display: block;
          color: #786d8a;
          font-weight: 500;
          font-size: 10px;
          margin-top: 4px;
        }
        .actualHoursAddSite {
          display: flex;
          align-items: end;
          gap: 9px;
          flex-wrap: wrap;
        }
        .actualHoursAddSite label {
          display: grid;
          gap: 5px;
          min-width: 285px;
          font-size: 12px;
          font-weight: 750;
        }
        .actualHoursAddSite select {
          min-width: 0;
          width: 100%;
          padding: 9px;
          border: 1px solid #cec4dd;
          border-radius: 6px;
          background: white;
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
        .actualHoursIndirectPanel {
          display: grid;
          gap: 11px;
          padding: 16px;
          border: 1px solid #ddd4ec;
          background: #fbfaff;
          border-radius: 10px;
        }
        .actualHoursIndirectPanel h2 {
          margin: 0;
          font-size: 15px;
          color: #5d498a;
        }
        .actualHoursIndirectPanel > p {
          margin: 0;
          font-size: 11px;
          color: #726783;
        }
        .actualHoursIndirectRows {
          display: grid;
          gap: 8px;
        }
        .actualHoursIndirectRow {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          padding: 9px 12px;
          border: 1px solid #e7e1f0;
          border-radius: 8px;
          background: white;
        }
        .actualHoursIndirectRow label {
          flex: 1 1 180px;
          font-weight: 750;
          font-size: 12px;
        }
        .actualHoursIndirectRow input {
          width: 100px;
          border: 1px solid #d8ceea;
          border-radius: 6px;
          padding: 9px;
          text-align: right;
        }
        .actualHoursIndirectRow span {
          color: #776b89;
          font-size: 12px;
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

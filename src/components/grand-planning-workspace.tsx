"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  GrandPlanningChantierRow,
  GrandPlanningProvisionRow,
  PlanningActivity,
} from "@/lib/planning/domain";

type WeeklyCapacity = {
  week: string;
  totalCapacityHours: number;
  firmLoadHours: number;
  provisionalLoadHours: number;
  firmAvailableHours: number;
  availableWithProvisionHours: number;
};
type PersonCapacity = {
  userId: string;
  displayName: string;
  countsInMacroCapacity: boolean;
  weeklySchedule: {
    monday: number;
    tuesday: number;
    wednesday: number;
    thursday: number;
    friday: number;
    saturday: number;
    sunday: number;
  };
};
type PlanningAbsence = {
  id: string;
  userId: string;
  displayName: string;
  type: "VACATION" | "SICK" | "OTHER";
  typeLabel: string;
  date: string;
  hours: number;
};
type PlanningSnapshot = {
  year: number;
  weeks: string[];
  rows: GrandPlanningChantierRow[];
  provisionalRows: GrandPlanningProvisionRow[];
  weeklyCapacity: WeeklyCapacity[];
  peopleCapacity: PersonCapacity[];
  absences: PlanningAbsence[];
  capabilities: {
    canRead: boolean;
    canEditMacro: boolean;
    canManageSchedules: boolean;
  };
};

function cellKey(
  kind: "firm" | "provisional",
  id: string,
  activity: PlanningActivity,
  week: string,
) {
  return `${kind}:${id}:${activity}:${week}`;
}

function weekLabel(week: string) {
  return `S${week.slice(-2)}`;
}

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

const WEEKDAYS = [
  ["monday", "Lun"],
  ["tuesday", "Mar"],
  ["wednesday", "Mer"],
  ["thursday", "Jeu"],
  ["friday", "Ven"],
  ["saturday", "Sam"],
  ["sunday", "Dim"],
] as const;

function parseHours(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return 0;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function GrandPlanningWorkspace({ initialYear }: { initialYear: number }) {
  const [snapshot, setSnapshot] = useState<PlanningSnapshot | null>(null);
  const [message, setMessage] = useState("Chargement du planning…");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, string>>({});
  const [absenceUserId, setAbsenceUserId] = useState("");
  const [absenceType, setAbsenceType] = useState<PlanningAbsence["type"]>("VACATION");
  const [absenceDate, setAbsenceDate] = useState(`${initialYear}-01-01`);
  const [absenceHours, setAbsenceHours] = useState("7,8");
  const [absenceWeek, setAbsenceWeek] = useState(`${initialYear}-W01`);
  const [absenceEditId, setAbsenceEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMessage("Chargement du planning…");
    const response = await fetch(`/api/desktop/planning?year=${initialYear}`, {
      cache: "no-store",
    });
    const result = (await response.json()) as PlanningSnapshot & { error?: string };
    if (!response.ok) {
      setMessage(result.error ?? "Impossible de charger le planning.");
      return;
    }
    setSnapshot(result);
    setAbsenceUserId((current) => current || result.peopleCapacity[0]?.userId || "");
    setMessage("");
  }, [initialYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const capacityByWeek = useMemo(
    () => new Map(snapshot?.weeklyCapacity.map((item) => [item.week, item]) ?? []),
    [snapshot],
  );

  const unallocated = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.rows
      .map((chantier) => ({
        chantierId: chantier.chantierId,
        name: chantier.name,
        activities: chantier.activities.filter((activity) => activity.remainingHours !== 0),
      }))
      .filter((chantier) => chantier.activities.length > 0);
  }, [snapshot]);

  const provisionalUnallocated = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.provisionalRows
      .map((item) => ({
        ...item,
        activities: item.activities.filter((activity) => activity.remainingHours !== 0),
      }))
      .filter((item) => item.activities.length > 0);
  }, [snapshot]);

  function scheduleDraftKey(userId: string, day: keyof PersonCapacity["weeklySchedule"]) {
    return `${userId}:${day}`;
  }

  async function saveScheduleDay(
    person: PersonCapacity,
    day: keyof PersonCapacity["weeklySchedule"],
  ) {
    if (!snapshot?.capabilities.canManageSchedules) return;
    const key = scheduleDraftKey(person.userId, day);
    const raw = scheduleDrafts[key] ?? formatHours(person.weeklySchedule[day]);
    const hours = parseHours(raw);
    if (hours == null || hours > 24) {
      setScheduleDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setMessage("Horaire invalide : saisissez entre 0 et 24 h.");
      return;
    }
    if (hours === person.weeklySchedule[day]) {
      setScheduleDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    await savePersonCapacity({
      ...person,
      weeklySchedule: { ...person.weeklySchedule, [day]: hours },
    });
    setScheduleDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function savePersonCapacity(person: PersonCapacity) {
    if (!snapshot?.capabilities.canManageSchedules) return;
    setSavingKey(`capacity:${person.userId}`);
    setMessage("Enregistrement de la capacité…");
    const response = await fetch("/api/desktop/planning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "setPersonCapacity",
        year: snapshot.year,
        userId: person.userId,
        countsInMacroCapacity: person.countsInMacroCapacity,
        weeklySchedule: person.weeklySchedule,
      }),
    });
    const result = (await response.json()) as PlanningSnapshot & { error?: string };
    if (!response.ok) {
      setMessage(result.error ?? "Enregistrement impossible.");
      setSavingKey(null);
      return;
    }
    setSnapshot(result);
    setSavingKey(null);
    setMessage("Capacité enregistrée.");
  }

  async function postPlanningMutation(body: Record<string, unknown>, successMessage: string) {
    if (!snapshot) return false;
    setSavingKey("planning-mutation");
    setMessage("Enregistrement…");
    const response = await fetch("/api/desktop/planning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, year: snapshot.year }),
    });
    const result = (await response.json()) as PlanningSnapshot & { error?: string };
    if (!response.ok) {
      setMessage(result.error ?? "Enregistrement impossible.");
      setSavingKey(null);
      return false;
    }
    setSnapshot(result);
    setMessage(successMessage);
    setSavingKey(null);
    return true;
  }

  async function movePotential(caseId: string, direction: -1 | 1) {
    if (!snapshot?.capabilities.canEditMacro) return;
    const orderedCaseIds = snapshot.provisionalRows.map((item) => item.caseId);
    const currentIndex = orderedCaseIds.indexOf(caseId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedCaseIds.length) return;

    [orderedCaseIds[currentIndex], orderedCaseIds[nextIndex]] = [
      orderedCaseIds[nextIndex],
      orderedCaseIds[currentIndex],
    ];

    await postPlanningMutation(
      { action: "setPotentialOrder", orderedCaseIds },
      "Ordre du potentiel enregistré.",
    );
  }

  async function saveAbsence() {
    if (!snapshot?.capabilities.canManageSchedules || !absenceUserId) return;
    const hours = parseHours(absenceHours);
    if (hours == null || hours <= 0 || hours > 24) {
      setMessage("Absence invalide : saisissez entre 0 et 24 h.");
      return;
    }
    const saved = await postPlanningMutation(
      {
        action: "setAbsence",
        id: absenceEditId ?? undefined,
        userId: absenceUserId,
        type: absenceType,
        date: absenceDate,
        hours,
      },
      "Absence enregistrée.",
    );
    if (saved) {
      setAbsenceEditId(null);
    }
  }

  async function saveFullWeekAbsence() {
    if (!snapshot?.capabilities.canManageSchedules || !absenceUserId) return;
    const saved = await postPlanningMutation(
      {
        action: "setFullWeekAbsence",
        userId: absenceUserId,
        type: absenceType,
        week: absenceWeek,
      },
      "Semaine d’absence enregistrée.",
    );
    if (saved) setAbsenceEditId(null);
  }

  async function deleteAbsence(absenceId: string) {
    if (!snapshot?.capabilities.canManageSchedules) return;
    await postPlanningMutation({ action: "deleteAbsence", absenceId }, "Absence supprimée.");
  }

  function editAbsence(absence: PlanningAbsence) {
    setAbsenceEditId(absence.id);
    setAbsenceUserId(absence.userId);
    setAbsenceType(absence.type);
    setAbsenceDate(absence.date);
    setAbsenceHours(formatHours(absence.hours));
  }

  async function saveCell(
    chantierId: string,
    activity: PlanningActivity,
    week: string,
    displayedValue: number,
  ) {
    if (!snapshot?.capabilities.canEditMacro) return;
    const key = cellKey("firm", chantierId, activity, week);
    const raw = drafts[key] ?? formatHours(displayedValue);
    const hours = parseHours(raw);

    if (hours == null) {
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setMessage("Valeur invalide : saisissez un nombre d’heures positif.");
      return;
    }

    if (hours === displayedValue) {
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }

    setSavingKey(key);
    setMessage("Enregistrement…");
    const response = await fetch("/api/desktop/planning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "setMacroHours",
        year: snapshot.year,
        chantierId,
        activity,
        week,
        hours,
      }),
    });
    const result = (await response.json()) as PlanningSnapshot & { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? "Enregistrement impossible.");
      setSavingKey(null);
      return;
    }

    setSnapshot(result);
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSavingKey(null);
    setMessage("Planning enregistré.");
  }

  async function saveProvisionalCell(
    caseId: string,
    activity: PlanningActivity,
    week: string,
    displayedValue: number,
  ) {
    if (!snapshot?.capabilities.canEditMacro) return;
    const key = cellKey("provisional", caseId, activity, week);
    const raw = drafts[key] ?? formatHours(displayedValue);
    const hours = parseHours(raw);

    if (hours == null) {
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setMessage("Valeur invalide : saisissez un nombre d’heures positif.");
      return;
    }

    if (hours === displayedValue) {
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }

    setSavingKey(key);
    setMessage("Enregistrement du provisionnel…");
    const response = await fetch("/api/desktop/planning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "setProvisionHours",
        year: snapshot.year,
        caseId,
        activity,
        week,
        hours,
      }),
    });
    const result = (await response.json()) as PlanningSnapshot & { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? "Enregistrement impossible.");
      setSavingKey(null);
      return;
    }

    setSnapshot(result);
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setSavingKey(null);
    setMessage("Charge provisionnelle enregistrée.");
  }

  return (
    <div className="grandPlanningWorkspace">
      <div className="pageHeader grandPlanningHeader">
        <div>
          <p className="eyebrow">Planning</p>
          <h1>Grand planning {initialYear}</h1>
          <p className="muted">
            Charges fermes et provisionnelles · BE / Atelier / Pose · saisie directe par semaine
          </p>
        </div>
        <div className="grandPlanningYearNav" aria-label="Navigation année">
          <Link className="secondaryButton" href={`/planning?year=${initialYear - 1}`}>
            ← {initialYear - 1}
          </Link>
          <Link className="secondaryButton" href={`/planning?year=${initialYear + 1}`}>
            {initialYear + 1} →
          </Link>
        </div>
      </div>

      {unallocated.length > 0 ? (
        <section className="planningUnallocatedPanel" aria-label="Heures à répartir">
          <div className="planningUnallocatedHeader">
            <div>
              <p className="eyebrow">À répartir</p>
              <h2>Charges fermes non étalées</h2>
            </div>
            <strong>
              {formatHours(
                unallocated.reduce(
                  (total, chantier) =>
                    total +
                    chantier.activities.reduce(
                      (subtotal, activity) => subtotal + activity.remainingHours,
                      0,
                    ),
                  0,
                ),
              )}{" "}
              h
            </strong>
          </div>
          <div className="planningUnallocatedList">
            {unallocated.map((chantier) => (
              <div className="planningUnallocatedRow" key={chantier.chantierId}>
                <strong>{chantier.name}</strong>
                <div>
                  {chantier.activities.map((activity) => (
                    <span
                      className={
                        activity.remainingHours > 0
                          ? "planningRemainingPositive"
                          : "planningRemainingNegative"
                      }
                      key={activity.activity}
                    >
                      {activity.label} {formatHours(activity.remainingHours)} h
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {provisionalUnallocated.length > 0 ? (
        <section
          className="planningUnallocatedPanel planningProvisionUnallocatedPanel"
          aria-label="Charges provisionnelles à répartir"
        >
          <div className="planningUnallocatedHeader">
            <div>
              <p className="eyebrow">Provisionnel</p>
              <h2>Charges commerciales à répartir</h2>
              <p className="muted">
                Affaires non confirmées. Ces heures ne sont pas comptées dans la charge ferme.
              </p>
            </div>
            <strong>
              {formatHours(
                provisionalUnallocated.reduce(
                  (total, item) =>
                    total +
                    item.activities.reduce(
                      (subtotal, activity) => subtotal + activity.remainingHours,
                      0,
                    ),
                  0,
                ),
              )}{" "}
              h
            </strong>
          </div>
          <div className="planningUnallocatedList">
            {provisionalUnallocated.map((item) => (
              <div className="planningUnallocatedRow" key={item.caseId}>
                <div className="planningProvisionCaseMeta">
                  <strong>{item.name}</strong>
                  <span>{item.statusLabel}</span>
                  {item.expectedConfirmationDate ? (
                    <small>Confirmation prévue {item.expectedConfirmationDate}</small>
                  ) : null}
                </div>
                <div>
                  {item.activities.map((activity) => (
                    <span key={activity.activity}>
                      {activity.label} {formatHours(activity.remainingHours)} h
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {snapshot ? (
        <section className="planningCapacitySettings">
          <div className="planningCapacitySettingsHeader">
            <div>
              <p className="eyebrow">Capacité équipe</p>
              <h2>Personnes comptées dans le grand planning</h2>
            </div>
            {!snapshot.capabilities.canManageSchedules ? (
              <span className="planningReadOnly">Lecture seule</span>
            ) : null}
          </div>
          <div className="planningScheduleTableWrap">
            <table className="planningScheduleTable">
              <thead>
                <tr>
                  <th>Personne</th>
                  <th>Capacité</th>
                  {WEEKDAYS.map(([, label]) => (
                    <th key={label}>{label}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.peopleCapacity.map((person) => (
                  <tr key={person.userId}>
                    <th scope="row">{person.displayName}</th>
                    <td>
                      <label className="planningCapacityToggle">
                        <input
                          type="checkbox"
                          checked={person.countsInMacroCapacity}
                          disabled={
                            !snapshot.capabilities.canManageSchedules ||
                            savingKey === `capacity:${person.userId}`
                          }
                          onChange={(event) =>
                            void savePersonCapacity({
                              ...person,
                              countsInMacroCapacity: event.target.checked,
                            })
                          }
                        />
                        <span>{person.countsInMacroCapacity ? "Oui" : "Non"}</span>
                      </label>
                    </td>
                    {WEEKDAYS.map(([day, label]) => {
                      const key = scheduleDraftKey(person.userId, day);
                      return (
                        <td key={day}>
                          <input
                            aria-label={`${person.displayName} ${label}`}
                            className="planningScheduleHours"
                            disabled={
                              !snapshot.capabilities.canManageSchedules ||
                              savingKey === `capacity:${person.userId}`
                            }
                            inputMode="decimal"
                            value={scheduleDrafts[key] ?? formatHours(person.weeklySchedule[day])}
                            onChange={(event) =>
                              setScheduleDrafts((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))
                            }
                            onBlur={() => void saveScheduleDay(person, day)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                              if (event.key === "Escape") {
                                setScheduleDrafts((current) => {
                                  const next = { ...current };
                                  delete next[key];
                                  return next;
                                });
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        </td>
                      );
                    })}
                    <td className="planningScheduleTotal">
                      {formatHours(
                        Object.values(person.weeklySchedule).reduce((sum, hours) => sum + hours, 0),
                      )}{" "}
                      h
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {snapshot ? (
        <section className="planningAbsenceSettings">
          <div className="planningCapacitySettingsHeader">
            <div>
              <p className="eyebrow">Indisponibilités</p>
              <h2>Congés, arrêts et autres absences</h2>
            </div>
            {!snapshot.capabilities.canManageSchedules ? (
              <span className="planningReadOnly">Lecture seule</span>
            ) : null}
          </div>

          <div className="planningAbsenceForm">
            <label>
              Personne
              <select
                value={absenceUserId}
                disabled={!snapshot.capabilities.canManageSchedules}
                onChange={(event) => setAbsenceUserId(event.target.value)}
              >
                {snapshot.peopleCapacity.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select
                value={absenceType}
                disabled={!snapshot.capabilities.canManageSchedules}
                onChange={(event) => setAbsenceType(event.target.value as PlanningAbsence["type"])}
              >
                <option value="VACATION">Congés</option>
                <option value="SICK">Arrêt</option>
                <option value="OTHER">Autre</option>
              </select>
            </label>
            <label>
              Date
              <input
                type="date"
                value={absenceDate}
                disabled={!snapshot.capabilities.canManageSchedules}
                onChange={(event) => setAbsenceDate(event.target.value)}
              />
            </label>
            <label>
              Heures
              <input
                className="planningAbsenceHours"
                inputMode="decimal"
                value={absenceHours}
                disabled={!snapshot.capabilities.canManageSchedules}
                onChange={(event) => setAbsenceHours(event.target.value)}
              />
            </label>
            <button
              className="secondaryButton"
              type="button"
              disabled={
                !snapshot.capabilities.canManageSchedules || savingKey === "planning-mutation"
              }
              onClick={() => void saveAbsence()}
            >
              {absenceEditId ? "Modifier l’absence" : "Ajouter l’absence"}
            </button>
            {absenceEditId ? (
              <button
                className="secondaryButton"
                type="button"
                onClick={() => setAbsenceEditId(null)}
              >
                Annuler
              </button>
            ) : null}
          </div>

          <div className="planningFullWeekForm">
            <label>
              Semaine complète
              <input
                type="week"
                value={absenceWeek}
                disabled={!snapshot.capabilities.canManageSchedules}
                onChange={(event) => setAbsenceWeek(event.target.value)}
              />
            </label>
            <button
              className="secondaryButton"
              type="button"
              disabled={
                !snapshot.capabilities.canManageSchedules || savingKey === "planning-mutation"
              }
              onClick={() => void saveFullWeekAbsence()}
            >
              Mettre toute la semaine en absence
            </button>
          </div>

          <div className="planningAbsenceList">
            {snapshot.absences.length === 0 ? (
              <p className="muted">Aucune absence enregistrée sur {snapshot.year}.</p>
            ) : (
              snapshot.absences.map((absence) => (
                <div className="planningAbsenceRow" key={absence.id}>
                  <div>
                    <strong>{absence.displayName}</strong>
                    <span>{absence.date}</span>
                    <span>{absence.typeLabel}</span>
                    <span>{formatHours(absence.hours)} h</span>
                  </div>
                  {snapshot.capabilities.canManageSchedules ? (
                    <div className="planningAbsenceActions">
                      <button
                        className="secondaryButton"
                        type="button"
                        onClick={() => editAbsence(absence)}
                      >
                        Modifier
                      </button>
                      <button
                        className="secondaryButton"
                        type="button"
                        onClick={() => void deleteAbsence(absence.id)}
                      >
                        Supprimer
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      <section className="panel grandPlanningPanel">
        <div className="grandPlanningLegend">
          <span>
            <strong>Prévu</strong> = volume chantier
          </span>
          <span>
            <strong>À répartir</strong> = volume de référence − semaines déjà positionnées
          </span>
          <span>
            <strong>Provisionnel</strong> = affaire non confirmée, affichée plus claire
          </span>
          {!snapshot?.capabilities.canEditMacro ? (
            <span className="planningReadOnly">Lecture seule</span>
          ) : null}
        </div>

        {message ? <p className="planningMessage">{message}</p> : null}

        {snapshot ? (
          <div className="grandPlanningScroller">
            <table className="grandPlanningTable">
              <thead>
                <tr>
                  <th className="planningSticky planningChantierColumn">Chantier</th>
                  <th className="planningSticky planningActivityColumn">Activité</th>
                  <th className="planningSticky planningMetricColumn">Prévu</th>
                  <th className="planningSticky planningMetricColumn planningRemainingColumn">
                    À répartir
                  </th>
                  {snapshot.weeks.map((week) => {
                    const capacity = capacityByWeek.get(week);
                    return (
                      <th className="planningWeekHead" key={week} title={week}>
                        <strong>{weekLabel(week)}</strong>
                        <span>Cap. {formatHours(capacity?.totalCapacityHours ?? 0)}</span>
                        <span>Ferme {formatHours(capacity?.firmLoadHours ?? 0)}</span>
                        <span className="planningWeekProvisional">
                          Prov. {formatHours(capacity?.provisionalLoadHours ?? 0)}
                        </span>
                        <span
                          className={
                            (capacity?.firmAvailableHours ?? 0) < 0
                              ? "planningWeekAvailable isNegative"
                              : "planningWeekAvailable"
                          }
                          title="Disponible ferme"
                        >
                          Dispo F {formatHours(capacity?.firmAvailableHours ?? 0)}
                        </span>
                        <span
                          className={
                            (capacity?.availableWithProvisionHours ?? 0) < 0
                              ? "planningWeekAvailable planningWeekWithProvision isNegative"
                              : "planningWeekAvailable planningWeekWithProvision"
                          }
                          title="Disponible avec provisionnel"
                        >
                          Dispo +P {formatHours(capacity?.availableWithProvisionHours ?? 0)}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.length === 0 && snapshot.provisionalRows.length === 0 ? (
                  <tr>
                    <td className="planningEmpty" colSpan={snapshot.weeks.length + 4}>
                      Aucun chantier ou affaire provisionnelle à planifier.
                    </td>
                  </tr>
                ) : null}

                {snapshot.rows.flatMap((chantier) =>
                  chantier.activities.map((activity, activityIndex) => (
                    <tr
                      className={activityIndex === 0 ? "planningChantierStart" : undefined}
                      key={`firm:${chantier.chantierId}:${activity.activity}`}
                    >
                      {activityIndex === 0 ? (
                        <th
                          className="planningSticky planningChantierCell"
                          rowSpan={3}
                          scope="rowgroup"
                        >
                          <strong>{chantier.name}</strong>
                          {chantier.reference ? <span>{chantier.reference}</span> : null}
                          <small>Pose prévue {chantier.plannedInstallDate}</small>
                        </th>
                      ) : null}
                      <th className="planningSticky planningActivityCell" scope="row">
                        {activity.label}
                      </th>
                      <td className="planningSticky planningMetricCell">
                        {formatHours(activity.plannedHours)}
                      </td>
                      <td
                        className={`planningSticky planningMetricCell planningRemainingCell ${
                          activity.remainingHours > 0
                            ? "isPositive"
                            : activity.remainingHours < 0
                              ? "isNegative"
                              : "isZero"
                        }`}
                      >
                        {formatHours(activity.remainingHours)}
                      </td>
                      {snapshot.weeks.map((week) => {
                        const current = activity.weeklyHours[week] ?? 0;
                        const key = cellKey("firm", chantier.chantierId, activity.activity, week);
                        return (
                          <td className="planningWeekCell" key={week}>
                            <input
                              aria-label={`${chantier.name} ${activity.label} ${week}`}
                              className={savingKey === key ? "isSaving" : undefined}
                              disabled={!snapshot.capabilities.canEditMacro || savingKey === key}
                              inputMode="decimal"
                              value={drafts[key] ?? (current === 0 ? "" : formatHours(current))}
                              onChange={(event) =>
                                setDrafts((currentDrafts) => ({
                                  ...currentDrafts,
                                  [key]: event.target.value,
                                }))
                              }
                              onBlur={() =>
                                void saveCell(chantier.chantierId, activity.activity, week, current)
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                                if (event.key === "Escape") {
                                  setDrafts((currentDrafts) => {
                                    const next = { ...currentDrafts };
                                    delete next[key];
                                    return next;
                                  });
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  )),
                )}

                {snapshot.provisionalRows.length > 0 ? (
                  <tr className="planningPotentialDivider">
                    <th colSpan={snapshot.weeks.length + 4} scope="rowgroup">
                      POTENTIEL
                    </th>
                  </tr>
                ) : null}

                {snapshot.provisionalRows.flatMap((item, itemIndex) =>
                  item.activities.map((activity, activityIndex) => (
                    <tr
                      className={`planningProvisionRow ${
                        activityIndex === 0 ? "planningProvisionStart" : ""
                      }`}
                      key={`provisional:${item.caseId}:${activity.activity}`}
                    >
                      {activityIndex === 0 ? (
                        <th
                          className="planningSticky planningChantierCell planningProvisionCaseCell"
                          rowSpan={3}
                          scope="rowgroup"
                        >
                          <div className="planningPotentialCaseHeader">
                            <strong>{item.name}</strong>
                            <span className="planningPotentialOrderActions">
                              <button
                                aria-label={`Monter ${item.name} dans le potentiel`}
                                className="secondary"
                                disabled={
                                  !snapshot.capabilities.canEditMacro ||
                                  savingKey === "planning-mutation" ||
                                  itemIndex === 0
                                }
                                onClick={() => void movePotential(item.caseId, -1)}
                                type="button"
                              >
                                ↑
                              </button>
                              <button
                                aria-label={`Descendre ${item.name} dans le potentiel`}
                                className="secondary"
                                disabled={
                                  !snapshot.capabilities.canEditMacro ||
                                  savingKey === "planning-mutation" ||
                                  itemIndex === snapshot.provisionalRows.length - 1
                                }
                                onClick={() => void movePotential(item.caseId, 1)}
                                type="button"
                              >
                                ↓
                              </button>
                            </span>
                          </div>
                          <span>Provisionnel · {item.statusLabel}</span>
                          {item.expectedConfirmationDate ? (
                            <small>Confirmation prévue {item.expectedConfirmationDate}</small>
                          ) : null}
                        </th>
                      ) : null}
                      <th className="planningSticky planningActivityCell" scope="row">
                        {activity.label}
                      </th>
                      <td className="planningSticky planningMetricCell">
                        {formatHours(activity.provisionHours)}
                      </td>
                      <td
                        className={`planningSticky planningMetricCell planningRemainingCell ${
                          activity.remainingHours > 0
                            ? "isPositive"
                            : activity.remainingHours < 0
                              ? "isNegative"
                              : "isZero"
                        }`}
                      >
                        {formatHours(activity.remainingHours)}
                      </td>
                      {snapshot.weeks.map((week) => {
                        const current = activity.weeklyHours[week] ?? 0;
                        const key = cellKey("provisional", item.caseId, activity.activity, week);
                        return (
                          <td className="planningWeekCell" key={week}>
                            <input
                              aria-label={`${item.name} provisionnel ${activity.label} ${week}`}
                              className={savingKey === key ? "isSaving" : undefined}
                              disabled={!snapshot.capabilities.canEditMacro || savingKey === key}
                              inputMode="decimal"
                              value={drafts[key] ?? (current === 0 ? "" : formatHours(current))}
                              onChange={(event) =>
                                setDrafts((currentDrafts) => ({
                                  ...currentDrafts,
                                  [key]: event.target.value,
                                }))
                              }
                              onBlur={() =>
                                void saveProvisionalCell(
                                  item.caseId,
                                  activity.activity,
                                  week,
                                  current,
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                                if (event.key === "Escape") {
                                  setDrafts((currentDrafts) => {
                                    const next = { ...currentDrafts };
                                    delete next[key];
                                    return next;
                                  });
                                  event.currentTarget.blur();
                                }
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <style jsx global>{`
        .grandPlanningWorkspace {
          min-width: 0;
        }
        .grandPlanningHeader {
          align-items: flex-end;
        }
        .grandPlanningHeader .muted {
          margin: 0;
          font-size: 12px;
        }
        .grandPlanningYearNav {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .planningCapacitySettings {
          margin-bottom: 14px;
          padding: 14px 16px;
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 11px;
        }
        .planningCapacitySettingsHeader {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
        }
        .planningCapacitySettingsHeader h2 {
          margin: 0;
          font-size: 15px;
        }
        .planningScheduleTableWrap {
          margin-top: 10px;
          overflow-x: auto;
        }
        .planningScheduleTable {
          width: 100%;
          min-width: 760px;
          border-collapse: collapse;
          font-size: 11px;
        }
        .planningScheduleTable th,
        .planningScheduleTable td {
          padding: 5px 6px;
          border-bottom: 1px solid #eeeaf4;
          text-align: center;
        }
        .planningScheduleTable th:first-child {
          min-width: 150px;
          text-align: left;
        }
        .planningCapacityToggle {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-weight: 700;
        }
        .planningScheduleHours {
          width: 48px;
          min-height: 28px;
          padding: 0 4px;
          text-align: center;
        }
        .planningScheduleTotal {
          min-width: 58px;
          font-weight: 800;
        }
        .planningAbsenceSettings {
          margin-bottom: 14px;
          padding: 14px 16px;
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 11px;
        }
        .planningAbsenceForm,
        .planningFullWeekForm {
          display: flex;
          align-items: end;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 10px;
        }
        .planningAbsenceForm label,
        .planningFullWeekForm label {
          display: grid;
          gap: 4px;
          color: var(--muted);
          font-size: 10px;
          font-weight: 700;
        }
        .planningAbsenceForm select,
        .planningAbsenceForm input,
        .planningFullWeekForm input {
          min-height: 32px;
          min-width: 130px;
        }
        .planningAbsenceHours {
          width: 72px;
          min-width: 72px !important;
        }
        .planningAbsenceList {
          display: grid;
          gap: 6px;
          margin-top: 12px;
        }
        .planningAbsenceRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 7px 8px;
          border: 1px solid #eeeaf4;
          border-radius: 8px;
          font-size: 11px;
        }
        .planningAbsenceRow > div:first-child {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }
        .planningAbsenceRow span {
          color: var(--muted);
        }
        .planningAbsenceActions {
          display: flex;
          gap: 6px;
        }
        .planningUnallocatedPanel {
          margin-bottom: 14px;
          padding: 16px 18px;
          background: #fff9ed;
          border: 1px solid #efdcb4;
          border-radius: 11px;
        }
        .planningProvisionUnallocatedPanel {
          background: #f7f4ff;
          border-color: #d9d0f1;
        }
        .planningProvisionUnallocatedPanel .planningUnallocatedHeader > strong {
          color: #6e5db7;
        }
        .planningProvisionCaseMeta {
          min-width: 210px;
          display: grid !important;
          gap: 2px !important;
        }
        .planningProvisionCaseMeta > strong {
          min-width: 0;
        }
        .planningProvisionCaseMeta span,
        .planningProvisionCaseMeta small {
          padding: 0 !important;
          background: transparent !important;
          color: var(--muted);
          font-weight: 600;
        }
        .planningUnallocatedHeader {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
        }
        .planningUnallocatedHeader h2 {
          margin: 0;
          font-size: 16px;
        }
        .planningUnallocatedHeader > strong {
          color: #9a6118;
          font-size: 20px;
        }
        .planningUnallocatedList {
          margin-top: 12px;
          display: grid;
          gap: 6px;
        }
        .planningUnallocatedRow {
          display: flex;
          align-items: center;
          gap: 14px;
          min-height: 30px;
          font-size: 12px;
        }
        .planningUnallocatedRow > strong {
          min-width: 210px;
        }
        .planningUnallocatedRow > div {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .planningUnallocatedRow span {
          padding: 4px 7px;
          border-radius: 6px;
          background: rgb(255 255 255 / 0.72);
          font-weight: 700;
        }
        .planningRemainingPositive {
          color: #b34435;
        }
        .planningRemainingNegative {
          color: #4f5260;
        }
        .grandPlanningPanel {
          padding: 0;
          overflow: hidden;
        }
        .grandPlanningLegend {
          min-height: 48px;
          padding: 0 16px;
          display: flex;
          align-items: center;
          gap: 18px;
          border-bottom: 1px solid var(--border);
          color: var(--muted);
          font-size: 11px;
        }
        .planningReadOnly {
          margin-left: auto;
          padding: 4px 8px;
          border-radius: 999px;
          background: #f1eef8;
          color: #665c7f;
          font-weight: 750;
        }
        .planningMessage {
          margin: 0;
          padding: 8px 16px;
          border-bottom: 1px solid #eeeaf4;
          color: var(--muted);
          font-size: 11px;
        }
        .grandPlanningScroller {
          max-width: 100%;
          overflow: auto;
          overscroll-behavior: contain;
        }
        .grandPlanningTable {
          width: max-content;
          min-width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: fixed;
          font-size: 11px;
        }
        .grandPlanningTable th,
        .grandPlanningTable td {
          border-right: 1px solid #eeeaf4;
          border-bottom: 1px solid #eeeaf4;
          background: white;
        }
        .grandPlanningTable thead th {
          position: sticky;
          top: 0;
          z-index: 8;
          min-height: 66px;
          background: #f7f4ff;
          color: #675d7e;
          font-size: 10px;
          font-weight: 800;
        }
        .planningSticky {
          position: sticky;
          z-index: 5;
        }
        .planningChantierColumn,
        .planningChantierCell {
          left: 0;
          width: 210px;
          min-width: 210px;
          max-width: 210px;
        }
        .planningActivityColumn,
        .planningActivityCell {
          left: 210px;
          width: 74px;
          min-width: 74px;
          max-width: 74px;
        }
        .planningMetricColumn,
        .planningMetricCell {
          left: 284px;
          width: 62px;
          min-width: 62px;
          max-width: 62px;
          text-align: center;
        }
        .planningRemainingColumn,
        .planningRemainingCell {
          left: 346px;
        }
        .planningChantierCell {
          padding: 9px 10px;
          vertical-align: top;
          text-align: left;
          background: #fbfaff !important;
          box-shadow: 2px 0 0 #eeeaf4;
        }
        .planningChantierCell strong,
        .planningChantierCell span,
        .planningChantierCell small {
          display: block;
        }
        .planningChantierCell strong {
          font-size: 12px;
        }
        .planningChantierCell span {
          margin-top: 3px;
          color: var(--muted);
        }
        .planningChantierCell small {
          margin-top: 7px;
          color: #8b8d98;
          font-size: 9px;
          font-weight: 500;
        }
        .planningActivityCell {
          padding: 0 8px;
          text-align: left;
          background: #fff !important;
        }
        .planningMetricCell {
          font-weight: 700;
          background: #fff !important;
        }
        .planningRemainingCell {
          box-shadow: 2px 0 0 #e8e3f0;
        }
        .planningRemainingCell.isPositive {
          color: #b34435;
          background: #fff7f5 !important;
        }
        .planningRemainingCell.isNegative {
          color: #4f5260;
          background: #f7f7fa !important;
        }
        .planningRemainingCell.isZero {
          color: #22242a;
        }
        .planningWeekHead strong,
        .planningWeekHead span {
          display: block;
        }
        .planningWeekHead span {
          margin-top: 2px;
          font-size: 8px;
          font-weight: 650;
          white-space: nowrap;
        }
        .planningWeekProvisional {
          color: #71698a;
        }
        .planningWeekAvailable {
          color: #39714c;
        }
        .planningWeekWithProvision {
          font-weight: 750 !important;
        }
        .planningWeekAvailable.isNegative {
          color: #b34435;
        }
        .planningWeekHead,
        .planningWeekCell {
          width: 50px;
          min-width: 50px;
          max-width: 50px;
          text-align: center;
        }
        .planningWeekCell {
          height: 32px;
          padding: 2px;
        }
        .planningWeekCell input {
          width: 46px;
          min-height: 27px;
          height: 27px;
          padding: 0 3px;
          border: 1px solid transparent;
          border-radius: 4px;
          background: transparent;
          text-align: center;
          font-size: 10px;
          font-weight: 650;
        }
        .planningWeekCell input:hover:not(:disabled),
        .planningWeekCell input:focus {
          border-color: #cfc5ef;
          background: #faf8ff;
          box-shadow: none;
        }
        .planningWeekCell input:disabled {
          color: #555866;
          opacity: 1;
          cursor: default;
        }
        .planningWeekCell input.isSaving {
          background: #f2effb;
        }
        .planningChantierStart > * {
          border-top: 1px solid #dcd5e8;
        }
        .planningProvisionStart > * {
          border-top: 2px solid #d8cff0;
        }
        .planningPotentialDivider th {
          height: 34px;
          padding: 0 14px;
          border-top: 3px solid #b9a9e8;
          border-bottom: 2px solid #d8cff0;
          background: #eee9fb !important;
          color: #5f4fa1;
          text-align: left;
          font-size: 11px;
          font-weight: 900;
          letter-spacing: 0.08em;
        }
        .planningProvisionRow > th,
        .planningProvisionRow > td,
        .planningProvisionRow .planningActivityCell,
        .planningProvisionRow .planningMetricCell {
          background: #faf8ff !important;
        }
        .planningProvisionRow .planningRemainingCell.isPositive {
          background: #fff8fb !important;
        }
        .planningProvisionRow .planningRemainingCell.isNegative {
          background: #f6f4fb !important;
        }
        .planningProvisionRow .planningWeekCell input {
          color: #71698a;
          font-weight: 600;
        }
        .planningPotentialCaseHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .planningPotentialCaseHeader > strong {
          min-width: 0;
        }
        .planningPotentialOrderActions {
          display: inline-flex;
          gap: 3px;
        }
        .planningPotentialOrderActions button {
          width: 25px;
          min-width: 25px;
          min-height: 24px;
          height: 24px;
          padding: 0;
          border-radius: 5px;
          font-size: 12px;
          line-height: 1;
        }
        .planningProvisionRow .planningWeekCell input:hover:not(:disabled),
        .planningProvisionRow .planningWeekCell input:focus {
          background: #f2eefb;
        }
        .planningProvisionCaseCell {
          background: #f5f1ff !important;
        }
        .planningEmpty {
          height: 160px;
          padding: 30px;
          color: var(--muted);
          text-align: center;
        }
        @media (max-width: 900px) {
          .grandPlanningHeader {
            align-items: flex-start;
            flex-direction: column;
          }
          .planningUnallocatedRow {
            align-items: flex-start;
            flex-direction: column;
            gap: 5px;
          }
          .planningChantierColumn,
          .planningChantierCell {
            width: 170px;
            min-width: 170px;
            max-width: 170px;
          }
          .planningActivityColumn,
          .planningActivityCell {
            left: 170px;
          }
          .planningMetricColumn,
          .planningMetricCell {
            left: 244px;
          }
          .planningRemainingColumn,
          .planningRemainingCell {
            left: 306px;
          }
        }
      `}</style>
    </div>
  );
}

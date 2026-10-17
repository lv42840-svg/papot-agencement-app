"use client";

import Link from "next/link";
import { PlanningExcelGrid } from "./planning-excel-grid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GrandPlanningChantierRow,
  GrandPlanningProvisionRow,
  PlanningActivity,
} from "@/lib/planning/domain";
import {
  buildGrandPlanningWeekMeta,
  groupGrandPlanningMonths,
  isoWeekKey,
} from "@/lib/planning/time-markers";

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
  endYear: number;
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

export function GrandPlanningWorkspace({
  initialYear,
  initialPotentialCollapsed,
}: {
  initialYear: number;
  initialPotentialCollapsed: boolean;
}) {
  const [snapshot, setSnapshot] = useState<PlanningSnapshot | null>(null);
  const [loadingNextYear, setLoadingNextYear] = useState(false);
  const [hiddenUnallocated, setHiddenUnallocated] = useState(false);
  const [hiddenProvisional, setHiddenProvisional] = useState(false);
  const [activeTab, setActiveTab] = useState<"planning" | "personnel">("planning");
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
  const [potentialCollapsed, setPotentialCollapsed] = useState(initialPotentialCollapsed);
  const [potentialPreferenceSaving, setPotentialPreferenceSaving] = useState(false);
  const planningScrollerRef = useRef<HTMLDivElement | null>(null);
  const scrolledToCurrentRef = useRef(false);
  const extendingRef = useRef(false);
  const restoreScrollRef = useRef<number | null>(null);
  const currentWeek = useMemo(() => isoWeekKey(new Date()), []);

  useEffect(() => {
    setHiddenUnallocated(window.sessionStorage.getItem("papot.planning.hide-unallocated") === "1");
    setHiddenProvisional(window.sessionStorage.getItem("papot.planning.hide-provisional") === "1");
  }, []);

  function toggleUnallocated(hidden: boolean) {
    setHiddenUnallocated(hidden);
    if (hidden) window.sessionStorage.setItem("papot.planning.hide-unallocated", "1");
    else window.sessionStorage.removeItem("papot.planning.hide-unallocated");
  }

  function toggleProvisional(hidden: boolean) {
    setHiddenProvisional(hidden);
    if (hidden) window.sessionStorage.setItem("papot.planning.hide-provisional", "1");
    else window.sessionStorage.removeItem("papot.planning.hide-provisional");
  }

  const load = useCallback(async () => {
    setMessage("Chargement du planning…");
    const response = await fetch(`/api/desktop/planning?year=${initialYear}&endYear=${Math.min(2100, initialYear + 1)}`, {
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

  const weekMeta = useMemo(
    () => buildGrandPlanningWeekMeta(snapshot?.weeks ?? []),
    [snapshot?.weeks],
  );
  const weekMetaByWeek = useMemo(
    () => new Map(weekMeta.map((item) => [item.week, item])),
    [weekMeta],
  );
  const monthGroups = useMemo(() => groupGrandPlanningMonths(weekMeta), [weekMeta]);

  useEffect(() => {
    const scroller = planningScrollerRef.current;
    if (!snapshot || !scroller) return;
    if (restoreScrollRef.current != null) {
      scroller.scrollLeft = restoreScrollRef.current;
      restoreScrollRef.current = null;
      return;
    }
    if (scrolledToCurrentRef.current || !snapshot.weeks.includes(currentWeek)) return;
    const currentHeader = scroller.querySelector<HTMLElement>(
      `[data-planning-week="${currentWeek}"]`,
    );
    if (!currentHeader) return;
    scroller.scrollLeft = Math.max(0, currentHeader.offsetLeft - 655 - 12);
    scrolledToCurrentRef.current = true;
  }, [currentWeek, snapshot]);

  async function extendPlanning() {
    if (!snapshot || extendingRef.current || snapshot.endYear >= 2100 || savingKey !== null) return;
    extendingRef.current = true;
    setLoadingNextYear(true);
    const nextEndYear = snapshot.endYear + 1;
    // Keep at most three years rendered; older years remain accessible via annual navigation.
    const nextStartYear = Math.max(snapshot.year, nextEndYear - 2);
    const removedWeeks = snapshot.weeks.filter(
      (week) => Number(week.slice(0, 4)) < nextStartYear,
    ).length;
    const previousScrollLeft = planningScrollerRef.current?.scrollLeft ?? 0;
    try {
      const response = await fetch(
        `/api/desktop/planning?year=${nextStartYear}&endYear=${nextEndYear}`,
        { cache: "no-store" },
      );
      const result = (await response.json()) as PlanningSnapshot & { error?: string };
      if (!response.ok) {
        setMessage(result.error ?? "Impossible de charger la suite du planning.");
        return;
      }
      restoreScrollRef.current = Math.max(0, previousScrollLeft - removedWeeks * 150);
      setSnapshot(result);
      setMessage("");
    } catch {
      setMessage("Impossible de charger la suite du planning.");
    } finally {
      extendingRef.current = false;
      setLoadingNextYear(false);
    }
  }

  function handlePlanningScroll() {
    const scroller = planningScrollerRef.current;
    if (!scroller || !snapshot || snapshot.endYear >= 2100) return;
    if (scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 450) {
      void extendPlanning();
    }
  }

  function weekClassName(week: string) {
    const meta = weekMetaByWeek.get(week);
    return [
      meta?.startsMonth ? "planningMonthStart" : "",
      meta?.isPast ? "planningPastWeek" : "",
      meta?.isCurrent ? "planningCurrentWeek" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

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
        endYear: snapshot.endYear,
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

  async function togglePotentialCollapsed() {
    if (potentialPreferenceSaving) return;
    const next = !potentialCollapsed;
    setPotentialCollapsed(next);
    setPotentialPreferenceSaving(true);
    const response = await fetch("/api/me/planning-preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ planningPotentialCollapsed: next }),
    });
    if (!response.ok) {
      setPotentialCollapsed(!next);
      setMessage("Impossible d’enregistrer la préférence d’affichage.");
    }
    setPotentialPreferenceSaving(false);
  }

  async function moveFirm(chantierId: string, direction: -1 | 1) {
    if (!snapshot?.capabilities.canEditMacro) return;
    const orderedChantierIds = snapshot.rows.map((item) => item.chantierId);
    const currentIndex = orderedChantierIds.indexOf(chantierId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= orderedChantierIds.length) return;

    [orderedChantierIds[currentIndex], orderedChantierIds[nextIndex]] = [
      orderedChantierIds[nextIndex],
      orderedChantierIds[currentIndex],
    ];

    await postPlanningMutation(
      { action: "setChantierOrder", orderedChantierIds },
      "Ordre des chantiers enregistré.",
    );
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
        endYear: snapshot.endYear,
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
        endYear: snapshot.endYear,
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

      <nav className="planningMainTabs" aria-label="Modules du planning">
        <button
          type="button"
          className={activeTab === "planning" ? "isActive" : ""}
          onClick={() => setActiveTab("planning")}
        >
          Grand planning
        </button>
        <button
          type="button"
          className={activeTab === "personnel" ? "isActive" : ""}
          onClick={() => setActiveTab("personnel")}
        >
          Gestion du personnel
        </button>
      </nav>

      {activeTab === "planning" ? (
        <div className="planningUnallocatedArea">
          {unallocated.length > 0 && hiddenUnallocated ? (
        <button type="button" className="secondaryButton planningReopenPanel" onClick={() => toggleUnallocated(false)}>
          Afficher les charges à répartir
        </button>
      ) : null}
      {unallocated.length > 0 && !hiddenUnallocated ? (
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
              <button type="button" className="planningDismissButton" aria-label="Masquer les charges à répartir" onClick={() => toggleUnallocated(true)}>
            ✕
          </button>
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

          {provisionalUnallocated.length > 0 && hiddenProvisional ? (
        <button type="button" className="secondaryButton planningReopenPanel" onClick={() => toggleProvisional(false)}>
          Afficher les charges provisionnelles à répartir
        </button>
      ) : null}
      {provisionalUnallocated.length > 0 && !hiddenProvisional ? (
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
              <button type="button" className="planningDismissButton" aria-label="Masquer les charges provisionnelles" onClick={() => toggleProvisional(true)}>
            ✕
          </button>
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
        </div>
      ) : null}

      {activeTab === "personnel" ? (
        <div className="planningPersonnelContent">
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
                                value={
                                  scheduleDrafts[key] ?? formatHours(person.weeklySchedule[day])
                                }
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
                            Object.values(person.weeklySchedule).reduce(
                              (sum, hours) => sum + hours,
                              0,
                            ),
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
                    onChange={(event) =>
                      setAbsenceType(event.target.value as PlanningAbsence["type"])
                    }
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
        </div>
      ) : null}

      {activeTab === "planning" ? (
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
            <div className="grandPlanningScroller" ref={planningScrollerRef} onScroll={handlePlanningScroll}>
              <PlanningExcelGrid
                snapshot={snapshot}
                drafts={drafts}
                savingKey={savingKey}
                potentialCollapsed={potentialCollapsed}
                potentialPreferenceSaving={potentialPreferenceSaving}
                onDraftChange={(key, value) =>
                  setDrafts((current) => ({ ...current, [key]: value }))
                }
                onDraftClear={(key) =>
                  setDrafts((current) => {
                    const next = { ...current };
                    delete next[key];
                    return next;
                  })
                }
                onSaveFirm={saveCell}
                onSaveProvision={saveProvisionalCell}
                onMoveFirm={moveFirm}
                onMoveProvision={movePotential}
                onTogglePotential={togglePotentialCollapsed}
              />
            </div>
            {snapshot.endYear < 2100 ? (
              <div className="planningLoadMore">
                <button
                  type="button"
                  className="secondaryButton"
                  disabled={loadingNextYear || savingKey !== null}
                  onClick={() => void extendPlanning()}
                >
                  {loadingNextYear ? "Chargement…" : `Afficher ${snapshot.endYear + 1} →`}
                </button>
                <span>Le planning se prolonge en faisant défiler vers la droite.</span>
              </div>
            ) : null}
          ) : null}
        </section>
      ) : null}

      <style jsx global>{`
        .planningMainTabs {
          display: flex;
          gap: 6px;
          margin: 0 0 14px;
          border-bottom: 1px solid #ddd5ee;
        }
        .planningMainTabs button {
          border: 1px solid transparent;
          border-bottom: 3px solid transparent;
          background: transparent;
          padding: 12px 19px;
          font-weight: 800;
          color: #766a91;
          border-radius: 8px 8px 0 0;
        }
        .planningMainTabs button.isActive {
          color: #6450ad;
          border-bottom-color: #7666d6;
          background: #eeeafb;
        }
        .planningPersonnelContent {
          max-width: 1500px;
        }
        .excelPlanningTable {
          width: max-content;
          min-width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: fixed;
          font-size: 11px;
        }
        .excelPlanningTable th,
        .excelPlanningTable td {
          padding: 0;
          border-bottom: 1px solid #d7dce9;
          border-right: 1px solid #d7dce9;
          text-align: center;
          background: #eef2fa;
        }
        .excelPlanningTable thead th {
          position: sticky;
          z-index: 7;
          color: #4e4288;
        }
        .excelMonthRow th {
          top: 0;
          height: 31px;
          background: #e8e1f7;
        }
        .excelMonthRow .excelMonthHeading {
          background: #d9d0f0;
          font-size: 13px;
          text-transform: uppercase;
        }
        .excelWeekRow th {
          top: 31px;
          height: 41px;
          background: #ece8f8;
        }
        .excelWeekHeading {
          min-width: 150px;
          width: 150px;
        }
        .excelWeekHeading strong {
          display: block;
          font-size: 12px;
          padding: 3px 0;
        }
        .excelWeekActivityLabels {
          background: #f9f8fd;
          font-size: 10px;
        }
        .excelTriple {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .excelTriple > span,
        .excelTriple > input {
          box-sizing: border-box;
          min-width: 0;
          width: 100%;
          min-height: 30px;
          height: 30px;
          padding: 0 2px;
          border: 0;
          border-right: 1px solid #dae0e9;
          border-radius: 0;
          background: transparent;
          color: inherit;
          text-align: center;
          font-size: 11px;
          font-weight: 650;
          font-variant-numeric: tabular-nums;
        }
        .excelTriple > :last-child {
          border-right: 0;
        }
        .excelTripleValues > span {
          height: 36px;
          display: grid;
          place-items: center;
        }
        .excelTriple > input:focus {
          outline: 2px solid #7666d6;
          outline-offset: -2px;
          background: white;
        }
        .excelTriple > input:disabled {
          cursor: default;
        }
        .excelWeekCell {
          width: 150px;
          min-width: 150px;
          height: 39px;
        }
        .excelWeekCell:has(input:not(:placeholder-shown)) {
          background: #e3ebf8;
        }
        .excelWeekCell .excelTriple {
          min-height: 36px;
          align-items: center;
        }
        .excelWeekCell input:not(:disabled):hover {
          background: #fefeff;
        }
        .excelFixed {
          position: sticky !important;
          z-index: 5;
          background: #fff !important;
        }
        .excelPlanningTable thead .excelFixed {
          z-index: 15;
          background: #f3effc !important;
        }
        .excelFixedName {
          left: 0;
          min-width: 205px;
          width: 205px;
          max-width: 205px;
        }
        .excelFixedPlan {
          left: 205px;
          min-width: 150px;
          width: 150px;
        }
        .excelFixedActual {
          left: 355px;
          min-width: 150px;
          width: 150px;
        }
        .excelFixedRemaining {
          left: 505px;
          min-width: 150px;
          width: 150px;
        }
        .excelFixed small {
          display: block;
          font-size: 9px;
          color: #737482;
          font-weight: 550;
        }
        .excelChantierName {
          text-align: left !important;
          padding: 5px 9px !important;
          background: #dfe9f9 !important;
        }
        .excelChantierName strong {
          font-size: 12px;
          overflow-wrap: anywhere;
        }
        .excelChantierTitle {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
        }
        .excelRowControls {
          display: flex;
          gap: 2px;
        }
        .excelRowControls button {
          padding: 0;
          width: 18px;
          height: 19px;
          font-size: 11px;
          background: #fff;
          border: 1px solid #d7d2ea;
          border-radius: 3px;
        }
        .excelMetricCell {
          background: #f2f4fb !important;
        }
        .excelActivityTotalRow .excelFixedName {
          background: #eee9f8 !important;
          color: #4c3b87;
          font-weight: 900;
          text-align: left !important;
          padding: 7px 9px !important;
          border-top: 2px solid #c4b9df;
        }
        .excelActivityTotalRow .excelMetricCell,
        .excelActivityTotalCell {
          background: #e1e9f5 !important;
          font-weight: 800;
          border-top: 2px solid #c4b9df;
        }
        .excelSummaryRow th {
          text-align: left !important;
          font-weight: 800;
          padding: 7px 9px !important;
          height: 31px;
        }
        .excelSummaryRow td {
          background: #fff;
          font-weight: 800;
          font-size: 13px;
        }
        .excelSummaryRow .excelSummarySpacer {
          background: #fff !important;
        }
        .excelSummaryCell.excelAvailable {
          background: #37a667;
          color: #fff;
        }
        .excelSummaryCell.excelTight {
          background: #f7b650;
          color: #553313;
        }
        .excelSummaryCell.excelUnavailable {
          background: #cf5959;
          color: #fff;
        }
        .excelCurrentWeek {
          box-shadow:
            inset 2px 0 0 #7666d6,
            inset -2px 0 0 #7666d6;
        }
        .excelMonthStart {
          border-left: 2px solid #b0a2d1 !important;
        }
        .excelPastWeek:not(.excelFixed) {
          background-color: #f4f3f8;
        }
        .excelPotentialDivider th {
          text-align: left;
          background: #eee9fb !important;
        }
        .excelPotentialDivider button {
          width: 100%;
          display: flex;
          gap: 12px;
          align-items: center;
          padding: 9px 12px;
          border: 0;
          background: transparent;
          color: #6551a8;
        }
        .excelPotentialDivider small {
          margin-left: auto;
        }
        .excelProvisionalRow .excelChantierName {
          background: #f0e9fc !important;
        }
        .excelProvisionalRow .excelWeekCell {
          background: #f7f2ff;
        }
        .excelEmpty {
          height: 90px;
        }
        @media (max-width: 900px) {
          .excelFixedName {
            width: 160px;
            min-width: 160px;
            max-width: 160px;
          }
          .excelFixedPlan {
            left: 160px;
          }
          .excelFixedActual {
            left: 310px;
          }
          .excelFixedRemaining {
            left: 460px;
          }
        }

        .planningDismissButton {
          float: right;
          margin-top: -30px;
          margin-right: 0;
          border: 0;
          border-radius: 5px;
          background: transparent;
          color: #876d4b;
          padding: 3px 7px;
          font-size: 18px;
          font-weight: 800;
        }
        .planningDismissButton:hover {
          background: rgb(120 90 40 / 0.08);
        }
        .planningReopenPanel {
          margin-bottom: 14px;
        }
        .planningLoadMore {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
          padding: 9px 14px;
          color: var(--muted);
          font-size: 11px;
          border-top: 1px solid var(--border);
        }
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
          z-index: 8;
          background: #f7f4ff;
          color: #675d7e;
          font-size: 10px;
          font-weight: 800;
        }
        .planningMonthRow th {
          top: 0;
        }
        .planningMonthHead {
          height: 28px;
          min-height: 28px;
          padding: 0 6px;
          border-bottom: 1px solid #ddd5ee !important;
          background: #eee9fb !important;
          color: #5f4fa1 !important;
          font-size: 10px !important;
          font-weight: 900 !important;
          letter-spacing: 0.06em;
          text-align: left;
        }
        .planningWeekRow th {
          top: 28px;
          min-height: 66px;
        }
        .planningMonthRow .planningSticky {
          top: 0;
          z-index: 12;
          vertical-align: middle;
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
        .planningMonthStart {
          border-left: 2px solid #c8bce7 !important;
        }
        .planningPastWeek {
          background: #f4f3f6 !important;
          color: #8a8791 !important;
        }
        .planningPastWeek input {
          color: #77747e !important;
          opacity: 0.72 !important;
        }
        .planningCurrentWeek {
          box-shadow:
            inset 2px 0 0 #7560bd,
            inset -2px 0 0 #7560bd;
          background: #fbf9ff !important;
        }
        .planningWeekHead.planningCurrentWeek {
          border-top: 2px solid #7560bd !important;
          color: #4f3c91 !important;
        }
        .grandPlanningTable tbody tr:last-child .planningCurrentWeek {
          border-bottom: 2px solid #7560bd !important;
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
        .planningPotentialToggle {
          width: 100%;
          min-height: 32px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0;
          border: 0;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .planningPotentialToggle:disabled {
          cursor: wait;
          opacity: 0.65;
        }
        .planningPotentialToggle strong {
          font-size: 11px;
          letter-spacing: 0.08em;
        }
        .planningPotentialToggle small {
          margin-left: auto;
          color: #7a6daa;
          font-size: 10px;
          letter-spacing: 0;
          font-weight: 700;
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
        .planningProvisionRow.isCollapsed {
          display: none;
        }
        .planningFirmCaseHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .planningFirmCaseHeader > strong {
          min-width: 0;
        }
        .planningFirmOrderActions {
          display: inline-flex;
          gap: 3px;
        }
        .planningFirmOrderActions button {
          width: 25px;
          min-width: 25px;
          min-height: 24px;
          height: 24px;
          padding: 0;
          border-radius: 5px;
          font-size: 12px;
          line-height: 1;
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

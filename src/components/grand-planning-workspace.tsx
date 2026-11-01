"use client";

import "./grand-planning-workspace.css";

import Link from "next/link";
import { PlanningExcelGrid } from "./planning-excel-grid";
import { groupPlanningAbsences, type AbsenceDisplayEntry } from "@/lib/planning/absence-display";
import { suggestedAbsenceHoursForDate } from "@/lib/planning/capacity";
import type { PlanningClipboardUpdate } from "@/lib/planning/clipboard";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  GrandPlanningChantierRow,
  GrandPlanningProvisionRow,
  PlanningActivity,
} from "@/lib/planning/domain";
import {
  buildGrandPlanningWeekMeta,
  groupGrandPlanningMonths,
  isoWeekKey,
  weekDateRangeLabel,
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
  kind: "account" | "staff";
  firstName: string | null;
  lastName: string | null;
  linkedUserId: string | null;
  hiddenInWeeklyBoard: boolean;
  endDate: string | null;
  inactiveSince: string | null;
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
  weekGroupId?: string;
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
  availableAccounts: Array<{ id: string; displayName: string }>;
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
  initialTab = "planning",
}: {
  initialYear: number;
  initialPotentialCollapsed: boolean;
  initialTab?: "planning" | "personnel";
}) {
  const [snapshot, setSnapshot] = useState<PlanningSnapshot | null>(null);
  const [loadingNextYear, setLoadingNextYear] = useState(false);
  const [hiddenUnallocated, setHiddenUnallocated] = useState(false);
  const [hiddenProvisional, setHiddenProvisional] = useState(false);
  const [activeTab, setActiveTab] = useState<"planning" | "personnel">(initialTab);
  const [message, setMessage] = useState("Chargement du planning…");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, string>>({});
  const [staffFirstName, setStaffFirstName] = useState("");
  const [staffLastName, setStaffLastName] = useState("");
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [absenceUserId, setAbsenceUserId] = useState("");
  const [absenceType, setAbsenceType] = useState<PlanningAbsence["type"]>("VACATION");
  const [absenceDate, setAbsenceDate] = useState(`${initialYear}-01-01`);
  // null uses the hours scheduled for the selected person and date.
  const [absenceHours, setAbsenceHours] = useState<string | null>(null);
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
    const response = await fetch(
      `/api/desktop/planning?year=${initialYear}&endYear=${Math.min(2100, initialYear + 1)}`,
      {
        cache: "no-store",
      },
    );
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

  const suggestedAbsenceHours = useMemo(() => {
    const person = snapshot?.peopleCapacity.find((entry) => entry.userId === absenceUserId);
    if (!person) return 0;
    return suggestedAbsenceHoursForDate(person.weeklySchedule, absenceDate);
  }, [snapshot?.peopleCapacity, absenceUserId, absenceDate]);
  const displayedAbsenceHours = absenceHours ?? formatHours(suggestedAbsenceHours);

  const groupedAbsences = useMemo(
    () => groupPlanningAbsences(snapshot?.absences ?? [], snapshot?.peopleCapacity ?? []),
    [snapshot?.absences, snapshot?.peopleCapacity],
  );
  const absencePeople = useMemo(() => {
    const listed =
      snapshot?.peopleCapacity.map((person) => ({
        id: person.userId,
        displayName: person.displayName,
      })) ?? [];
    const ids = new Set(listed.map((person) => person.id));
    for (const absence of snapshot?.absences ?? []) {
      if (ids.has(absence.userId)) continue;
      ids.add(absence.userId);
      listed.push({ id: absence.userId, displayName: absence.displayName });
    }
    return listed;
  }, [snapshot?.peopleCapacity, snapshot?.absences]);
  const shownAbsences = groupedAbsences.filter(
    (absence) => absence.userId === (absenceUserId || absencePeople[0]?.id),
  );

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
    const stickyColumnsWidth = 655;
    scroller.scrollLeft = Math.max(0, currentHeader.offsetLeft - stickyColumnsWidth - 12);
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
      body: JSON.stringify({ ...body, year: snapshot.year, endYear: snapshot.endYear }),
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

  async function saveStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firstName = staffFirstName.trim();
    const lastName = staffLastName.trim();
    if (!firstName || !lastName) {
      setMessage("Renseigne le prénom et le nom.");
      return;
    }
    const saved = await postPlanningMutation(
      { action: "saveStaff", id: editingStaffId ?? undefined, firstName, lastName },
      editingStaffId ? "Fiche personnel mise à jour." : "Personne ajoutée au planning.",
    );
    if (saved) {
      setStaffFirstName("");
      setStaffLastName("");
      setEditingStaffId(null);
    }
  }

  function editStaff(person: PersonCapacity) {
    if (person.kind !== "staff") return;
    setEditingStaffId(person.userId);
    setStaffFirstName(person.firstName ?? "");
    setStaffLastName(person.lastName ?? "");
  }

  async function linkStaffAccount(personId: string, linkedUserId: string | null) {
    await postPlanningMutation(
      { action: "linkStaffAccount", id: personId, linkedUserId },
      linkedUserId ? "Compte PAPOT rattaché au personnel." : "Compte PAPOT détaché.",
    );
  }

  async function setPersonHidden(person: PersonCapacity) {
    await postPlanningMutation(
      { action: "setPersonHidden", id: person.userId, hidden: !person.hiddenInWeeklyBoard },
      person.hiddenInWeeklyBoard
        ? "Personne visible au petit planning."
        : "Personne masquée du petit planning.",
    );
  }

  async function staffAction(
    person: PersonCapacity,
    action: "deactivateStaff" | "reactivateStaff" | "deleteStaff",
  ) {
    if (person.kind !== "staff") return;
    if (
      action === "deleteStaff" &&
      !window.confirm(
        `Supprimer définitivement ${person.displayName} ? Possible uniquement sans historique ni compte lié.`,
      )
    )
      return;
    if (
      action === "deactivateStaff" &&
      !window.confirm(
        `Désactiver ${person.displayName} dès aujourd'hui ? Les anciennes semaines restent conservées.`,
      )
    )
      return;
    await postPlanningMutation(
      { action, id: person.userId },
      action === "deleteStaff"
        ? "Fiche supprimée."
        : action === "reactivateStaff"
          ? "Personne réactivée."
          : "Personne désactivée.",
    );
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
    const hours = parseHours(displayedAbsenceHours);
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
      setAbsenceHours(null);
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
    if (saved) {
      setAbsenceEditId(null);
      setAbsenceHours(null);
    }
  }

  async function deleteAbsence(absenceId: string) {
    if (!snapshot?.capabilities.canManageSchedules) return;
    await postPlanningMutation({ action: "deleteAbsence", absenceId }, "Absence supprimée.");
  }

  async function deleteAbsenceWeek(ids: string[]) {
    if (!snapshot?.capabilities.canManageSchedules) return;
    await postPlanningMutation(
      { action: "deleteAbsenceBatch", absenceIds: ids },
      "Semaine d’absence supprimée.",
    );
  }

  function editAbsenceWeek(absence: AbsenceDisplayEntry) {
    setAbsenceEditId(null);
    setAbsenceHours(null);
    setAbsenceUserId(absence.userId);
    setAbsenceType(absence.type);
    setAbsenceWeek(absence.week);
    setMessage(
      "Semaine sélectionnée : modifie le type puis clique sur « Mettre toute la semaine en absence ».",
    );
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

  async function pastePlanningCells(updates: PlanningClipboardUpdate[]) {
    if (!snapshot?.capabilities.canEditMacro || savingKey !== null) return;
    setSavingKey("planning-mutation");
    setMessage(`Enregistrement de ${updates.length} case(s)…`);
    try {
      const response = await fetch("/api/desktop/planning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setHoursBatch",
          year: snapshot.year,
          endYear: snapshot.endYear,
          updates,
        }),
      });
      const result = (await response.json()) as PlanningSnapshot & { error?: string };
      if (!response.ok) {
        setMessage(result.error ?? "Collage refusé : aucune heure n’a été modifiée.");
        return;
      }
      setSnapshot(result);
      setDrafts((current) => {
        const next = { ...current };
        for (const update of updates) {
          delete next[cellKey(update.kind, update.id, update.activity, update.week)];
        }
        return next;
      });
      setMessage(`${updates.length} case(s) collée(s) et enregistrée(s).`);
    } catch {
      setMessage("Connexion interrompue : vérifiez les heures avant de recommencer.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="grandPlanningWorkspace">
      <div className="pageHeader grandPlanningHeader">
        <div>
          <p className="eyebrow">Planning</p>
          <h1>
            Grand planning {snapshot ? `${snapshot.year} → ${snapshot.endYear}` : initialYear}
          </h1>
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
        <Link href={`/planning/${currentWeek}`}>Petit planning</Link>
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
            <button
              type="button"
              className="secondaryButton planningReopenPanel"
              onClick={() => toggleUnallocated(false)}
            >
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
              <button
                type="button"
                className="planningDismissButton"
                aria-label="Masquer les charges à répartir"
                onClick={() => toggleUnallocated(true)}
              >
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
            <button
              type="button"
              className="secondaryButton planningReopenPanel"
              onClick={() => toggleProvisional(false)}
            >
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
              <button
                type="button"
                className="planningDismissButton"
                aria-label="Masquer les charges provisionnelles"
                onClick={() => toggleProvisional(true)}
              >
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
              {snapshot.capabilities.canManageSchedules ? (
                <form className="planningStaffForm" onSubmit={(event) => void saveStaff(event)}>
                  <label>
                    Prénom
                    <input
                      value={staffFirstName}
                      maxLength={100}
                      required
                      placeholder="Prénom"
                      onChange={(event) => setStaffFirstName(event.target.value)}
                    />
                  </label>
                  <label>
                    Nom
                    <input
                      value={staffLastName}
                      maxLength={100}
                      required
                      placeholder="Nom"
                      onChange={(event) => setStaffLastName(event.target.value)}
                    />
                  </label>
                  <button type="submit" className="primaryButton fit" disabled={savingKey !== null}>
                    {editingStaffId ? "Enregistrer la fiche" : "+ Ajouter une personne"}
                  </button>
                  {editingStaffId ? (
                    <button
                      type="button"
                      className="secondaryButton"
                      onClick={() => {
                        setEditingStaffId(null);
                        setStaffFirstName("");
                        setStaffLastName("");
                      }}
                    >
                      Annuler
                    </button>
                  ) : null}
                </form>
              ) : null}
              <p className="planningStaffHint">
                Une personne peut figurer au planning sans compte de connexion. Le rattachement
                reste facultatif. Masquer une personne du petit planning ne retire pas ses heures de
                la capacité : seule la case « Capacité », la date de fin ou la désactivation
                agissent sur ses disponibilités.
              </p>
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
                        <th scope="row">
                          <div className="planningStaffIdentity">
                            <strong>{person.displayName}</strong>
                            {snapshot.capabilities.canManageSchedules ? (
                              <label
                                className="planningStaffHide"
                                title="Masquer le nom du petit planning sans changer les heures de capacité"
                              >
                                <input
                                  type="checkbox"
                                  checked={!person.hiddenInWeeklyBoard}
                                  disabled={savingKey !== null}
                                  onChange={() => void setPersonHidden(person)}
                                />
                                Visible au petit planning
                              </label>
                            ) : null}
                            {person.kind === "staff" ? (
                              <>
                                <small>
                                  {person.inactiveSince
                                    ? "Désactivé"
                                    : person.endDate
                                      ? `Fin prévue : ${person.endDate.split("-").reverse().join("/")}`
                                      : "Sans date de fin"}
                                </small>
                                <small>
                                  {person.linkedUserId
                                    ? "Compte PAPOT associé"
                                    : "Sans compte PAPOT"}
                                </small>
                                {snapshot.capabilities.canManageSchedules ? (
                                  <div className="planningStaffActions">
                                    <label className="planningStaffEndDate">
                                      Fin de présence (préavis, intérim)
                                      <input
                                        type="date"
                                        aria-label={`Date de fin de ${person.displayName}`}
                                        value={person.endDate ?? ""}
                                        disabled={savingKey !== null}
                                        onChange={(event) =>
                                          void postPlanningMutation(
                                            {
                                              action: "setStaffEndDate",
                                              id: person.userId,
                                              endDate: event.target.value || null,
                                            },
                                            "Date de fin de présence enregistrée.",
                                          )
                                        }
                                      />
                                    </label>
                                    {person.inactiveSince ? (
                                      <button
                                        type="button"
                                        className="secondaryButton"
                                        disabled={savingKey !== null}
                                        onClick={() => void staffAction(person, "reactivateStaff")}
                                      >
                                        Réactiver
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        className="secondaryButton"
                                        disabled={savingKey !== null}
                                        onClick={() => void staffAction(person, "deactivateStaff")}
                                      >
                                        Désactiver
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="secondaryButton"
                                      disabled={savingKey !== null}
                                      title="Suppression autorisée uniquement si aucun historique ni compte lié"
                                      onClick={() => void staffAction(person, "deleteStaff")}
                                    >
                                      Supprimer
                                    </button>
                                    <button
                                      type="button"
                                      className="secondaryButton"
                                      disabled={savingKey !== null}
                                      onClick={() => editStaff(person)}
                                    >
                                      Modifier
                                    </button>
                                    <label>
                                      <span className="sr-only">
                                        Rattacher un compte à {person.displayName}
                                      </span>
                                      <select
                                        aria-label={`Compte PAPOT associé à ${person.displayName}`}
                                        value={person.linkedUserId ?? ""}
                                        disabled={savingKey !== null}
                                        onChange={(event) =>
                                          void linkStaffAccount(
                                            person.userId,
                                            event.target.value || null,
                                          )
                                        }
                                      >
                                        <option value="">Aucun compte</option>
                                        {snapshot.availableAccounts.map((account) => (
                                          <option
                                            key={account.id}
                                            value={account.id}
                                            disabled={snapshot.peopleCapacity.some(
                                              (other) =>
                                                other.kind === "staff" &&
                                                other.userId !== person.userId &&
                                                other.linkedUserId === account.id,
                                            )}
                                          >
                                            {account.displayName}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>
                                ) : null}
                              </>
                            ) : (
                              <small>Compte PAPOT</small>
                            )}
                          </div>
                        </th>
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
                    onChange={(event) => {
                      setAbsenceUserId(event.target.value);
                      setAbsenceHours(null);
                    }}
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
                    onChange={(event) => {
                      setAbsenceDate(event.target.value);
                      setAbsenceHours(null);
                    }}
                  />
                </label>
                <label>
                  Heures
                  <input
                    className="planningAbsenceHours"
                    inputMode="decimal"
                    value={displayedAbsenceHours}
                    disabled={!snapshot.capabilities.canManageSchedules}
                    onChange={(event) => setAbsenceHours(event.target.value)}
                  />
                </label>
                <span className="planningAbsenceSuggestion">
                  {suggestedAbsenceHours === 0
                    ? "0 h prévues ce jour (repos ou jour férié)"
                    : `Proposition : ${formatHours(suggestedAbsenceHours)} h selon les horaires de la personne`}
                </span>
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
                    onClick={() => {
                      setAbsenceEditId(null);
                      setAbsenceHours(null);
                    }}
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

              <div
                className="planningAbsencePersonTabs"
                role="tablist"
                aria-label="Absences par personne"
              >
                {absencePeople.map((person) => {
                  const selected = (absenceUserId || absencePeople[0]?.id) === person.id;
                  const count = groupedAbsences.filter(
                    (absence) => absence.userId === person.id,
                  ).length;
                  return (
                    <button
                      key={person.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={selected ? "isActive" : ""}
                      onClick={() => {
                        setAbsenceUserId(person.id);
                        setAbsenceEditId(null);
                        setAbsenceHours(null);
                      }}
                    >
                      {person.displayName} <span>({count})</span>
                    </button>
                  );
                })}
              </div>
              <div className="planningAbsenceList" role="tabpanel">
                {shownAbsences.length === 0 ? (
                  <p className="muted">Aucune absence enregistrée pour cette personne.</p>
                ) : (
                  shownAbsences.map((absence) => (
                    <div
                      className={
                        absence.kind === "week"
                          ? "planningAbsenceRow planningAbsenceWeekRow"
                          : "planningAbsenceRow"
                      }
                      key={absence.key}
                    >
                      <div>
                        <strong>
                          {absence.kind === "week"
                            ? `Semaine ${absence.week.slice(-2)}`
                            : absence.startDate.split("-").reverse().join("/")}
                        </strong>
                        {absence.kind === "week" ? (
                          <span>
                            {weekDateRangeLabel(absence.week)} · {absence.days} jour(s)
                          </span>
                        ) : null}
                        <span>{absence.typeLabel}</span>
                        <span>{formatHours(absence.hours)} h</span>
                      </div>
                      {snapshot.capabilities.canManageSchedules ? (
                        <div className="planningAbsenceActions">
                          <button
                            className="secondaryButton"
                            type="button"
                            disabled={savingKey !== null}
                            onClick={() => {
                              if (absence.kind === "week") {
                                editAbsenceWeek(absence);
                              } else {
                                const detail = snapshot.absences.find(
                                  (entry) => entry.id === absence.absenceIds[0],
                                );
                                if (detail) editAbsence(detail);
                              }
                            }}
                          >
                            {absence.kind === "week" ? "Modifier la semaine" : "Modifier"}
                          </button>
                          <button
                            className="secondaryButton"
                            type="button"
                            disabled={savingKey !== null}
                            onClick={() =>
                              void (absence.kind === "week"
                                ? deleteAbsenceWeek(absence.absenceIds)
                                : deleteAbsence(absence.absenceIds[0]))
                            }
                          >
                            {absence.kind === "week" ? "Supprimer la semaine" : "Supprimer"}
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
            <span className="planningClipboardLegend">
              Copier/coller : clic, Maj + clic pour sélectionner un bloc, Ctrl+C / Ctrl+V
            </span>
            {!snapshot?.capabilities.canEditMacro ? (
              <span className="planningReadOnly">Lecture seule</span>
            ) : null}
          </div>

          {message ? <p className="planningMessage">{message}</p> : null}

          {snapshot ? (
            <>
              <div
                className="grandPlanningScroller"
                ref={planningScrollerRef}
                onScroll={handlePlanningScroll}
              >
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
                  onPasteBatch={pastePlanningCells}
                  onClipboardError={setMessage}
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
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { GrandPlanningChantierRow, PlanningActivity } from "@/lib/planning/domain";

type WeeklyCapacity = {
  week: string;
  totalCapacityHours: number;
  firmLoadHours: number;
  firmAvailableHours: number;
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
type PlanningSnapshot = {
  year: number;
  weeks: string[];
  rows: GrandPlanningChantierRow[];
  weeklyCapacity: WeeklyCapacity[];
  peopleCapacity: PersonCapacity[];
  capabilities: {
    canRead: boolean;
    canEditMacro: boolean;
    canManageSchedules: boolean;
  };
};

function cellKey(chantierId: string, activity: PlanningActivity, week: string) {
  return `${chantierId}:${activity}:${week}`;
}

function weekLabel(week: string) {
  return `S${week.slice(-2)}`;
}

function formatHours(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

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

  async function saveCell(
    chantierId: string,
    activity: PlanningActivity,
    week: string,
    displayedValue: number,
  ) {
    if (!snapshot?.capabilities.canEditMacro) return;
    const key = cellKey(chantierId, activity, week);
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

  return (
    <div className="grandPlanningWorkspace">
      <div className="pageHeader grandPlanningHeader">
        <div>
          <p className="eyebrow">Planning</p>
          <h1>Grand planning {initialYear}</h1>
          <p className="muted">
            Charge ferme des chantiers confirmés · BE / Atelier / Pose · saisie directe par semaine
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
          <div className="planningCapacityPeople">
            {snapshot.peopleCapacity.map((person) => (
              <label className="planningCapacityPerson" key={person.userId}>
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
                <span>
                  <strong>{person.displayName}</strong>
                  <small>
                    {formatHours(
                      Object.values(person.weeklySchedule).reduce(
                        (sum, hours) => sum + hours,
                        0,
                      ),
                    )}{" "}
                    h / semaine
                  </small>
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel grandPlanningPanel">
        <div className="grandPlanningLegend">
          <span>
            <strong>Prévu</strong> = volume chantier
          </span>
          <span>
            <strong>À répartir</strong> = prévu − semaines déjà positionnées
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
                        <span>Charge {formatHours(capacity?.firmLoadHours ?? 0)}</span>
                        <span
                          className={
                            (capacity?.firmAvailableHours ?? 0) < 0
                              ? "planningWeekAvailable isNegative"
                              : "planningWeekAvailable"
                          }
                        >
                          Dispo {formatHours(capacity?.firmAvailableHours ?? 0)}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {snapshot.rows.length === 0 ? (
                  <tr>
                    <td className="planningEmpty" colSpan={snapshot.weeks.length + 4}>
                      Aucun chantier actif à planifier.
                    </td>
                  </tr>
                ) : (
                  snapshot.rows.flatMap((chantier) =>
                    chantier.activities.map((activity, activityIndex) => (
                      <tr
                        className={activityIndex === 0 ? "planningChantierStart" : undefined}
                        key={`${chantier.chantierId}:${activity.activity}`}
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
                          const key = cellKey(chantier.chantierId, activity.activity, week);
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
                                  void saveCell(
                                    chantier.chantierId,
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
                  )
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
        .planningCapacityPeople {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        .planningCapacityPerson {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 7px 9px;
          border: 1px solid #e5e0ee;
          border-radius: 8px;
          font-size: 11px;
        }
        .planningCapacityPerson span,
        .planningCapacityPerson small {
          display: block;
        }
        .planningCapacityPerson small {
          margin-top: 1px;
          color: var(--muted);
          font-size: 9px;
        }
        .planningUnallocatedPanel {
          margin-bottom: 14px;
          padding: 16px 18px;
          background: #fff9ed;
          border: 1px solid #efdcb4;
          border-radius: 11px;
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
        .planningWeekAvailable {
          color: #39714c;
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

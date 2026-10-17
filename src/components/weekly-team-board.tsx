"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isoWeekMonday, weekDateRangeLabel } from "@/lib/planning/time-markers";
import { WeeklyBoardDayCell, type BoardEntry, type BoardEntryMutation } from "./weekly-board-day-cell";

type WeeklySummary = { be: number; workshop: number; install: number; total: number };
type WeeklyChantierLine = WeeklySummary & { id: string; name: string; category: "firm" | "provisional" };
type WeekData = {
  week: string;
  dates: string[];
  people: {
    userId: string;
    displayName: string;
    countsInMacroCapacity: boolean;
    weeklySchedule: Record<string, number>;
  }[];
  sites: { id: string; name: string }[];
  assignments: BoardEntry[];
  holidays: { date: string; label: string | null }[];
  firmChantiers: WeeklyChantierLine[];
  provisionalChantiers: WeeklyChantierLine[];
  absences: {
    userId: string;
    date: string;
    type: "VACATION" | "SICK" | "OTHER";
    typeLabel: string;
    hours: number;
  }[];
  firm: WeeklySummary;
  provisional: WeeklySummary;
  capacity: {
    totalCapacityHours: number;
    firmAvailableHours: number;
    availableWithProvisionHours: number;
  };
  editable: boolean;
};

const WEEKDAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"];
const WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const formatHours = (hours: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(hours);
const cellKey = (userId: string, date: string) => userId + ":" + date;

function adjacentWeek(week: string, step: number) {
  const monday = isoWeekMonday(week);
  monday.setUTCDate(monday.getUTCDate() + step * 7);
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(januaryFourth);
  firstMonday.setUTCDate(4 - ((januaryFourth.getUTCDay() + 6) % 7));
  const number = Math.floor((monday.getTime() - firstMonday.getTime()) / (7 * 86400000)) + 1;
  return `${year}-W${String(number).padStart(2, "0")}`;
}

export function WeeklyTeamBoard({ week }: { week: string }) {
  const [data, setData] = useState<WeekData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/desktop/planning/weekly-board?week=${week}`, {
        cache: "no-store",
      });
      const json = (await response.json()) as WeekData & { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Impossible de charger le petit planning.");
      setData(json);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de charger le petit planning.");
    } finally {
      setLoading(false);
    }
  }, [week]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignments = useMemo(() => {
    const byDay = new Map<string, BoardEntry[]>();
    for (const row of data?.assignments ?? []) {
      const key = cellKey(row.userId, row.date);
      const existing = byDay.get(key) ?? [];
      existing.push(row);
      byDay.set(key, existing);
    }
    return byDay;
  }, [data?.assignments]);
  const absences = useMemo(
    () => new Map((data?.absences ?? []).map((row) => [cellKey(row.userId, row.date), row])),
    [data?.absences],
  );
  const holidays = useMemo(
    () => new Map((data?.holidays ?? []).map((row) => [row.date, row.label])),
    [data?.holidays],
  );
  const dayLabel = (date: string) => {
    const [, month, day] = date.split("-");
    return day + "/" + month;
  };

  async function changeEntry(input: BoardEntryMutation): Promise<boolean> {
    if (!data?.editable || saving) return false;
    setSaving(cellKey(input.userId, input.date));
    setMessage("");
    try {
      const response = await fetch("/api/desktop/planning/weekly-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, week }),
      });
      const json = (await response.json()) as WeekData & { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Enregistrement impossible.");
      setData(json);
      setMessage(input.action === "deleteDailyEntry" ? "Affectation supprimée." : "Affectation enregistrée.");
      return true;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Enregistrement impossible.");
      return false;
    } finally {
      setSaving(null);
    }
  }

  const previous = adjacentWeek(week, -1);
  const next = adjacentWeek(week, 1);
  const period = weekDateRangeLabel(week);
  const totalPeople = data?.people.length ?? 0;

  return (
    <div className="weeklyBoard">
      <div className="weeklyBoardTop">
        <div>
          <p className="eyebrow">PLANNING · ÉQUIPE</p>
          <h1>
            Petit planning{" "}
            <span>
              · S{week.slice(-2)} / {week.slice(0, 4)}
            </span>
          </h1>
          <p>Du {period} · affectations journalières de l&apos;équipe</p>
        </div>
        <div className="weeklyBoardControls">
          <Link className="secondaryButton" href={`/planning/${previous}`}>
            ← Semaine précédente
          </Link>
          <Link className="secondaryButton" href={`/planning/${next}`}>
            Semaine suivante →
          </Link>
          <Link className="secondaryButton" href={`/planning?year=${week.slice(0, 4)}`}>
            Grand planning
          </Link>
        </div>
      </div>

      <nav className="weeklyBoardTabs" aria-label="Modules du planning">
        <Link href={`/planning?year=${week.slice(0, 4)}`}>Grand planning</Link>
        <Link className="isActive" href={`/planning/${week}`} aria-current="page">
          Petit planning
        </Link>
        <Link href={`/planning?year=${week.slice(0, 4)}&tab=personnel`}>Gestion du personnel</Link>
      </nav>

      {loading ? <p className="weeklyBoardMessage">Chargement des équipes…</p> : null}
      {error ? (
        <div className="weeklyBoardMessage" role="alert">
          {error}{" "}
          <button type="button" onClick={() => void load()}>
            Réessayer
          </button>
        </div>
      ) : null}

      {data && !loading ? (
        <>
          <div className="weeklyBoardTopline">
            <div className="weeklyBoardIntro">
              <strong>S{week.slice(-2)}</strong>
              <span>Du {period}</span>
              <small>
                {totalPeople} personne{totalPeople > 1 ? "s" : ""} · lundi à vendredi
              </small>
            </div>
            <aside className="weeklyBoardHours" aria-label="Extrait du grand planning pour la semaine">
              <div className="weeklyBoardHoursHeading">
                <strong>Extrait du grand planning · S{week.slice(-2)}</strong>
                <span>Heures prévues cette semaine</span>
              </div>
              <div className="weeklyBoardChantierScroll">
                <table className="weeklyBoardChantierTable">
                  <thead>
                    <tr>
                      <th scope="col">Chantier / affaire</th>
                      <th scope="col">BE</th>
                      <th scope="col">Atelier</th>
                      <th scope="col">Pose</th>
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.firmChantiers.map((row) => (
                      <tr key={`firm:${row.id}`}>
                        <th scope="row">{row.name}</th>
                        <td>{formatHours(row.be)}</td>
                        <td>{formatHours(row.workshop)}</td>
                        <td>{formatHours(row.install)}</td>
                        <td><strong>{formatHours(row.total)}</strong></td>
                      </tr>
                    ))}
                    {data.provisionalChantiers.map((row) => (
                      <tr className="isProvisional" key={`provisional:${row.id}`}>
                        <th scope="row">{row.name} <small>Provisionnel</small></th>
                        <td>{formatHours(row.be)}</td>
                        <td>{formatHours(row.workshop)}</td>
                        <td>{formatHours(row.install)}</td>
                        <td><strong>{formatHours(row.total)}</strong></td>
                      </tr>
                    ))}
                    {data.firmChantiers.length + data.provisionalChantiers.length === 0 ? (
                      <tr><td colSpan={5}>Aucune heure positionnée cette semaine.</td></tr>
                    ) : null}
                    <tr className="weeklyBoardTotalRow">
                      <th scope="row">Total ferme</th>
                      <td>{formatHours(data.firm.be)}</td>
                      <td>{formatHours(data.firm.workshop)}</td>
                      <td>{formatHours(data.firm.install)}</td>
                      <td><strong>{formatHours(data.firm.total)}</strong></td>
                    </tr>
                    <tr className="weeklyBoardTotalRow isProvisional">
                      <th scope="row">Total provisionnel</th>
                      <td>{formatHours(data.provisional.be)}</td>
                      <td>{formatHours(data.provisional.workshop)}</td>
                      <td>{formatHours(data.provisional.install)}</td>
                      <td><strong>{formatHours(data.provisional.total)}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="weeklyBoardAvailable">
                <span>Disponible ferme <b>{formatHours(data.capacity.firmAvailableHours)} h</b></span>
                <span>Avec potentiel <b>{formatHours(data.capacity.availableWithProvisionHours)} h</b></span>
              </div>
            </aside>
          </div>

          <div className="weeklyBoardTableScroll">
            <table className="weeklyBoardTable">
              <thead>
                <tr>
                  <th scope="col" className="weeklyBoardNameHead">
                    Personnel
                  </th>
                  {data.dates.map((date, index) => {
                    const holiday = holidays.get(date);
                    return (
                      <th
                        key={date}
                        scope="col"
                        title={holiday ?? undefined}
                        className={holiday ? "weeklyBoardDayHead isHoliday" : "weeklyBoardDayHead"}
                      >
                        {WEEKDAY_NAMES[index]}
                        <small>{dayLabel(date)}</small>
                        {holiday ? <small className="weeklyBoardHolidayHeader">Jour férié</small> : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.people.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="weeklyBoardEmpty">
                      Aucun salarié. Ajoute des personnes dans Gestion du personnel.
                    </td>
                  </tr>
                ) : (
                  data.people.map((person, index) => (
                    <tr key={person.userId}>
                      <th
                        scope="row"
                        className={
                          index % 2 ? "weeklyBoardPerson isAlternate" : "weeklyBoardPerson"
                        }
                      >
                        <strong>{person.displayName}</strong>
                        <small>
                          {person.countsInMacroCapacity
                            ? "Compté dans la capacité"
                            : "Hors capacité"}
                        </small>
                      </th>
                      {data.dates.map((date, dayIndex) => {
                        const key = cellKey(person.userId, date);
                        const absence = absences.get(key);
                        const schedule = person.weeklySchedule[WEEKDAY_KEYS[dayIndex]] ?? 0;
                        const dayOff = absence != null && absence.hours >= schedule && schedule > 0;
                        const holiday = holidays.get(date) ?? null;
                        return (
                          <td
                            key={date}
                            className={["weeklyBoardCell", holiday ? "isHoliday" : ""].join(" ")}
                          >
                            <WeeklyBoardDayCell
                              userId={person.userId}
                              date={date}
                              name={person.displayName}
                              rows={assignments.get(key) ?? []}
                              holiday={holiday}
                              absence={absence}
                              isAbsent={dayOff}
                              editable={data.editable}
                              busy={saving !== null}
                              onChange={changeEntry}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <datalist id="weekly-board-site-suggestions">
              {data.sites.map((site) => (
                <option key={site.id} value={site.name} />
              ))}
            </datalist>
          </div>
          <div className="weeklyBoardFooter">
            <span>
              <i className="weeklyLegendChip isChantier" /> Chantier / activité
            </span>
            <span>
              <i className="weeklyLegendChip isVacation" /> Congé
            </span>
            <span>
              <i className="weeklyLegendChip isSick" /> Arrêt
            </span>
            <span><i className="weeklyLegendChip isBE" /> BE</span>
            <span><i className="weeklyLegendChip isWorkshop" /> Atelier</span>
            <span><i className="weeklyLegendChip isInstall" /> Pose</span>
            <span><i className="weeklyLegendChip isHoliday" /> Jour férié</span>
            <span>Les affectations ne modifient pas les heures du grand planning.</span>
          </div>
          {!data.editable ? (
            <p className="weeklyBoardMessage">
              Lecture seule : semaine passée ou droits insuffisants.
            </p>
          ) : null}
          {message ? (
            <p className="weeklyBoardMessage" role="status">
              {message}
            </p>
          ) : null}
        </>
      ) : null}

      <style jsx global>{`
        .weeklyBoard {
          padding: 0 0 30px;
          color: #27223b;
        }
        .weeklyBoardTop {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
          align-items: center;
          margin: 0 0 14px;
        }
        .weeklyBoardTop h1 {
          font-size: 22px;
          margin: 4px 0 6px;
          font-weight: 850;
        }
        .weeklyBoardTop h1 span {
          color: #7061a7;
          font-size: 15px;
          font-weight: 700;
        }
        .weeklyBoardTop p:not(.eyebrow) {
          font-size: 12px;
          color: #7b728e;
          margin: 0;
        }
        .weeklyBoardControls {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .weeklyBoardTabs {
          display: flex;
          gap: 5px;
          margin-bottom: 14px;
          border-bottom: 1px solid #ded7ee;
        }
        .weeklyBoardTabs a {
          display: inline-block;
          padding: 12px 19px;
          border-bottom: 3px solid transparent;
          font-size: 12px;
          font-weight: 800;
          color: #766a91;
        }
        .weeklyBoardTabs a.isActive {
          color: #6450ad;
          background: #eeeafb;
          border-bottom-color: #7666d6;
        }
        .weeklyBoardTopline {
          display: flex;
          gap: 14px;
          align-items: stretch;
          justify-content: space-between;
          flex-wrap: wrap;
          margin-bottom: 11px;
        }
        .weeklyBoardIntro {
          display: grid;
          gap: 5px;
          align-content: center;
          padding: 16px 20px;
          flex: 1;
          min-width: 180px;
          background: #faf8ff;
          border: 1px solid #e5ddf1;
          border-radius: 10px;
        }
        .weeklyBoardIntro > strong {
          font-size: 24px;
          color: #392d60;
        }
        .weeklyBoardIntro > span {
          font-size: 15px;
          font-weight: 800;
        }
        .weeklyBoardIntro small {
          color: #7c7392;
          font-size: 11px;
        }
        .weeklyBoardHours {
          background: #fff;
          border: 1px solid #dcd2ef;
          border-radius: 10px;
          padding: 12px 14px;
          min-width: min(100%, 500px);
          max-width: 570px;
        }
        .weeklyBoardHoursHeading {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
          font-size: 12px;
          color: #59498d;
        }
        .weeklyBoardHoursHeading span {
          font-size: 11px;
          color: #8678a8;
        }
        .weeklyBoardHoursGrid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 4px;
        }
        .weeklyBoardHoursGrid > div {
          display: grid;
          grid-template-columns: 65px repeat(4, minmax(45px, 1fr));
          gap: 6px;
          align-items: center;
          background: #f7f4fd;
          border-radius: 5px;
          padding: 6px;
          font-size: 10px;
          white-space: nowrap;
        }
        .weeklyBoardHoursGrid > div small {
          color: #7b6c9a;
        }
        .weeklyBoardHoursGrid > div b,
        .weeklyBoardHoursGrid > div span,
        .weeklyBoardHoursGrid > div strong {
          text-align: right;
        }
        .weeklyBoardAvailable {
          display: flex;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 10px;
          padding-top: 9px;
          font-size: 11px;
        }
        .weeklyBoardAvailable b {
          margin-left: 7px;
          color: #4b368e;
        }
        .weeklyBoardTableScroll {
          width: 100%;
          overflow-x: auto;
          border: 1px solid #d7d4d8;
          border-radius: 9px;
          background: white;
        }
        .weeklyBoardTable {
          min-width: 900px;
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: fixed;
        }
        .weeklyBoardTable th,
        .weeklyBoardTable td {
          border-right: 1px solid #c5c3c9;
          border-bottom: 1px solid #c5c3c9;
        }
        .weeklyBoardNameHead {
          width: 185px;
          text-align: left;
          background: #ede8f6;
          padding: 13px 16px;
          font-size: 12px;
        }
        .weeklyBoardDayHead {
          text-align: center;
          background: #dedde2;
          padding: 10px 4px;
          font-size: 15px;
          font-weight: 850;
        }
        .weeklyBoardDayHead small {
          display: block;
          color: #625b6a;
          margin-top: 3px;
          font-size: 10px;
          font-weight: 600;
        }
        .weeklyBoardPerson {
          background: #d9e5f5;
          text-align: left;
          padding: 12px;
          overflow-wrap: anywhere;
        }
        .weeklyBoardPerson.isAlternate {
          background: #cbd9ef;
        }
        .weeklyBoardPerson strong {
          font-size: 13px;
          display: block;
        }
        .weeklyBoardPerson small {
          font-size: 9px;
          color: #667086;
          font-weight: 500;
          display: block;
          margin-top: 6px;
        }
        .weeklyBoardCell {
          background: #edf3e8;
          padding: 5px 7px;
          height: 74px;
          position: relative;
        }
        .weeklyBoardCell:nth-child(even) {
          background: #e5eff9;
        }
        .weeklyBoardCell input {
          width: 100%;
          min-height: 56px;
          border: 1px solid transparent;
          border-radius: 4px;
          background: transparent;
          padding: 9px 7px;
          color: #21314b;
          text-align: center;
          font-size: 12px;
          font-weight: 650;
        }
        .weeklyBoardCell input::placeholder {
          color: #a9b2b5;
          font-size: 10px;
        }
        .weeklyBoardCell input:focus {
          border-color: #8771d2;
          outline: 2px solid #c9baff;
          background: white;
        }
        .weeklyBoardCell.hasVacation {
          background: #75b84d !important;
        }
        .weeklyBoardCell.hasSick {
          background: #f5b872 !important;
        }
        .weeklyBoardCell.hasOtherAbsence {
          background: #e6d6a9 !important;
        }
        .weeklyBoardAbsence {
          display: block;
          text-align: center;
          color: #29331c;
          font-weight: 800;
          font-size: 11px;
          padding: 3px;
        }
        .weeklyBoardCell:has(.weeklyBoardAbsence) input {
          min-height: 30px;
        }
        .weeklyBoardDayOff {
          display: block;
          text-align: center;
          font-size: 10px;
          font-weight: 700;
          color: #254625;
          padding: 8px;
        }
        .weeklyBoardFooter {
          display: flex;
          gap: 17px;
          flex-wrap: wrap;
          align-items: center;
          padding: 10px 4px;
          color: #716a80;
          font-size: 10px;
        }
        .weeklyBoardFooter span {
          display: inline-flex;
          gap: 5px;
          align-items: center;
        }
        .weeklyLegendChip {
          display: inline-block;
          width: 13px;
          height: 10px;
          border-radius: 2px;
        }
        .weeklyLegendChip.isChantier {
          background: #dfeee4;
        }
        .weeklyLegendChip.isVacation {
          background: #75b84d;
        }
        .weeklyLegendChip.isSick {
          background: #f5b872;
        }
        .weeklyBoardMessage {
          padding: 12px 14px;
          margin: 10px 0;
          background: #f6f1ff;
          color: #544580;
          border-radius: 7px;
          font-size: 12px;
        }
        .weeklyBoardEmpty {
          padding: 30px;
          text-align: center;
          color: #796f91;
        }

        .weeklyBoardHours { width: min(100%, 730px); max-width: 730px; }
        .weeklyBoardChantierScroll { max-height: 265px; overflow: auto; }
        .weeklyBoardChantierTable { width: 100%; border-collapse: collapse; font-size: 10px; }
        .weeklyBoardChantierTable th { text-align: left; }
        .weeklyBoardChantierTable thead th { position: sticky; top: 0; background: #ede7fb; z-index: 1; }
        .weeklyBoardChantierTable td, .weeklyBoardChantierTable th { padding: 6px 8px; border-bottom: 1px solid #eee9f4; }
        .weeklyBoardChantierTable td { text-align: right; font-variant-numeric: tabular-nums; }
        .weeklyBoardChantierTable tbody th { font-weight: 650; }
        .weeklyBoardChantierTable small { font-size: 9px; color: #7a7392; }
        .weeklyBoardChantierTable tr.isProvisional { background: #faf8ff; color: #857ba0; }
        .weeklyBoardChantierTable .weeklyBoardTotalRow { background: #eae5f6; font-weight: 800; }
        .weeklyBoardDayHead.isHoliday { background: #f9dfbc; color: #875514; }
        .weeklyBoardHolidayHeader { color: #935814 !important; font-weight: 850 !important; }
        .weeklyBoardCell.isHoliday { background: #fff0dc !important; }
        .weeklyBoardDayContent { display: grid; align-content: start; gap: 6px; height: 100%; }
        .weeklyBoardHolidayFlag { text-align: center; font-size: 10px; font-weight: 800; color: #98601c; }
        .weeklyBoardEntry { border-left: 4px solid; border-radius: 6px; padding: 6px 7px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px; }
        .weeklyBoardEntry.isBE { background: #dceafd; border-color: #3d7ed2; color: #234e85; }
        .weeklyBoardEntry.isWorkshop { background: #fff0cc; border-color: #e5a636; color: #8c561b; }
        .weeklyBoardEntry.isInstall { background: #dff1df; border-color: #5aab63; color: #285b35; }
        .weeklyBoardEntry.isNote { background: #f1eef5; border-color: #9d94ad; color: #514c61; }
        .weeklyBoardEntryInfo { min-width: 0; overflow-wrap: anywhere; }
        .weeklyBoardEntryInfo strong { display: block; font-size: 11px; }
        .weeklyBoardEntryInfo small { display: block; margin-top: 3px; font-size: 9px; }
        .weeklyBoardEntryActions { display: flex; align-items: flex-start; }
        .weeklyBoardEntryActions button { border: none; background: transparent; color: inherit; font-size: 14px; cursor: pointer; padding: 0 3px; }
        .weeklyBoardEditForm { display: grid; gap: 5px; grid-column: 1 / -1; }
        .weeklyBoardEditForm input, .weeklyBoardEditForm select { width: 100%; min-width: 0; min-height: 30px; padding: 5px; border: 1px solid #a99fc2; border-radius: 5px; font-size: 11px; background: white; }
        .weeklyBoardEditActions { display: flex; gap: 5px; }
        .weeklyBoardEditActions button, .weeklyBoardAddEntry { border: 1px solid #c6b9da; border-radius: 5px; padding: 5px 7px; color: #59469a; background: #fff; font-weight: 750; font-size: 10px; cursor: pointer; }
        .weeklyBoardAddEntry { width: 100%; background: rgb(255 255 255 / 0.72); }
        .weeklyBoardLegendChip.isBE { background: #3d7ed2; }
        .weeklyLegendChip.isBE { background: #3d7ed2; }
        .weeklyLegendChip.isWorkshop { background: #e5a636; }
        .weeklyLegendChip.isInstall { background: #5aab63; }
        .weeklyLegendChip.isHoliday { background: #f9dfbc; }
        .weeklyBoardCell { vertical-align: top; min-height: 80px; }
        @media (max-width: 850px) {
          .weeklyBoardTopline {
            display: block;
          }
          .weeklyBoardHours {
            margin-top: 10px;
            min-width: 0;
            max-width: none;
          }
          .weeklyBoardHoursGrid {
            overflow-x: auto;
          }
          .weeklyBoardHoursGrid > div {
            min-width: 400px;
          }
        }
      `}</style>
    </div>
  );
}

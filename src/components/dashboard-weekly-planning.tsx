"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { shiftDashboardPlanningWeek } from "@/lib/planning/dashboard-week";
import { weekDateRangeLabel } from "@/lib/planning/time-markers";

type BoardActivity = "BE" | "WORKSHOP" | "INSTALL" | "NOTE";
type BoardEntry = {
  id?: string;
  userId: string;
  date: string;
  label: string;
  activity: BoardActivity;
};
type WeekSnapshot = {
  week: string;
  dates: string[];
  people: {
    userId: string;
    displayName: string;
    endDate: string | null;
    inactiveSince: string | null;
  }[];
  assignments: BoardEntry[];
  absences: {
    userId: string;
    date: string;
    typeLabel: string;
    hours: number;
  }[];
  holidays: { date: string; label: string | null }[];
};

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi"] as const;
const activityLabels: Record<BoardActivity, string> = {
  BE: "BE",
  WORKSHOP: "Atelier",
  INSTALL: "Pose",
  NOTE: "Note",
};
const activityStyles: Record<BoardActivity, string> = {
  BE: "isBE",
  WORKSHOP: "isWorkshop",
  INSTALL: "isInstall",
  NOTE: "isNote",
};
function cellKey(idUtilisateur: string, date: string): string {
  return idUtilisateur + ":" + date;
}

export function DashboardWeeklyPlanning({ initialWeek }: { initialWeek: string }) {
  const [semaine, setWeek] = useState(initialWeek);
  const [snapshot, setSnapshot] = useState<WeekSnapshot | null>(null);
  const [chargement, setLoading] = useState(true);
  const [erreur, setError] = useState("");
  const [reload, setReload] = useState(0);
  const donnees = snapshot?.week === semaine ? snapshot : null;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const reponse = await fetch(
          "/api/desktop/planning/weekly-board?week=" + encodeURIComponent(semaine),
          { cache: "no-store", signal: controller.signal },
        );
        if (reponse.status === 403) throw new Error("Accès au planning non autorisé.");
        if (!reponse.ok) throw new Error("Impossible de charger le planning.");
        const received = (await reponse.json()) as WeekSnapshot;
        if (!controller.signal.aborted) setSnapshot(received);
      } catch (cause) {
        if (!controller.signal.aborted) {
          setSnapshot(null);
          setError(cause instanceof Error ? cause.message : "Planning indisponible.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [semaine, reload]);

  const entriesByCell = useMemo(() => {
    const lignesTableau = new Map<string, BoardEntry[]>();
    for (const entree of donnees?.assignments ?? []) {
      const cle = cellKey(entree.userId, entree.date);
      lignesTableau.set(cle, [...(lignesTableau.get(cle) ?? []), entree]);
    }
    return lignesTableau;
  }, [donnees]);

  const absencesByCell = useMemo(
    () =>
      new Map(
        (donnees?.absences ?? []).map((ligneTableau) => [
          cellKey(ligneTableau.userId, ligneTableau.date),
          ligneTableau,
        ]),
      ),
    [donnees],
  );
  const holidaysByDate = useMemo(
    () =>
      new Map(
        (donnees?.holidays ?? []).map((ligneTableau) => [ligneTableau.date, ligneTableau.label]),
      ),
    [donnees],
  );

  return (
    <article className="dashboardPanel dashboardWeeklyPlanning">
      <div className="dashboardPanelHeader dashboardWeeklyHeader">
        <div>
          <h2>Planning de la semaine</h2>
          <p>
            S{semaine.slice(-2)} · Du {weekDateRangeLabel(semaine)} · affectations réelles de
            l&apos;équipe
          </p>
        </div>
        <div className="dashboardWeeklyControls">
          <button
            type="button"
            className="dashboardWeeklyArrow"
            aria-label="Semaine précédente"
            title="Semaine précédente"
            onClick={() => setWeek((precedent) => shiftDashboardPlanningWeek(precedent, -1))}
          >
            <ChevronLeft size={19} />
          </button>
          {semaine !== initialWeek ? (
            <button
              type="button"
              className="dashboardWeeklyCurrent"
              onClick={() => setWeek(initialWeek)}
            >
              Cette semaine
            </button>
          ) : null}
          <button
            type="button"
            className="dashboardWeeklyArrow"
            aria-label="Semaine suivante"
            title="Semaine suivante"
            onClick={() => setWeek((precedent) => shiftDashboardPlanningWeek(precedent, 1))}
          >
            <ChevronRight size={19} />
          </button>
          <Link className="dashboardWeeklyOpen" href={"/planning/" + semaine}>
            Ouvrir le planning
          </Link>
        </div>
      </div>

      {chargement ? (
        <p className="dashboardWeeklyMessage" role="status">
          Chargement du planning…
        </p>
      ) : null}
      {erreur && !chargement ? (
        <div className="dashboardWeeklyMessage" role="alert">
          {erreur}{" "}
          <button type="button" onClick={() => setReload((valeur) => valeur + 1)}>
            <RotateCcw size={13} /> Réessayer
          </button>
        </div>
      ) : null}

      {donnees && !chargement ? (
        <div className="dashboardWeeklyScroll">
          <table className="dashboardWeeklyTable">
            <thead>
              <tr>
                <th scope="col">Personnel</th>
                {donnees.dates.map((date, indice) => (
                  <th key={date} scope="col" title={holidaysByDate.get(date) ?? undefined}>
                    {DAYS[indice] ?? "Jour"}
                    <small>
                      {date.slice(8, 10)}/{date.slice(5, 7)}
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {donnees.people.map((personne) => (
                <tr key={personne.userId}>
                  <th scope="row" className="dashboardWeeklyPerson">
                    {personne.displayName}
                  </th>
                  {donnees.dates.map((date) => {
                    const lignesTableau = entriesByCell.get(cellKey(personne.userId, date)) ?? [];
                    const absence = absencesByCell.get(cellKey(personne.userId, date));
                    const holiday = holidaysByDate.get(date);
                    const present =
                      (!personne.endDate || date <= personne.endDate) &&
                      (!personne.inactiveSince || date < personne.inactiveSince);
                    return (
                      <td key={date} className={holiday ? "dashboardWeeklyHoliday" : undefined}>
                        {holiday ? (
                          <span className="dashboardWeeklyFlag">Férié · {holiday}</span>
                        ) : null}
                        {absence ? (
                          <span className="dashboardWeeklyAbsence">
                            {absence.typeLabel} · {absence.hours.toLocaleString("fr-FR")} h
                          </span>
                        ) : null}
                        {lignesTableau.map((ligneTableau, indice) => (
                          <div
                            key={ligneTableau.id ?? ligneTableau.date + ":" + indice}
                            className={
                              "dashboardWeeklyEntry " + activityStyles[ligneTableau.activity]
                            }
                          >
                            <strong title={ligneTableau.label}>{ligneTableau.label}</strong>
                            <small>{activityLabels[ligneTableau.activity]}</small>
                          </div>
                        ))}
                        {!present && lignesTableau.length === 0 ? (
                          <span className="dashboardWeeklyMuted">Hors présence</span>
                        ) : null}
                        {present && lignesTableau.length === 0 && !absence && !holiday ? (
                          <span className="dashboardWeeklyMuted">Non planifié</span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {donnees.people.length === 0 ? (
                <tr>
                  <td className="dashboardWeeklyNoPeople" colSpan={donnees.dates.length + 1}>
                    Aucun salarié dans le planning pour cette semaine.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      <style jsx global>{`
        .dashboardWeeklyPlanning {
          grid-column: 1 / -1;
          min-height: 220px;
        }
        .dashboardWeeklyHeader {
          align-items: center;
          flex-wrap: wrap;
        }
        .dashboardWeeklyHeader h2 {
          font-size: 17px;
        }
        .dashboardWeeklyHeader p {
          font-size: 12px;
        }
        .dashboardWeeklyControls {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .dashboardWeeklyArrow,
        .dashboardWeeklyCurrent {
          display: inline-flex;
          justify-content: center;
          align-items: center;
          min-height: 34px;
          border: 1px solid #ded5eb;
          background: #f7f3fc;
          border-radius: 8px;
          color: #65469d;
          cursor: pointer;
          font-weight: 700;
        }
        .dashboardWeeklyArrow {
          width: 36px;
        }
        .dashboardWeeklyCurrent {
          padding: 0 11px;
          font-size: 12px;
        }
        .dashboardWeeklyOpen {
          display: inline-flex;
          align-items: center;
          color: #65469d;
          font-size: 12px;
          font-weight: 800;
          padding: 7px 3px;
          text-decoration: none;
        }
        .dashboardWeeklyArrow:focus-visible,
        .dashboardWeeklyCurrent:focus-visible,
        .dashboardWeeklyOpen:focus-visible {
          outline: 3px solid #bba8e4;
          outline-offset: 2px;
        }
        .dashboardWeeklyMessage {
          margin: 16px 0 0;
          background: #f7f3fc;
          padding: 15px;
          border-radius: 8px;
          color: #654b86;
          font-size: 13px;
        }
        .dashboardWeeklyMessage button {
          border: 0;
          background: transparent;
          color: #65469d;
          cursor: pointer;
          display: inline-flex;
          gap: 5px;
          align-items: center;
          font-weight: 800;
        }
        .dashboardWeeklyScroll {
          width: 100%;
          max-height: 480px;
          overflow: auto;
          border: 1px solid #e7e0ee;
          border-radius: 9px;
          margin-top: 16px;
        }
        .dashboardWeeklyTable {
          border-collapse: separate;
          border-spacing: 0;
          width: 100%;
          min-width: 720px;
          table-layout: fixed;
        }
        .dashboardWeeklyTable th,
        .dashboardWeeklyTable td {
          border-right: 1px solid #e8e1f0;
          border-bottom: 1px solid #e8e1f0;
          padding: 8px;
          vertical-align: top;
        }
        .dashboardWeeklyTable thead th {
          position: sticky;
          top: 0;
          z-index: 2;
          background: #eee8f8;
          color: #554376;
          font-size: 11px;
          text-align: left;
        }
        .dashboardWeeklyTable thead th:first-child {
          width: 175px;
        }
        .dashboardWeeklyTable thead small {
          display: block;
          font-weight: 500;
          margin-top: 2px;
          font-size: 10px;
        }
        .dashboardWeeklyPerson {
          position: sticky;
          left: 0;
          z-index: 1;
          background: #faf8fd;
          font-size: 12px;
          color: #43365f;
          text-align: left;
          width: 175px;
        }
        .dashboardWeeklyTable tbody tr:nth-child(even) .dashboardWeeklyPerson {
          background: #f3eff9;
        }
        .dashboardWeeklyTable tbody td {
          min-width: 112px;
          background: white;
        }
        .dashboardWeeklyTable tbody tr:nth-child(even) td {
          background: #fdfbff;
        }
        .dashboardWeeklyTable tbody td.dashboardWeeklyHoliday {
          background: #fcf9eb;
        }
        .dashboardWeeklyEntry {
          padding: 5px 7px;
          margin-bottom: 4px;
          border-radius: 5px;
          border-left: 3px solid #9e8ac1;
          background: #f2eef9;
          color: #493962;
        }
        .dashboardWeeklyEntry strong {
          display: block;
          overflow-wrap: anywhere;
          font-size: 11px;
          line-height: 1.25;
        }
        .dashboardWeeklyEntry small {
          display: block;
          font-size: 9px;
          opacity: 0.8;
          margin-top: 3px;
        }
        .dashboardWeeklyEntry.isBE {
          border-left-color: #6e74cc;
          background: #eeefff;
        }
        .dashboardWeeklyEntry.isWorkshop {
          border-left-color: #ce924b;
          background: #fff5e7;
        }
        .dashboardWeeklyEntry.isInstall {
          border-left-color: #54a58e;
          background: #eaf8f1;
        }
        .dashboardWeeklyEntry.isNote {
          border-left-color: #a68ac2;
          background: #f3eefe;
        }
        .dashboardWeeklyAbsence,
        .dashboardWeeklyFlag {
          display: block;
          padding: 4px 5px;
          margin-bottom: 4px;
          border-radius: 4px;
          font-size: 10px;
          line-height: 1.3;
        }
        .dashboardWeeklyAbsence {
          background: #fff0f0;
          color: #a34c4c;
        }
        .dashboardWeeklyFlag {
          background: #f7efc7;
          color: #786518;
        }
        .dashboardWeeklyMuted {
          color: #a19aaa;
          font-size: 10px;
        }
        .dashboardWeeklyNoPeople {
          padding: 25px !important;
          color: #766885;
          text-align: center;
          font-size: 13px;
        }
        @media (max-width: 850px) {
          .dashboardWeeklyControls {
            width: 100%;
          }
          .dashboardWeeklyTable {
            min-width: 720px;
          }
        }
      `}</style>
    </article>
  );
}

"use client";

import { useState, type FormEvent } from "react";

export type BoardActivity = "BE" | "WORKSHOP" | "INSTALL" | "NOTE";
export type BoardEntry = {
  id?: string;
  userId: string;
  date: string;
  chantierId: string | null;
  label: string;
  activity: BoardActivity;
};

export type BoardEntryMutation = {
  action: "saveDailyEntry" | "deleteDailyEntry";
  userId: string;
  date: string;
  id?: string;
  legacy?: boolean;
  label?: string;
  activity?: BoardActivity;
};

const activityLabels: Record<BoardActivity, string> = {
  BE: "BE",
  WORKSHOP: "Atelier",
  INSTALL: "Pose",
  NOTE: "Texte libre",
};
const activityClasses: Record<BoardActivity, string> = {
  BE: "isBE",
  WORKSHOP: "isWorkshop",
  INSTALL: "isInstall",
  NOTE: "isNote",
};

export function WeeklyBoardDayCell({
  userId,
  date,
  name,
  rows,
  holiday,
  absence,
  isAbsent,
  editable,
  busy,
  onChange,
}: {
  userId: string;
  date: string;
  name: string;
  rows: BoardEntry[];
  holiday: string | null;
  absence: { type: string; typeLabel: string; hours: number } | undefined;
  isAbsent: boolean;
  editable: boolean;
  busy: boolean;
  onChange: (input: BoardEntryMutation) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftActivity, setDraftActivity] = useState<BoardActivity>("NOTE");

  function edit(row?: BoardEntry) {
    setEditing(row ? row.id ?? "legacy" : "new");
    setDraftLabel(row?.label ?? "");
    setDraftActivity(row?.activity ?? "NOTE");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draftLabel.trim()) return;
    const row = rows.find((candidate) =>
      (candidate.id ?? "legacy") === editing,
    );
    const ok = await onChange({
      action: "saveDailyEntry",
      userId,
      date,
      id: row?.id,
      legacy: !!row && !row.id,
      label: draftLabel.trim(),
      activity: draftActivity,
    });
    if (ok) setEditing(null);
  }

  async function remove(row: BoardEntry) {
    if (busy) return;
    await onChange({
      action: "deleteDailyEntry",
      userId,
      date,
      id: row.id,
      legacy: !row.id,
    });
    if (editing === (row.id ?? "legacy")) setEditing(null);
  }

  return (
    <div className={["weeklyBoardDayContent", holiday ? "isHoliday" : ""].join(" ")}>
      {holiday ? (
        <span className="weeklyBoardHolidayFlag" title={holiday}>Férié · {holiday}</span>
      ) : null}
      {absence ? (
        <span className="weeklyBoardAbsence">
          {absence.typeLabel} · {absence.hours.toLocaleString("fr-FR")} h
        </span>
      ) : null}
      {rows.map((row) => {
        const key = row.id ?? "legacy";
        const isEditing = editing === key;
        return (
          <div key={key} className={`weeklyBoardEntry ${activityClasses[row.activity]}`}>
            <div className="weeklyBoardEntryInfo">
              <strong>{row.label}</strong>
              <small>{activityLabels[row.activity]}</small>
            </div>
            {editable && !isAbsent ? (
              <div className="weeklyBoardEntryActions">
                <button type="button" disabled={busy} aria-label={`Modifier ${row.label}`} onClick={() => edit(row)}>✎</button>
                <button type="button" disabled={busy} aria-label={`Supprimer ${row.label}`} onClick={() => void remove(row)}>×</button>
              </div>
            ) : null}
            {isEditing ? (
              <form className="weeklyBoardEditForm" onSubmit={(event) => void submit(event)}>
                <input
                  aria-label={`Intitulé pour ${name}, ${date}`}
                  value={draftLabel}
                  list="weekly-board-site-suggestions"
                  onChange={(event) => setDraftLabel(event.target.value)}
                  maxLength={160}
                  required
                  autoFocus
                />
                <select aria-label="Activité" value={draftActivity} onChange={(event) => setDraftActivity(event.target.value as BoardActivity)}>
                  {Object.entries(activityLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <div className="weeklyBoardEditActions">
                  <button type="submit" disabled={busy || !draftLabel.trim()}>Enregistrer</button>
                  <button type="button" disabled={busy} onClick={() => setEditing(null)}>Annuler</button>
                </div>
              </form>
            ) : null}
          </div>
        );
      })}
      {editing === "new" ? (
        <form className="weeklyBoardEditForm" onSubmit={(event) => void submit(event)}>
          <input
            aria-label={`Nouvelle affectation pour ${name}, ${date}`}
            value={draftLabel}
            list="weekly-board-site-suggestions"
            placeholder="Chantier ou texte libre"
            onChange={(event) => setDraftLabel(event.target.value)}
            maxLength={160}
            required
            autoFocus
          />
          <select aria-label="Type d'activité" value={draftActivity} onChange={(event) => setDraftActivity(event.target.value as BoardActivity)}>
            {Object.entries(activityLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <div className="weeklyBoardEditActions">
            <button type="submit" disabled={busy || !draftLabel.trim()}>Ajouter</button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>Annuler</button>
          </div>
        </form>
      ) : null}
      {isAbsent ? (
        <span className="weeklyBoardDayOff">Indisponible</span>
      ) : editable && editing !== "new" && rows.length < 20 ? (
        <button className="weeklyBoardAddEntry" type="button" disabled={busy} onClick={() => edit()}>
          + Ajouter
        </button>
      ) : null}
    </div>
  );
}

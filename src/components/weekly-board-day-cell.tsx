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
  userId: idUtilisateur,
  date,
  name: nom,
  rows: lignesTableau,
  holiday,
  absence,
  isAbsent,
  isPresent,
  editable,
  canPaste,
  onCopyDay,
  onPasteDay,
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
  isPresent: boolean;
  editable: boolean;
  canPaste: boolean;
  onCopyDay: () => void;
  onPasteDay: () => void;
  busy: boolean;
  onChange: (saisie: BoardEntryMutation) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftActivity, setDraftActivity] = useState<BoardActivity>("NOTE");

  function edit(ligneTableau?: BoardEntry) {
    setEditing(ligneTableau ? (ligneTableau.id ?? "legacy") : "new");
    setDraftLabel(ligneTableau?.label ?? "");
    setDraftActivity(ligneTableau?.activity ?? "NOTE");
  }

  async function submit(evenement: FormEvent<HTMLFormElement>) {
    evenement.preventDefault();
    if (busy || !draftLabel.trim()) return;
    const ligneTableau = lignesTableau.find((candidat) => (candidat.id ?? "legacy") === editing);
    const ok = await onChange({
      action: "saveDailyEntry",
      userId: idUtilisateur,
      date,
      id: ligneTableau?.id,
      legacy: !!ligneTableau && !ligneTableau.id,
      label: draftLabel.trim(),
      activity: draftActivity,
    });
    if (ok) setEditing(null);
  }

  async function remove(ligneTableau: BoardEntry) {
    if (busy) return;
    await onChange({
      action: "deleteDailyEntry",
      userId: idUtilisateur,
      date,
      id: ligneTableau.id,
      legacy: !ligneTableau.id,
    });
    if (editing === (ligneTableau.id ?? "legacy")) setEditing(null);
  }

  return (
    <div className={["weeklyBoardDayContent", holiday ? "isHoliday" : ""].join(" ")}>
      {holiday ? (
        <span className="weeklyBoardHolidayFlag" title={holiday}>
          Férié · {holiday}
        </span>
      ) : null}
      {absence ? (
        <span className="weeklyBoardAbsence">
          {absence.typeLabel} · {absence.hours.toLocaleString("fr-FR")} h
        </span>
      ) : null}
      {lignesTableau.map((ligneTableau) => {
        const cle = ligneTableau.id ?? "legacy";
        const isEditing = editing === cle;
        return (
          <div key={cle} className={`weeklyBoardEntry ${activityClasses[ligneTableau.activity]}`}>
            <div className="weeklyBoardEntryInfo">
              <strong>{ligneTableau.label}</strong>
              <small>{activityLabels[ligneTableau.activity]}</small>
            </div>
            {editable && !isAbsent && isPresent ? (
              <div className="weeklyBoardEntryActions">
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Modifier ${ligneTableau.label}`}
                  onClick={() => edit(ligneTableau)}
                >
                  ✎
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Supprimer ${ligneTableau.label}`}
                  onClick={() => void remove(ligneTableau)}
                >
                  ×
                </button>
              </div>
            ) : null}
            {isEditing ? (
              <form
                className="weeklyBoardEditForm"
                onSubmit={(evenement) => void submit(evenement)}
              >
                <input
                  aria-label={`Intitulé pour ${nom}, ${date}`}
                  value={draftLabel}
                  list="weekly-board-site-suggestions"
                  onChange={(evenement) => setDraftLabel(evenement.target.value)}
                  maxLength={160}
                  required
                  autoFocus
                />
                <select
                  aria-label="Activité"
                  value={draftActivity}
                  onChange={(evenement) =>
                    setDraftActivity(evenement.target.value as BoardActivity)
                  }
                >
                  {Object.entries(activityLabels).map(([valeur, libelle]) => (
                    <option key={valeur} value={valeur}>
                      {libelle}
                    </option>
                  ))}
                </select>
                <div className="weeklyBoardEditActions">
                  <button type="submit" disabled={busy || !draftLabel.trim()}>
                    Enregistrer
                  </button>
                  <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                    Annuler
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        );
      })}
      <div className="weeklyBoardDayClipboard">
        {lignesTableau.length > 0 ? (
          <button
            type="button"
            onClick={onCopyDay}
            title="Copier toutes les affectations de cette journée"
          >
            Copier jour
          </button>
        ) : null}
        {editable && !isAbsent && isPresent && canPaste ? (
          <button
            type="button"
            disabled={busy}
            onClick={onPasteDay}
            title="Ajouter les affectations copiées sans remplacer cette journée"
          >
            Coller jour
          </button>
        ) : null}
      </div>
      {editing === "new" ? (
        <form className="weeklyBoardEditForm" onSubmit={(evenement) => void submit(evenement)}>
          <input
            aria-label={`Nouvelle affectation pour ${nom}, ${date}`}
            value={draftLabel}
            list="weekly-board-site-suggestions"
            placeholder="Chantier ou texte libre"
            onChange={(evenement) => setDraftLabel(evenement.target.value)}
            maxLength={160}
            required
            autoFocus
          />
          <select
            aria-label="Type d'activité"
            value={draftActivity}
            onChange={(evenement) => setDraftActivity(evenement.target.value as BoardActivity)}
          >
            {Object.entries(activityLabels).map(([valeur, libelle]) => (
              <option key={valeur} value={valeur}>
                {libelle}
              </option>
            ))}
          </select>
          <div className="weeklyBoardEditActions">
            <button type="submit" disabled={busy || !draftLabel.trim()}>
              Ajouter
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(null)}>
              Annuler
            </button>
          </div>
        </form>
      ) : null}
      {!isPresent ? (
        <span className="weeklyBoardDayOff">Hors période de présence</span>
      ) : isAbsent ? (
        <span className="weeklyBoardDayOff">Indisponible</span>
      ) : editable && editing !== "new" && lignesTableau.length < 20 ? (
        <button
          className="weeklyBoardAddEntry"
          type="button"
          disabled={busy}
          onClick={() => edit()}
        >
          + Ajouter
        </button>
      ) : null}
    </div>
  );
}

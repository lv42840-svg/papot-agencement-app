"use client";

import { useState, type ClipboardEvent } from "react";
import {
  formatPlanningSelection,
  planPlanningPaste,
  planningSelectionBounds,
  type PlanningClipboardCell,
  type PlanningClipboardKind,
  type PlanningClipboardUpdate,
} from "@/lib/planning/clipboard";

import type {
  GrandPlanningChantierRow,
  GrandPlanningProvisionRow,
  PlanningActivity,
} from "@/lib/planning/domain";
import { buildGrandPlanningWeekMeta, groupGrandPlanningMonths } from "@/lib/planning/time-markers";

type WeekCapacity = {
  week: string;
  totalCapacityHours: number;
  firmLoadHours: number;
  provisionalLoadHours: number;
  firmAvailableHours: number;
  availableWithProvisionHours: number;
};

type GridSnapshot = {
  year: number;
  weeks: string[];
  rows: GrandPlanningChantierRow[];
  provisionalRows: GrandPlanningProvisionRow[];
  weeklyCapacity: WeekCapacity[];
  capabilities: { canEditMacro: boolean };
};

type Props = {
  snapshot: GridSnapshot;
  drafts: Record<string, string>;
  savingKey: string | null;
  potentialCollapsed: boolean;
  potentialPreferenceSaving: boolean;
  onDraftChange: (cle: string, valeur: string) => void;
  onDraftClear: (cle: string) => void;
  onSaveFirm: (
    chantierId: string,
    activity: PlanningActivity,
    semaine: string,
    valeur: number,
  ) => Promise<void>;
  onSaveProvision: (
    idAffaire: string,
    activity: PlanningActivity,
    semaine: string,
    valeur: number,
  ) => Promise<void>;
  onMoveFirm: (chantierId: string, direction: -1 | 1) => Promise<void>;
  onMoveProvision: (idAffaire: string, direction: -1 | 1) => Promise<void>;
  onTogglePotential: () => Promise<void>;
  onPasteBatch: (updates: PlanningClipboardUpdate[]) => Promise<void>;
  onClipboardError: (message: string) => void;
};

const ACTIVITIES: PlanningActivity[] = ["BE", "WORKSHOP", "INSTALL"];
const ACTIVITY_LABELS = ["Ét", "Fa", "Po"];

function fmt(valeur: number): string {
  return Number.isInteger(valeur) ? String(valeur) : String(valeur).replace(".", ",");
}

function tripleValues(valeurs: number[]) {
  return (
    <div className="excelTriple excelTripleValues">
      {valeurs.map((valeur, indice) => (
        <span key={ACTIVITIES[indice]}>{fmt(valeur)}</span>
      ))}
    </div>
  );
}

function availabilityTone(valeur: number) {
  return valeur <= 0 ? "excelUnavailable" : valeur < 39 ? "excelTight" : "excelAvailable";
}

export function PlanningExcelGrid({
  snapshot,
  drafts: brouillons,
  savingKey,
  potentialCollapsed,
  potentialPreferenceSaving,
  onDraftChange,
  onDraftClear,
  onSaveFirm,
  onSaveProvision,
  onMoveFirm,
  onMoveProvision,
  onTogglePotential,
  onPasteBatch,
  onClipboardError,
}: Props) {
  const [selectionCourante, setSelection] = useState<{
    anchor: PlanningClipboardCell;
    end: PlanningClipboardCell;
  } | null>(null);

  function rowsForKind(kind: PlanningClipboardKind) {
    if (kind === "firm") {
      return snapshot.rows.map((ligneTableau) => ({
        id: ligneTableau.chantierId,
        activities: ligneTableau.activities,
      }));
    }
    return snapshot.provisionalRows.map((ligneTableau) => ({
      id: ligneTableau.caseId,
      activities: ligneTableau.activities,
    }));
  }

  const selectedKeys = new Set<string>();
  if (selectionCourante) {
    const lignesTableau = rowsForKind(selectionCourante.anchor.kind);
    const bounds = planningSelectionBounds(
      selectionCourante.anchor,
      selectionCourante.end,
      lignesTableau,
      snapshot.weeks,
    );
    if (bounds) {
      for (let r = bounds.top; r <= bounds.bottom; r++) {
        for (let c = bounds.left; c <= bounds.right; c++) {
          const semaine = snapshot.weeks[Math.floor(c / 3)];
          const activity = ACTIVITIES[c % 3];
          selectedKeys.add(
            [selectionCourante.anchor.kind, lignesTableau[r].id, activity, semaine].join(":"),
          );
        }
      }
    }
  }

  function handleCopy(evenement: ClipboardEvent<HTMLTableElement>) {
    if (!(evenement.target instanceof HTMLInputElement) || !selectionCourante) return;
    try {
      const valeur = formatPlanningSelection(
        selectionCourante.anchor,
        selectionCourante.end,
        rowsForKind(selectionCourante.anchor.kind),
        snapshot.weeks,
        brouillons,
      );
      evenement.clipboardData.setData("text/plain", valeur);
      evenement.preventDefault();
    } catch (erreur) {
      evenement.preventDefault();
      onClipboardError(erreur instanceof Error ? erreur.message : "Copie impossible.");
    }
  }

  function handlePaste(evenement: ClipboardEvent<HTMLTableElement>) {
    if (!(evenement.target instanceof HTMLInputElement) || !selectionCourante) return;
    evenement.preventDefault();
    if (!snapshot.capabilities.canEditMacro || savingKey !== null) {
      onClipboardError("Le planning est en lecture seule ou en cours d'enregistrement.");
      return;
    }
    try {
      const pastWeeks = new Set(
        weekMeta.filter((element) => element.isPast).map((element) => element.week),
      );
      const updates = planPlanningPaste(
        evenement.clipboardData.getData("text/plain"),
        selectionCourante.anchor,
        selectionCourante.end,
        rowsForKind(selectionCourante.anchor.kind),
        snapshot.weeks,
        (semaine) => pastWeeks.has(semaine),
      );
      void onPasteBatch(updates);
    } catch (erreur) {
      onClipboardError(erreur instanceof Error ? erreur.message : "Collage impossible.");
    }
  }

  const weekMeta = buildGrandPlanningWeekMeta(snapshot.weeks);
  const monthGroups = groupGrandPlanningMonths(weekMeta);
  const capacityByWeek = new Map(
    snapshot.weeklyCapacity.map((capacity) => [capacity.week, capacity]),
  );
  const metaByWeek = new Map(weekMeta.map((meta) => [meta.week, meta]));

  const summaryRows: { label: string; field: keyof Omit<WeekCapacity, "week">; tone?: boolean }[] =
    [
      { label: "Disponible ferme", field: "firmAvailableHours", tone: true },
      { label: "Disponible avec potentiel", field: "availableWithProvisionHours", tone: true },
    ];

  // Totaux de charge ferme par activité, sans additionner une seconde fois le provisionnel.
  const totalFor = (
    activity: PlanningActivity,
    field: "plannedHours" | "actualHours" | "remainingHours",
  ) =>
    snapshot.rows.reduce(
      (somme, chantier) =>
        somme +
        (chantier.activities.find((element) => element.activity === activity)?.[field] ?? 0),
      0,
    );

  const weeklyTotalFor = (activity: PlanningActivity, semaine: string) =>
    snapshot.rows.reduce(
      (somme, chantier) =>
        somme +
        (chantier.activities.find((element) => element.activity === activity)?.weeklyHours[
          semaine
        ] ?? 0),
      0,
    );

  function weekClass(semaine: string) {
    const meta = metaByWeek.get(semaine);
    return [
      meta?.startsMonth ? "excelMonthStart" : "",
      meta?.isCurrent ? "excelCurrentWeek" : "",
      meta?.isPast ? "excelPastWeek" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function hoursInput(
    kind: "firm" | "provisional",
    id: string,
    nom: string,
    activity: PlanningActivity,
    semaine: string,
    displayedHours: number,
  ) {
    const cle = [kind, id, activity, semaine].join(":");
    const readOnly =
      !snapshot.capabilities.canEditMacro ||
      Boolean(metaByWeek.get(semaine)?.isPast) ||
      savingKey === cle ||
      savingKey === "planning-mutation";
    return (
      <input
        key={activity}
        aria-label={[nom, kind === "provisional" ? "provisionnel" : "", activity, semaine]
          .filter(Boolean)
          .join(" ")}
        className={[savingKey === cle ? "isSaving" : "", selectedKeys.has(cle) ? "isSelected" : ""]
          .filter(Boolean)
          .join(" ")}
        readOnly={readOnly}
        onFocus={() =>
          setSelection({
            anchor: { kind, id, activity, week: semaine },
            end: { kind, id, activity, week: semaine },
          })
        }
        onMouseDown={(evenement) => {
          if (!evenement.shiftKey || !selectionCourante || selectionCourante.anchor.kind !== kind)
            return;
          evenement.preventDefault();
          setSelection((courant) =>
            courant
              ? { anchor: courant.anchor, end: { kind, id, activity, week: semaine } }
              : courant,
          );
        }}
        inputMode="decimal"
        title={[nom, activity, semaine].join(" · ")}
        value={brouillons[cle] ?? (displayedHours === 0 ? "" : fmt(displayedHours))}
        onChange={(evenement) => onDraftChange(cle, evenement.target.value)}
        onBlur={() =>
          void (kind === "firm"
            ? onSaveFirm(id, activity, semaine, displayedHours)
            : onSaveProvision(id, activity, semaine, displayedHours))
        }
        onKeyDown={(evenement) => {
          if (evenement.key === "Enter") evenement.currentTarget.blur();
          if (evenement.key === "Escape") {
            onDraftClear(cle);
            evenement.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <table
      className="excelPlanningTable"
      onCopy={handleCopy}
      onPaste={handlePaste}
      aria-label="Grand planning hebdomadaire par chantier, étude, fabrication et pose"
    >
      <thead>
        <tr className="excelMonthRow">
          <th className="excelFixed excelFixedName" rowSpan={2}>
            Chantier
          </th>
          <th className="excelFixed excelFixedPlan" rowSpan={2}>
            Heures prévues <small>Ét · Fa · Po</small>
          </th>
          <th className="excelFixed excelFixedActual" rowSpan={2}>
            Heures passées <small>Ét · Fa · Po</small>
          </th>
          <th className="excelFixed excelFixedRemaining" rowSpan={2}>
            À répartir <small>Ét · Fa · Po</small>
          </th>
          {monthGroups.map((mois) => (
            <th key={mois.key} colSpan={mois.span} className="excelMonthHeading">
              {mois.label} {mois.year}
            </th>
          ))}
        </tr>
        <tr className="excelWeekRow">
          {weekMeta.map((meta) => (
            <th
              key={meta.week}
              className={["excelWeekHeading", weekClass(meta.week)].join(" ")}
              data-planning-week={meta.week}
              title={meta.dateRangeLabel}
            >
              <strong>{"S" + meta.week.slice(-2)}</strong>
              <div className="excelTriple excelWeekActivityLabels">
                {ACTIVITY_LABELS.map((libelle) => (
                  <span key={libelle}>{libelle}</span>
                ))}
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {summaryRows.map((summary) => (
          <tr key={summary.field} className="excelSummaryRow">
            <th scope="row" className="excelFixed excelFixedName">
              {summary.label}
            </th>
            <td className="excelSummarySpacer" colSpan={3}></td>
            {snapshot.weeks.map((semaine) => {
              const valeur = capacityByWeek.get(semaine)?.[summary.field] ?? 0;
              return (
                <td
                  key={semaine}
                  className={[
                    "excelSummaryCell",
                    weekClass(semaine),
                    summary.tone ? availabilityTone(valeur) : "",
                  ].join(" ")}
                  title={[summary.label, semaine, fmt(valeur) + " h"].join(" · ")}
                >
                  {fmt(valeur)}
                </td>
              );
            })}
          </tr>
        ))}
        <tr className="excelActivityTotalRow">
          <th scope="row" className="excelFixed excelFixedName">
            TOTAL CHANTIERS
          </th>
          <td className="excelFixed excelFixedPlan excelMetricCell">
            {tripleValues(ACTIVITIES.map((activity) => totalFor(activity, "plannedHours")))}
          </td>
          <td className="excelFixed excelFixedActual excelMetricCell">
            {tripleValues(ACTIVITIES.map((activity) => totalFor(activity, "actualHours")))}
          </td>
          <td className="excelFixed excelFixedRemaining excelMetricCell">
            {tripleValues(ACTIVITIES.map((activity) => totalFor(activity, "remainingHours")))}
          </td>
          {snapshot.weeks.map((semaine) => (
            <td
              key={semaine}
              className={["excelWeekCell", "excelActivityTotalCell", weekClass(semaine)].join(" ")}
            >
              {tripleValues(ACTIVITIES.map((activity) => weeklyTotalFor(activity, semaine)))}
            </td>
          ))}
        </tr>
        {snapshot.rows.length === 0 && snapshot.provisionalRows.length === 0 ? (
          <tr>
            <td className="excelEmpty" colSpan={snapshot.weeks.length + 4}>
              Aucun chantier ni provision à planifier.
            </td>
          </tr>
        ) : null}
        {snapshot.rows.map((chantier, chantierIndex) => (
          <tr key={chantier.chantierId} className="excelChantierRow">
            <th scope="row" className="excelFixed excelFixedName excelChantierName">
              <div className="excelChantierTitle">
                <strong>{chantier.name}</strong>
                <span className="excelRowControls">
                  <button
                    type="button"
                    aria-label={"Monter " + chantier.name}
                    disabled={
                      !snapshot.capabilities.canEditMacro ||
                      savingKey === "planning-mutation" ||
                      chantierIndex === 0
                    }
                    onClick={() => void onMoveFirm(chantier.chantierId, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={"Descendre " + chantier.name}
                    disabled={
                      !snapshot.capabilities.canEditMacro ||
                      savingKey === "planning-mutation" ||
                      chantierIndex === snapshot.rows.length - 1
                    }
                    onClick={() => void onMoveFirm(chantier.chantierId, 1)}
                  >
                    ↓
                  </button>
                </span>
              </div>
              {chantier.reference ? <small>{chantier.reference}</small> : null}
              <small>Pose prévue {chantier.plannedInstallDate}</small>
            </th>
            <td className="excelFixed excelFixedPlan excelMetricCell">
              {tripleValues(chantier.activities.map((activity) => activity.plannedHours))}
            </td>
            <td className="excelFixed excelFixedActual excelMetricCell">
              {tripleValues(chantier.activities.map((activity) => activity.actualHours))}
            </td>
            <td className="excelFixed excelFixedRemaining excelMetricCell">
              {tripleValues(chantier.activities.map((activity) => activity.remainingHours))}
            </td>
            {snapshot.weeks.map((semaine) => (
              <td key={semaine} className={["excelWeekCell", weekClass(semaine)].join(" ")}>
                <div className="excelTriple">
                  {chantier.activities.map((activity) =>
                    hoursInput(
                      "firm",
                      chantier.chantierId,
                      chantier.name,
                      activity.activity,
                      semaine,
                      activity.weeklyHours[semaine] ?? 0,
                    ),
                  )}
                </div>
              </td>
            ))}
          </tr>
        ))}
        {snapshot.provisionalRows.length > 0 ? (
          <tr className="excelPotentialDivider">
            <th scope="rowgroup" colSpan={snapshot.weeks.length + 4}>
              <button
                type="button"
                aria-expanded={!potentialCollapsed}
                disabled={potentialPreferenceSaving}
                onClick={() => void onTogglePotential()}
              >
                <span>{potentialCollapsed ? "▶" : "▼"}</span>
                <strong>CHARGES PROVISIONNELLES</strong>
                <small>{snapshot.provisionalRows.length} affaire(s)</small>
              </button>
            </th>
          </tr>
        ) : null}
        {!potentialCollapsed &&
          snapshot.provisionalRows.map((element, itemIndex) => (
            <tr key={element.caseId} className="excelProvisionalRow">
              <th scope="row" className="excelFixed excelFixedName excelChantierName">
                <div className="excelChantierTitle">
                  <strong>{element.name}</strong>
                  <span className="excelRowControls">
                    <button
                      type="button"
                      aria-label={"Monter " + element.name}
                      disabled={
                        !snapshot.capabilities.canEditMacro ||
                        savingKey === "planning-mutation" ||
                        itemIndex === 0
                      }
                      onClick={() => void onMoveProvision(element.caseId, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={"Descendre " + element.name}
                      disabled={
                        !snapshot.capabilities.canEditMacro ||
                        savingKey === "planning-mutation" ||
                        itemIndex === snapshot.provisionalRows.length - 1
                      }
                      onClick={() => void onMoveProvision(element.caseId, 1)}
                    >
                      ↓
                    </button>
                  </span>
                </div>
                <small>{element.statusLabel}</small>
              </th>
              <td className="excelFixed excelFixedPlan excelMetricCell">
                {tripleValues(element.activities.map((activity) => activity.provisionHours))}
              </td>
              <td className="excelFixed excelFixedActual excelMetricCell">
                {tripleValues([0, 0, 0])}
              </td>
              <td className="excelFixed excelFixedRemaining excelMetricCell">
                {tripleValues(element.activities.map((activity) => activity.remainingHours))}
              </td>
              {snapshot.weeks.map((semaine) => (
                <td key={semaine} className={["excelWeekCell", weekClass(semaine)].join(" ")}>
                  <div className="excelTriple">
                    {element.activities.map((activity) =>
                      hoursInput(
                        "provisional",
                        element.caseId,
                        element.name,
                        activity.activity,
                        semaine,
                        activity.weeklyHours[semaine] ?? 0,
                      ),
                    )}
                  </div>
                </td>
              ))}
            </tr>
          ))}
      </tbody>
    </table>
  );
}

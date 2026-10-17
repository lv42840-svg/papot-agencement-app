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
  onDraftChange: (key: string, value: string) => void;
  onDraftClear: (key: string) => void;
  onSaveFirm: (
    chantierId: string,
    activity: PlanningActivity,
    week: string,
    value: number,
  ) => Promise<void>;
  onSaveProvision: (
    caseId: string,
    activity: PlanningActivity,
    week: string,
    value: number,
  ) => Promise<void>;
  onMoveFirm: (chantierId: string, direction: -1 | 1) => Promise<void>;
  onMoveProvision: (caseId: string, direction: -1 | 1) => Promise<void>;
  onTogglePotential: () => Promise<void>;
  onPasteBatch: (updates: PlanningClipboardUpdate[]) => Promise<void>;
  onClipboardError: (message: string) => void;
};

const ACTIVITIES: PlanningActivity[] = ["BE", "WORKSHOP", "INSTALL"];
const ACTIVITY_LABELS = ["Ét", "Fa", "Po"];

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function tripleValues(values: number[]) {
  return (
    <div className="excelTriple excelTripleValues">
      {values.map((value, index) => (
        <span key={ACTIVITIES[index]}>{fmt(value)}</span>
      ))}
    </div>
  );
}

function availabilityTone(value: number) {
  return value <= 0 ? "excelUnavailable" : value < 39 ? "excelTight" : "excelAvailable";
}

export function PlanningExcelGrid({
  snapshot,
  drafts,
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
  const [selection, setSelection] = useState<{
    anchor: PlanningClipboardCell;
    end: PlanningClipboardCell;
  } | null>(null);

  function rowsForKind(kind: PlanningClipboardKind) {
    if (kind === "firm") {
      return snapshot.rows.map((row) => ({ id: row.chantierId, activities: row.activities }));
    }
    return snapshot.provisionalRows.map((row) => ({ id: row.caseId, activities: row.activities }));
  }

  const selectedKeys = new Set<string>();
  if (selection) {
    const rows = rowsForKind(selection.anchor.kind);
    const bounds = planningSelectionBounds(selection.anchor, selection.end, rows, snapshot.weeks);
    if (bounds) {
      for (let r = bounds.top; r <= bounds.bottom; r++) {
        for (let c = bounds.left; c <= bounds.right; c++) {
          const week = snapshot.weeks[Math.floor(c / 3)];
          const activity = ACTIVITIES[c % 3];
          selectedKeys.add([selection.anchor.kind, rows[r].id, activity, week].join(":"));
        }
      }
    }
  }

  function handleCopy(event: ClipboardEvent<HTMLTableElement>) {
    if (!(event.target instanceof HTMLInputElement) || !selection) return;
    try {
      const value = formatPlanningSelection(
        selection.anchor,
        selection.end,
        rowsForKind(selection.anchor.kind),
        snapshot.weeks,
        drafts,
      );
      event.clipboardData.setData("text/plain", value);
      event.preventDefault();
    } catch (error) {
      event.preventDefault();
      onClipboardError(error instanceof Error ? error.message : "Copie impossible.");
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTableElement>) {
    if (!(event.target instanceof HTMLInputElement) || !selection) return;
    event.preventDefault();
    if (!snapshot.capabilities.canEditMacro || savingKey !== null) {
      onClipboardError("Le planning est en lecture seule ou en cours d'enregistrement.");
      return;
    }
    try {
      const pastWeeks = new Set(weekMeta.filter((item) => item.isPast).map((item) => item.week));
      const updates = planPlanningPaste(
        event.clipboardData.getData("text/plain"),
        selection.anchor,
        selection.end,
        rowsForKind(selection.anchor.kind),
        snapshot.weeks,
        (week) => pastWeeks.has(week),
      );
      void onPasteBatch(updates);
    } catch (error) {
      onClipboardError(error instanceof Error ? error.message : "Collage impossible.");
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
      (sum, chantier) =>
        sum + (chantier.activities.find((item) => item.activity === activity)?.[field] ?? 0),
      0,
    );

  const weeklyTotalFor = (activity: PlanningActivity, week: string) =>
    snapshot.rows.reduce(
      (sum, chantier) =>
        sum +
        (chantier.activities.find((item) => item.activity === activity)?.weeklyHours[week] ?? 0),
      0,
    );

  function weekClass(week: string) {
    const meta = metaByWeek.get(week);
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
    name: string,
    activity: PlanningActivity,
    week: string,
    displayedHours: number,
  ) {
    const key = [kind, id, activity, week].join(":");
    const readOnly =
      !snapshot.capabilities.canEditMacro ||
      Boolean(metaByWeek.get(week)?.isPast) ||
      savingKey === key ||
      savingKey === "planning-mutation";
    return (
      <input
        key={activity}
        aria-label={[name, kind === "provisional" ? "provisionnel" : "", activity, week]
          .filter(Boolean)
          .join(" ")}
        className={[savingKey === key ? "isSaving" : "", selectedKeys.has(key) ? "isSelected" : ""]
          .filter(Boolean)
          .join(" ")}
        readOnly={readOnly}
        onFocus={() =>
          setSelection({
            anchor: { kind, id, activity, week },
            end: { kind, id, activity, week },
          })
        }
        onMouseDown={(event) => {
          if (!event.shiftKey || !selection || selection.anchor.kind !== kind) return;
          event.preventDefault();
          setSelection((current) =>
            current ? { anchor: current.anchor, end: { kind, id, activity, week } } : current,
          );
        }}
        inputMode="decimal"
        title={[name, activity, week].join(" · ")}
        value={drafts[key] ?? (displayedHours === 0 ? "" : fmt(displayedHours))}
        onChange={(event) => onDraftChange(key, event.target.value)}
        onBlur={() =>
          void (kind === "firm"
            ? onSaveFirm(id, activity, week, displayedHours)
            : onSaveProvision(id, activity, week, displayedHours))
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            onDraftClear(key);
            event.currentTarget.blur();
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
          {monthGroups.map((month) => (
            <th key={month.key} colSpan={month.span} className="excelMonthHeading">
              {month.label} {month.year}
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
                {ACTIVITY_LABELS.map((label) => (
                  <span key={label}>{label}</span>
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
            {snapshot.weeks.map((week) => {
              const value = capacityByWeek.get(week)?.[summary.field] ?? 0;
              return (
                <td
                  key={week}
                  className={[
                    "excelSummaryCell",
                    weekClass(week),
                    summary.tone ? availabilityTone(value) : "",
                  ].join(" ")}
                  title={[summary.label, week, fmt(value) + " h"].join(" · ")}
                >
                  {fmt(value)}
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
          {snapshot.weeks.map((week) => (
            <td
              key={week}
              className={["excelWeekCell", "excelActivityTotalCell", weekClass(week)].join(" ")}
            >
              {tripleValues(ACTIVITIES.map((activity) => weeklyTotalFor(activity, week)))}
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
            {snapshot.weeks.map((week) => (
              <td key={week} className={["excelWeekCell", weekClass(week)].join(" ")}>
                <div className="excelTriple">
                  {chantier.activities.map((activity) =>
                    hoursInput(
                      "firm",
                      chantier.chantierId,
                      chantier.name,
                      activity.activity,
                      week,
                      activity.weeklyHours[week] ?? 0,
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
          snapshot.provisionalRows.map((item, itemIndex) => (
            <tr key={item.caseId} className="excelProvisionalRow">
              <th scope="row" className="excelFixed excelFixedName excelChantierName">
                <div className="excelChantierTitle">
                  <strong>{item.name}</strong>
                  <span className="excelRowControls">
                    <button
                      type="button"
                      aria-label={"Monter " + item.name}
                      disabled={
                        !snapshot.capabilities.canEditMacro ||
                        savingKey === "planning-mutation" ||
                        itemIndex === 0
                      }
                      onClick={() => void onMoveProvision(item.caseId, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={"Descendre " + item.name}
                      disabled={
                        !snapshot.capabilities.canEditMacro ||
                        savingKey === "planning-mutation" ||
                        itemIndex === snapshot.provisionalRows.length - 1
                      }
                      onClick={() => void onMoveProvision(item.caseId, 1)}
                    >
                      ↓
                    </button>
                  </span>
                </div>
                <small>{item.statusLabel}</small>
              </th>
              <td className="excelFixed excelFixedPlan excelMetricCell">
                {tripleValues(item.activities.map((activity) => activity.provisionHours))}
              </td>
              <td className="excelFixed excelFixedActual excelMetricCell">
                {tripleValues([0, 0, 0])}
              </td>
              <td className="excelFixed excelFixedRemaining excelMetricCell">
                {tripleValues(item.activities.map((activity) => activity.remainingHours))}
              </td>
              {snapshot.weeks.map((week) => (
                <td key={week} className={["excelWeekCell", weekClass(week)].join(" ")}>
                  <div className="excelTriple">
                    {item.activities.map((activity) =>
                      hoursInput(
                        "provisional",
                        item.caseId,
                        item.name,
                        activity.activity,
                        week,
                        activity.weeklyHours[week] ?? 0,
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

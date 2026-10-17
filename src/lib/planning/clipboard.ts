import type { PlanningActivity } from "./domain";

export type PlanningClipboardKind = "firm" | "provisional";
export type PlanningClipboardCell = {
  kind: PlanningClipboardKind;
  id: string;
  activity: PlanningActivity;
  week: string;
};
export type PlanningClipboardUpdate = PlanningClipboardCell & { hours: number };

export type PlanningClipboardRow = {
  id: string;
  activities: { activity: PlanningActivity; weeklyHours: Record<string, number> }[];
};

export const PLANNING_CLIPBOARD_ACTIVITIES: PlanningActivity[] = ["BE", "WORKSHOP", "INSTALL"];
export const PLANNING_MAX_PASTE_CELLS = 200;

function cellColumn(cell: PlanningClipboardCell, weeks: string[]) {
  const weekIndex = weeks.indexOf(cell.week);
  const activityIndex = PLANNING_CLIPBOARD_ACTIVITIES.indexOf(cell.activity);
  return weekIndex < 0 || activityIndex < 0 ? -1 : weekIndex * 3 + activityIndex;
}

export function planningSelectionBounds(
  anchor: PlanningClipboardCell,
  end: PlanningClipboardCell,
  rows: PlanningClipboardRow[],
  weeks: string[],
): { top: number; bottom: number; left: number; right: number } | null {
  if (anchor.kind !== end.kind) return null;
  const aRow = rows.findIndex((row) => row.id === anchor.id);
  const bRow = rows.findIndex((row) => row.id === end.id);
  const aCol = cellColumn(anchor, weeks);
  const bCol = cellColumn(end, weeks);
  if (aRow < 0 || bRow < 0 || aCol < 0 || bCol < 0) return null;
  return {
    top: Math.min(aRow, bRow),
    bottom: Math.max(aRow, bRow),
    left: Math.min(aCol, bCol),
    right: Math.max(aCol, bCol),
  };
}

function valueForCell(row: PlanningClipboardRow, week: string, activity: PlanningActivity) {
  return row.activities.find((item) => item.activity === activity)?.weeklyHours[week] ?? 0;
}

function displayHours(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

export function formatPlanningSelection(
  anchor: PlanningClipboardCell,
  end: PlanningClipboardCell,
  rows: PlanningClipboardRow[],
  weeks: string[],
  drafts: Record<string, string>,
): string {
  const rect = planningSelectionBounds(anchor, end, rows, weeks);
  if (!rect) throw new Error("Sélection introuvable dans le planning.");
  const lines: string[] = [];
  for (let row = rect.top; row <= rect.bottom; row++) {
    const entries: string[] = [];
    for (let col = rect.left; col <= rect.right; col++) {
      const week = weeks[Math.floor(col / 3)];
      const activity = PLANNING_CLIPBOARD_ACTIVITIES[col % 3];
      const item = rows[row];
      entries.push(
        drafts[[anchor.kind, item.id, activity, week].join(":")] ??
          displayHours(valueForCell(item, week, activity)),
      );
    }
    lines.push(entries.join("\t"));
  }
  return lines.join("\n");
}

export function planPlanningPaste(
  text: string,
  anchor: PlanningClipboardCell,
  end: PlanningClipboardCell,
  rows: PlanningClipboardRow[],
  weeks: string[],
  isPast: (week: string) => boolean,
): PlanningClipboardUpdate[] {
  const rect = planningSelectionBounds(anchor, end, rows, weeks);
  if (!rect) throw new Error("Sélection introuvable dans le planning.");
  const matrix = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((line) => line.split("\t"));
  const height = matrix.length === 1 && matrix[0].length === 1 ? rect.bottom - rect.top + 1 : matrix.length;
  const width = matrix.length === 1 && matrix[0].length === 1 ? rect.right - rect.left + 1 : matrix[0].length;
  if (
    height < 1 ||
    width < 1 ||
    height * width > PLANNING_MAX_PASTE_CELLS ||
    rect.top + height > rows.length ||
    rect.left + width > weeks.length * 3 ||
    matrix.some((line) => line.length !== matrix[0].length)
  ) {
    throw new Error("Bloc trop grand ou irrégulier : aucune heure n’a été modifiée.");
  }

  const updates: PlanningClipboardUpdate[] = [];
  for (let rowIndex = 0; rowIndex < height; rowIndex++) {
    for (let colIndex = 0; colIndex < width; colIndex++) {
      const week = weeks[Math.floor((rect.left + colIndex) / 3)];
      if (isPast(week)) {
        throw new Error("Impossible de coller sur une semaine passée : aucune heure n’a été modifiée.");
      }
      const raw = matrix.length === 1 && matrix[0].length === 1
        ? matrix[0][0]
        : matrix[rowIndex][colIndex];
      const normalized = raw.trim().replace(",", ".");
      const hours = normalized === "" ? 0 : Number(normalized);
      if (!Number.isFinite(hours) || hours < 0 || hours > 10000) {
        throw new Error("Nombre d’heures invalide : aucune heure n’a été modifiée.");
      }
      updates.push({
        kind: anchor.kind,
        id: rows[rect.top + rowIndex].id,
        week,
        activity: PLANNING_CLIPBOARD_ACTIVITIES[(rect.left + colIndex) % 3],
        hours,
      });
    }
  }
  return updates;
}

import type { PlanningPayload } from "./domain";
import { isoWeekMonday } from "./time-markers";

/** Suggest only known chantiers assigned to each worker during this ISO week.
 * A free-text label resolves to a chantier only when the name is unambiguous.
 * No chantier is created and no hours are changed.
 */
export function scheduledChantiersByPerson(
  assignments: PlanningPayload["dailyAssignments"],
  week: string,
  chantiers: readonly { id: string; name: string }[],
): Record<string, string[]> {
  const monday = isoWeekMonday(week);
  const start = monday.toISOString().slice(0, 10);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  const end = sunday.toISOString().slice(0, 10);
  const validIds = new Set(chantiers.map((chantier) => chantier.id));
  const idsByName = new Map<string, string[]>();
  for (const chantier of chantiers) {
    const name = chantier.name.trim().toLocaleLowerCase("fr-FR");
    idsByName.set(name, [...(idsByName.get(name) ?? []), chantier.id]);
  }
  const byPerson = new Map<string, Set<string>>();
  for (const entry of assignments) {
    if (entry.date < start || entry.date > end) continue;
    const matches = idsByName.get(entry.label.trim().toLocaleLowerCase("fr-FR")) ?? [];
    const chantierId =
      entry.chantierId && validIds.has(entry.chantierId)
        ? entry.chantierId
        : matches.length === 1
          ? matches[0]
          : null;
    if (!chantierId) continue;
    const ids = byPerson.get(entry.userId) ?? new Set<string>();
    ids.add(chantierId);
    byPerson.set(entry.userId, ids);
  }
  return Object.fromEntries([...byPerson].map(([userId, ids]) => [userId, [...ids]]));
}

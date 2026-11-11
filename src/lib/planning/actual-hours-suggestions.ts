import type { PlanningPayload } from "./domain";
import { isoWeekMonday } from "./time-markers";

/** Suggest only known chantiers assigned to each worker during this ISO week.
 * A free-text label resolves to a chantier only when the name is unambiguous.
 * No chantier is created and no hours are changed.
 */
export function scheduledChantiersByPerson(
  affectations: PlanningPayload["dailyAssignments"],
  semaine: string,
  chantiers: readonly { id: string; name: string }[],
): Record<string, string[]> {
  const lundi = isoWeekMonday(semaine);
  const debut = lundi.toISOString().slice(0, 10);
  const dimanche = new Date(lundi);
  dimanche.setUTCDate(dimanche.getUTCDate() + 6);
  const fin = dimanche.toISOString().slice(0, 10);
  const identifiantsValides = new Set(chantiers.map((chantier) => chantier.id));
  const identifiantsParNom = new Map<string, string[]>();
  for (const chantier of chantiers) {
    const nom = chantier.name.trim().toLocaleLowerCase("fr-FR");
    identifiantsParNom.set(nom, [...(identifiantsParNom.get(nom) ?? []), chantier.id]);
  }
  const chantiersParPersonne = new Map<string, Set<string>>();
  for (const affectation of affectations) {
    if (affectation.date < debut || affectation.date > fin) continue;
    const correspondances =
      identifiantsParNom.get(affectation.label.trim().toLocaleLowerCase("fr-FR")) ?? [];
    const idChantier =
      affectation.chantierId && identifiantsValides.has(affectation.chantierId)
        ? affectation.chantierId
        : correspondances.length === 1
          ? correspondances[0]
          : null;
    if (!idChantier) continue;
    const identifiants = chantiersParPersonne.get(affectation.userId) ?? new Set<string>();
    identifiants.add(idChantier);
    chantiersParPersonne.set(affectation.userId, identifiants);
  }
  return Object.fromEntries(
    [...chantiersParPersonne].map(([idUtilisateur, identifiants]) => [
      idUtilisateur,
      [...identifiants],
    ]),
  );
}

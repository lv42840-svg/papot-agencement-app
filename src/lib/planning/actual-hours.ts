import { z } from "zod";
import { isoWeekDates } from "./capacity";
import {
  actualHoursKey,
  indirectHoursCategorySchema,
  parsePlanningPayload,
  type PlanningPayload,
} from "./domain";
import { isoWeekKey } from "./time-markers";

const weekSchema = z
  .string()
  .regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/, "PLANNING_WEEK_INVALID")
  .refine((semaine) => {
    try {
      const lundi = isoWeekDates(semaine)[0];
      return (
        isoWeekKey(
          new Date(lundi.getUTCFullYear(), lundi.getUTCMonth(), lundi.getUTCDate(), 12),
        ) === semaine
      );
    } catch {
      return false;
    }
  }, "PLANNING_WEEK_INVALID");

export const actualHoursWeekSchema = weekSchema;

export const actualHoursRowSchema = z
  .object({
    action: z.literal("saveActualHoursRow"),
    chantierId: z.string().uuid(),
    userId: z.string().uuid(),
    week: weekSchema,
    be: z.number().finite().nonnegative().max(168),
    workshop: z.number().finite().nonnegative().max(168),
    install: z.number().finite().nonnegative().max(168),
  })
  .superRefine((saisie, contexte) => {
    if (saisie.be + saisie.workshop + saisie.install > 168) {
      contexte.addIssue({
        code: "custom",
        path: ["hours"],
        message: "PLANNING_ACTUAL_WEEK_TOTAL_INVALID",
      });
    }
  });

export type ActualHoursRowInput = z.infer<typeof actualHoursRowSchema>;

export const indirectHoursRowSchema = z.object({
  action: z.literal("saveIndirectHoursRow"),
  userId: z.string().uuid(),
  week: weekSchema,
  category: indirectHoursCategorySchema,
  hours: z.number().finite().nonnegative().max(168),
});

export type IndirectHoursRowInput = z.infer<typeof indirectHoursRowSchema>;

export function assertCombinedPersonWeekLimit(
  donnees: PlanningPayload,
  idUtilisateur: string,
  semaine: string,
): void {
  const direct = donnees.actualHours
    .filter((ligne) => ligne.userId === idUtilisateur && ligne.week === semaine)
    .reduce((somme, ligne) => somme + ligne.hours, 0);
  const indirect = donnees.indirectHours
    .filter((ligne) => ligne.userId === idUtilisateur && ligne.week === semaine)
    .reduce((somme, ligne) => somme + ligne.hours, 0);
  if (direct + indirect > 168) throw new Error("PLANNING_ACTUAL_PERSON_WEEK_TOO_HIGH");
}

/** SAV and general expenses have no chantier reference, now or later. */
export function applyIndirectHoursRow(
  source: PlanningPayload,
  saisie: IndirectHoursRowInput,
  identifiantsPersonnesConnues: ReadonlySet<string>,
): PlanningPayload {
  indirectHoursRowSchema.parse(saisie);
  if (!identifiantsPersonnesConnues.has(saisie.userId)) {
    throw new Error("PLANNING_PERSON_NOT_FOUND");
  }
  const donnees = structuredClone(parsePlanningPayload(source));
  donnees.indirectHours = donnees.indirectHours.filter(
    (ligne) =>
      ligne.userId !== saisie.userId ||
      ligne.week !== saisie.week ||
      ligne.category !== saisie.category,
  );
  if (saisie.hours > 0) {
    donnees.indirectHours.push({
      userId: saisie.userId,
      week: saisie.week,
      category: saisie.category,
      hours: saisie.hours,
    });
  }
  assertCombinedPersonWeekLimit(donnees, saisie.userId, saisie.week);
  return parsePlanningPayload(donnees);
}

export function actualHoursByActivity(
  entrees: readonly { activity: "BE" | "WORKSHOP" | "INSTALL"; hours: number }[],
) {
  const totaux = { be: 0, workshop: 0, install: 0 };
  for (const entree of entrees) {
    if (entree.activity === "BE") totaux.be += entree.hours;
    if (entree.activity === "WORKSHOP") totaux.workshop += entree.hours;
    if (entree.activity === "INSTALL") totaux.install += entree.hours;
  }
  return totaux;
}

export function applyActualHoursRow(
  source: PlanningPayload,
  saisie: ActualHoursRowInput,
  identifiantsChantiersConnus: ReadonlySet<string>,
  identifiantsPersonnesConnues: ReadonlySet<string>,
): PlanningPayload {
  actualHoursRowSchema.parse(saisie);
  if (!identifiantsChantiersConnus.has(saisie.chantierId)) {
    throw new Error("PLANNING_CHANTIER_NOT_FOUND");
  }
  if (!identifiantsPersonnesConnues.has(saisie.userId)) {
    throw new Error("PLANNING_PERSON_NOT_FOUND");
  }
  const donnees = structuredClone(parsePlanningPayload(source));
  const activites = [
    ["BE", saisie.be],
    ["WORKSHOP", saisie.workshop],
    ["INSTALL", saisie.install],
  ] as const;
  for (const [activite, heures] of activites) {
    const cle = actualHoursKey(saisie.chantierId, saisie.userId, activite, saisie.week);
    const indice = donnees.actualHours.findIndex(
      (entree) =>
        actualHoursKey(entree.chantierId, entree.userId, entree.activity, entree.week) === cle,
    );
    if (heures === 0) {
      if (indice >= 0) donnees.actualHours.splice(indice, 1);
    } else {
      const nouvelleEntree = {
        chantierId: saisie.chantierId,
        userId: saisie.userId,
        activity: activite,
        week: saisie.week,
        hours: heures,
      };
      if (indice >= 0) donnees.actualHours[indice] = nouvelleEntree;
      else donnees.actualHours.push(nouvelleEntree);
    }
  }
  assertCombinedPersonWeekLimit(donnees, saisie.userId, saisie.week);
  return parsePlanningPayload(donnees);
}

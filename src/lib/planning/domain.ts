import { editHistorySchema } from "../edit-history";
import { z } from "zod";
import {
  COMMERCIAL_STATUS_LABELS,
  isCommercialActive,
  type CommercialPayload,
  type CommercialStatus,
} from "../commercial/domain";
import type { ChantierRecord, ChantiersPayload } from "@/lib/chantiers/domain";
import { effectiveCommercialForecastHours } from "../commercial/forecast-quotes";
import type { NativeQuoteRecord } from "../quotes/store";
import { planningPersonCapacitySchema } from "./capacity";

export const planningActivitySchema = z.enum(["BE", "WORKSHOP", "INSTALL"]);
export type PlanningActivity = z.infer<typeof planningActivitySchema>;

export const PLANNING_ACTIVITY_LABELS: Record<PlanningActivity, string> = {
  BE: "BE",
  WORKSHOP: "Atelier",
  INSTALL: "Pose",
};

const isoWeekSchema = z
  .string()
  .regex(/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/, "PLANNING_WEEK_INVALID");

export const planningMacroAllocationSchema = z.object({
  chantierId: z.string().uuid(),
  activity: planningActivitySchema,
  week: isoWeekSchema,
  hours: z.number().finite().nonnegative(),
});

export const planningProvisionalAllocationSchema = z.object({
  caseId: z.string().uuid(),
  activity: planningActivitySchema,
  week: isoWeekSchema,
  hours: z.number().finite().nonnegative(),
});

// Day-by-day team board is distinct from sold/allocated weekly activity hours.
// A blank assignment is represented by no record.
export const planningDailyActivitySchema = z.enum(["BE", "WORKSHOP", "INSTALL", "NOTE"]);
export type PlanningDailyActivity = z.infer<typeof planningDailyActivitySchema>;

export const planningDailyAssignmentSchema = z.object({
  // Old saved lines have no id or activity. They remain readable and editable.
  id: z.string().uuid().optional(),
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "PLANNING_DAY_INVALID"),
  chantierId: z.string().uuid().nullable(),
  activity: planningDailyActivitySchema.default("NOTE"),
  label: z.string().trim().min(1).max(160),
});
export type PlanningDailyAssignment = z.infer<typeof planningDailyAssignmentSchema>;

export const planningActualHoursSchema = z.object({
  chantierId: z.string().uuid(),
  userId: z.string().uuid(),
  activity: planningActivitySchema,
  week: isoWeekSchema,
  hours: z.number().finite().nonnegative(),
});

/** Actual worked hours that do not belong to any chantier. */
export const indirectHoursCategorySchema = z.enum(["SAV", "GENERAL"]);
export type IndirectHoursCategory = z.infer<typeof indirectHoursCategorySchema>;
export const planningIndirectHoursSchema = z.object({
  userId: z.string().uuid(),
  category: indirectHoursCategorySchema,
  week: isoWeekSchema,
  hours: z.number().finite().positive().max(168),
});
export type PlanningIndirectHours = z.infer<typeof planningIndirectHoursSchema>;

export const planningAbsenceTypeSchema = z.enum(["VACATION", "SICK", "OTHER"]);
export type PlanningAbsenceType = z.infer<typeof planningAbsenceTypeSchema>;

export const planningAbsenceSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: planningAbsenceTypeSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "PLANNING_ABSENCE_DATE_INVALID"),
  hours: z.number().finite().positive().max(24),
  weekGroupId: z.string().uuid().optional(),
});
export type PlanningAbsence = z.infer<typeof planningAbsenceSchema>;

export const PLANNING_ABSENCE_TYPE_LABELS: Record<PlanningAbsenceType, string> = {
  VACATION: "Congés",
  SICK: "Arrêt",
  OTHER: "Autre",
};

export const planningStaffSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  linkedUserId: z.string().uuid().nullable(),
  // End date is inclusive: a future date can be added later during notice.
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  // Deactivation takes effect on this date, without erasing past weeks.
  inactiveSince: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});

export type PlanningStaff = z.infer<typeof planningStaffSchema>;

export const planningPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    payrollWeekConfirmations: z.record(z.string()).optional(),
    editRevisions: z.record(z.number().int().nonnegative()).optional(),
    editHistory: z.array(editHistorySchema).optional(),
    macroAllocations: z.array(planningMacroAllocationSchema),
    provisionalAllocations: z.array(planningProvisionalAllocationSchema).default([]),
    actualHours: z.array(planningActualHoursSchema).default([]),
    indirectHours: z.array(planningIndirectHoursSchema).default([]),
    chantierOrder: z.array(z.string().uuid()),
    provisionalOrder: z.array(z.string().uuid()).default([]),
    peopleCapacity: z.array(planningPersonCapacitySchema).default([]),
    dailyAssignments: z.array(planningDailyAssignmentSchema).default([]),
    staff: z.array(planningStaffSchema).default([]),
    hiddenPersonIds: z.array(z.string().uuid()).default([]),
    absences: z.array(planningAbsenceSchema).default([]),
  })
  .superRefine((valeur, contexte) => {
    const seen = new Set<string>();
    valeur.macroAllocations.forEach((allocation, indice) => {
      const cle = allocationKey(allocation.chantierId, allocation.activity, allocation.week);
      if (seen.has(cle)) {
        contexte.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["macroAllocations", indice],
          message: "PLANNING_ALLOCATION_DUPLICATE",
        });
      }
      seen.add(cle);
    });

    const provisionalSeen = new Set<string>();
    valeur.provisionalAllocations.forEach((allocation, indice) => {
      const cle = provisionalAllocationKey(allocation.caseId, allocation.activity, allocation.week);
      if (provisionalSeen.has(cle)) {
        contexte.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["provisionalAllocations", indice],
          message: "PLANNING_PROVISIONAL_ALLOCATION_DUPLICATE",
        });
      }
      provisionalSeen.add(cle);
    });

    const actualHoursSeen = new Set<string>();
    valeur.actualHours.forEach((entree, indice) => {
      const cle = actualHoursKey(entree.chantierId, entree.userId, entree.activity, entree.week);
      if (actualHoursSeen.has(cle)) {
        contexte.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actualHours", indice],
          message: "PLANNING_ACTUAL_HOURS_DUPLICATE",
        });
      }
      actualHoursSeen.add(cle);
    });

    const indirectSeen = new Set<string>();
    valeur.indirectHours.forEach((entree, indice) => {
      const cle = `${entree.userId}:${entree.category}:${entree.week}`;
      if (indirectSeen.has(cle)) {
        contexte.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["indirectHours", indice],
          message: "PLANNING_INDIRECT_HOURS_DUPLICATE",
        });
      }
      indirectSeen.add(cle);
    });

    const staffIds = new Set<string>();
    const linkedUsers = new Set<string>();
    valeur.staff.forEach((personne, indice) => {
      if (staffIds.has(personne.id)) {
        contexte.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["staff", indice, "id"],
          message: "PLANNING_STAFF_DUPLICATE",
        });
      }
      staffIds.add(personne.id);
      if (personne.linkedUserId) {
        if (linkedUsers.has(personne.linkedUserId)) {
          contexte.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["staff", indice, "linkedUserId"],
            message: "PLANNING_STAFF_ACCOUNT_ALREADY_LINKED",
          });
        }
        linkedUsers.add(personne.linkedUserId);
      }
    });

    const dailyIds = new Set<string>();
    const legacyDayKeys = new Set<string>();
    valeur.dailyAssignments.forEach((assignment, indice) => {
      if (assignment.id) {
        if (dailyIds.has(assignment.id)) {
          contexte.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["dailyAssignments", indice, "id"],
            message: "PLANNING_DAILY_DUPLICATE",
          });
        }
        dailyIds.add(assignment.id);
      } else {
        const cle = `${assignment.userId}:${assignment.date}`;
        if (legacyDayKeys.has(cle)) {
          contexte.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["dailyAssignments", indice],
            message: "PLANNING_DAILY_DUPLICATE",
          });
        }
        legacyDayKeys.add(cle);
      }
    });

    const absenceKeys = new Set<string>();
    valeur.absences.forEach((absence, indice) => {
      const cle = `${absence.userId}:${absence.date}`;
      if (absenceKeys.has(cle)) {
        contexte.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["absences", indice],
          message: "PLANNING_ABSENCE_DUPLICATE_DATE",
        });
      }
      absenceKeys.add(cle);
    });

    if (new Set(valeur.chantierOrder).size !== valeur.chantierOrder.length) {
      contexte.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chantierOrder"],
        message: "PLANNING_CHANTIER_ORDER_DUPLICATE",
      });
    }

    if (new Set(valeur.provisionalOrder).size !== valeur.provisionalOrder.length) {
      contexte.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provisionalOrder"],
        message: "PLANNING_PROVISIONAL_ORDER_DUPLICATE",
      });
    }
  });

export type PlanningMacroAllocation = z.infer<typeof planningMacroAllocationSchema>;
export type PlanningProvisionalAllocation = z.infer<typeof planningProvisionalAllocationSchema>;
export type PlanningActualHours = z.infer<typeof planningActualHoursSchema>;
export type PlanningPayload = z.infer<typeof planningPayloadSchema>;

export type GrandPlanningActivityRow = {
  activity: PlanningActivity;
  label: string;
  plannedHours: number;
  actualHours: number;
  allocatedHours: number;
  remainingHours: number;
  weeklyHours: Record<string, number>;
};

export type GrandPlanningChantierRow = {
  chantierId: string;
  name: string;
  reference: string | null;
  plannedInstallDate: string;
  activities: GrandPlanningActivityRow[];
};

export type GrandPlanningProvisionActivityRow = {
  activity: PlanningActivity;
  label: string;
  provisionHours: number;
  allocatedHours: number;
  remainingHours: number;
  weeklyHours: Record<string, number>;
};

export type GrandPlanningProvisionRow = {
  caseId: string;
  name: string;
  status: CommercialStatus;
  statusLabel: string;
  expectedConfirmationDate: string | null;
  activities: GrandPlanningProvisionActivityRow[];
};

export type ChantierPlanningCloseWarning = {
  futureAllocatedHours: number;
  remainingToAllocateHours: number;
  hasRemainingCharge: boolean;
};

export function createInitialPlanningPayload(): PlanningPayload {
  return {
    schemaVersion: 1,
    macroAllocations: [],
    provisionalAllocations: [],
    actualHours: [],
    indirectHours: [],
    chantierOrder: [],
    provisionalOrder: [],
    peopleCapacity: [],
    dailyAssignments: [],
    staff: [],
    hiddenPersonIds: [],
    absences: [],
  };
}

export function parsePlanningPayload(valeur: unknown): PlanningPayload {
  if (valeur == null) return createInitialPlanningPayload();
  return planningPayloadSchema.parse(valeur);
}

export function allocationKey(
  chantierId: string,
  activity: PlanningActivity,
  semaine: string,
): string {
  return `${chantierId}:${activity}:${semaine}`;
}

export function provisionalAllocationKey(
  idAffaire: string,
  activity: PlanningActivity,
  semaine: string,
): string {
  return `${idAffaire}:${activity}:${semaine}`;
}

export function actualHoursKey(
  chantierId: string,
  idUtilisateur: string,
  activity: PlanningActivity,
  semaine: string,
): string {
  return `${chantierId}:${idUtilisateur}:${activity}:${semaine}`;
}

export function plannedHoursForActivity(
  chantier: Pick<ChantierRecord, "plannedHours">,
  activity: PlanningActivity,
): number {
  if (activity === "BE") return chantier.plannedHours.be;
  if (activity === "WORKSHOP") return chantier.plannedHours.workshop;
  return chantier.plannedHours.install;
}

export function weeksInIsoYear(annee: number): number {
  const date = new Date(Date.UTC(annee, 11, 28));
  const jour = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - jour);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export function isoWeekIdForDate(saisie: Date): string {
  const date = new Date(
    Date.UTC(saisie.getUTCFullYear(), saisie.getUTCMonth(), saisie.getUTCDate()),
  );
  const jour = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - jour);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const semaine = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(semaine).padStart(2, "0")}`;
}

export function buildChantierPlanningCloseWarning(
  chantier: Pick<ChantierRecord, "id" | "plannedHours">,
  planningPayload: PlanningPayload,
  maintenant: Date = new Date(),
): ChantierPlanningCloseWarning {
  const currentWeek = isoWeekIdForDate(maintenant);
  const matching = planningPayload.macroAllocations.filter(
    (allocation) => allocation.chantierId === chantier.id,
  );

  const futureAllocatedHours = matching
    .filter((allocation) => allocation.week >= currentWeek)
    .reduce((somme, allocation) => somme + allocation.hours, 0);

  const allocatedByActivity = new Map<PlanningActivity, number>();
  for (const allocation of matching) {
    allocatedByActivity.set(
      allocation.activity,
      (allocatedByActivity.get(allocation.activity) ?? 0) + allocation.hours,
    );
  }

  const activities: PlanningActivity[] = ["BE", "WORKSHOP", "INSTALL"];
  const remainingToAllocateHours = activities.reduce((somme, activity) => {
    const plannedHours = plannedHoursForActivity(chantier, activity);
    const allocatedHours = allocatedByActivity.get(activity) ?? 0;
    return somme + Math.max(0, plannedHours - allocatedHours);
  }, 0);

  return {
    futureAllocatedHours,
    remainingToAllocateHours,
    hasRemainingCharge: futureAllocatedHours > 0 || remainingToAllocateHours > 0,
  };
}

export function planningYearWeekIds(annee: number): string[] {
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    throw new Error("PLANNING_YEAR_INVALID");
  }
  return Array.from({ length: weeksInIsoYear(annee) }, (_, indice) => {
    const number = String(indice + 1).padStart(2, "0");
    return `${annee}-W${number}`;
  });
}

export function planningYearWeekIdsRange(startYear: number, endYear: number): string[] {
  if (endYear < startYear || endYear - startYear > 2) {
    throw new Error("PLANNING_YEAR_RANGE_INVALID");
  }
  return Array.from({ length: endYear - startYear + 1 }, (_, offset) =>
    planningYearWeekIds(startYear + offset),
  ).flat();
}

function orderActiveChantiers(
  chantiers: ChantierRecord[],
  chantierOrder: string[],
): ChantierRecord[] {
  const active = chantiers.filter((chantier) => chantier.status === "ACTIVE");
  const rank = new Map(chantierOrder.map((id, indice) => [id, indice]));
  return active
    .map((chantier, inputIndex) => ({ chantier, inputIndex }))
    .sort((gauche, droite) => {
      const leftRank = rank.get(gauche.chantier.id);
      const rightRank = rank.get(droite.chantier.id);
      if (leftRank != null && rightRank != null) return leftRank - rightRank;
      if (leftRank != null) return -1;
      if (rightRank != null) return 1;
      return gauche.inputIndex - droite.inputIndex;
    })
    .map(({ chantier }) => chantier);
}

export function buildFirmGrandPlanningRows(
  chantiersPayload: ChantiersPayload,
  planningPayload: PlanningPayload,
  annee: number,
  endYear = annee,
): GrandPlanningChantierRow[] {
  const semaines = new Set(planningYearWeekIdsRange(annee, endYear));
  const activities: PlanningActivity[] = ["BE", "WORKSHOP", "INSTALL"];

  return orderActiveChantiers(chantiersPayload.chantiers, planningPayload.chantierOrder).map(
    (chantier) => ({
      chantierId: chantier.id,
      name: chantier.name,
      reference: chantier.reference,
      plannedInstallDate: chantier.plannedInstallDate,
      activities: activities.map((activity) => {
        const matching = planningPayload.macroAllocations.filter(
          (allocation) => allocation.chantierId === chantier.id && allocation.activity === activity,
        );
        const weeklyHours = Object.fromEntries(
          matching
            .filter((allocation) => semaines.has(allocation.week))
            .map((allocation) => [allocation.week, allocation.hours]),
        );
        const actualByWeek = new Map<string, number>();
        for (const entree of planningPayload.actualHours) {
          if (
            entree.chantierId === chantier.id &&
            entree.activity === activity &&
            semaines.has(entree.week)
          ) {
            actualByWeek.set(entree.week, (actualByWeek.get(entree.week) ?? 0) + entree.hours);
          }
        }
        for (const [semaine, heures] of actualByWeek) weeklyHours[semaine] = heures;
        const allocatedHours = matching.reduce((somme, allocation) => somme + allocation.hours, 0);
        const plannedHours = plannedHoursForActivity(chantier, activity);
        return {
          activity,
          label: PLANNING_ACTIVITY_LABELS[activity],
          plannedHours,
          actualHours: planningPayload.actualHours
            .filter((entree) => entree.chantierId === chantier.id && entree.activity === activity)
            .reduce((somme, entree) => somme + entree.hours, 0),
          allocatedHours,
          remainingHours: plannedHours - allocatedHours,
          weeklyHours,
        };
      }),
    }),
  );
}

function provisionHoursForActivity(
  provisionHours: { be: number; workshop: number; install: number },
  activity: PlanningActivity,
): number {
  if (activity === "BE") return provisionHours.be;
  if (activity === "WORKSHOP") return provisionHours.workshop;
  return provisionHours.install;
}

export function buildCommercialProvisionRows(
  commercialPayload: CommercialPayload,
  planningPayload: PlanningPayload,
  annee: number,
  endYear = annee,
  quotes: readonly NativeQuoteRecord[] = [],
): GrandPlanningProvisionRow[] {
  const semaines = new Set(planningYearWeekIdsRange(annee, endYear));
  const activities: PlanningActivity[] = ["BE", "WORKSHOP", "INSTALL"];

  const rank = new Map(planningPayload.provisionalOrder.map((id, indice) => [id, indice]));

  return commercialPayload.cases
    .filter(isCommercialActive)
    .map((element, inputIndex) => ({
      inputIndex,
      provisionHours: effectiveCommercialForecastHours(element, quotes),
      item: element,
    }))
    .map(({ inputIndex, provisionHours, item: element }) => ({
      inputIndex,
      row: {
        caseId: element.id,
        name: element.name,
        status: element.status,
        statusLabel: COMMERCIAL_STATUS_LABELS[element.status],
        expectedConfirmationDate: element.expectedConfirmationDate,
        activities: activities.map((activity) => {
          const matching = planningPayload.provisionalAllocations.filter(
            (allocation) => allocation.caseId === element.id && allocation.activity === activity,
          );
          const weeklyHours = Object.fromEntries(
            matching
              .filter((allocation) => semaines.has(allocation.week))
              .map((allocation) => [allocation.week, allocation.hours]),
          );
          const allocatedHours = matching.reduce(
            (somme, allocation) => somme + allocation.hours,
            0,
          );
          const activityProvisionHours = provisionHoursForActivity(provisionHours, activity);
          return {
            activity,
            label: PLANNING_ACTIVITY_LABELS[activity],
            provisionHours: activityProvisionHours,
            allocatedHours,
            remainingHours: activityProvisionHours - allocatedHours,
            weeklyHours,
          };
        }),
      },
    }))
    .filter(({ row: ligneTableau }) =>
      ligneTableau.activities.some(
        (activity) => activity.provisionHours !== 0 || activity.allocatedHours !== 0,
      ),
    )
    .sort((gauche, droite) => {
      const leftRank = rank.get(gauche.row.caseId);
      const rightRank = rank.get(droite.row.caseId);
      if (leftRank != null && rightRank != null) return leftRank - rightRank;
      if (leftRank != null) return -1;
      if (rightRank != null) return 1;
      return gauche.inputIndex - droite.inputIndex;
    })
    .map(({ row: ligneTableau }) => ligneTableau);
}

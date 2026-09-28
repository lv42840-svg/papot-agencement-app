import { z } from "zod";
import {
  COMMERCIAL_STATUS_LABELS,
  isCommercialActive,
  type CommercialPayload,
  type CommercialStatus,
} from "../commercial/domain";
import type { ChantierRecord, ChantiersPayload } from "@/lib/chantiers/domain";
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

export const planningAbsenceTypeSchema = z.enum(["VACATION", "SICK", "OTHER"]);
export type PlanningAbsenceType = z.infer<typeof planningAbsenceTypeSchema>;

export const planningAbsenceSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: planningAbsenceTypeSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "PLANNING_ABSENCE_DATE_INVALID"),
  hours: z.number().finite().positive().max(24),
});
export type PlanningAbsence = z.infer<typeof planningAbsenceSchema>;

export const PLANNING_ABSENCE_TYPE_LABELS: Record<PlanningAbsenceType, string> = {
  VACATION: "Congés",
  SICK: "Arrêt",
  OTHER: "Autre",
};

export const planningPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    macroAllocations: z.array(planningMacroAllocationSchema),
    provisionalAllocations: z.array(planningProvisionalAllocationSchema).default([]),
    chantierOrder: z.array(z.string().uuid()),
    provisionalOrder: z.array(z.string().uuid()).default([]),
    peopleCapacity: z.array(planningPersonCapacitySchema).default([]),
    absences: z.array(planningAbsenceSchema).default([]),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.macroAllocations.forEach((allocation, index) => {
      const key = allocationKey(allocation.chantierId, allocation.activity, allocation.week);
      if (seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["macroAllocations", index],
          message: "PLANNING_ALLOCATION_DUPLICATE",
        });
      }
      seen.add(key);
    });

    const provisionalSeen = new Set<string>();
    value.provisionalAllocations.forEach((allocation, index) => {
      const key = provisionalAllocationKey(allocation.caseId, allocation.activity, allocation.week);
      if (provisionalSeen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["provisionalAllocations", index],
          message: "PLANNING_PROVISIONAL_ALLOCATION_DUPLICATE",
        });
      }
      provisionalSeen.add(key);
    });

    const absenceKeys = new Set<string>();
    value.absences.forEach((absence, index) => {
      const key = `${absence.userId}:${absence.date}`;
      if (absenceKeys.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["absences", index],
          message: "PLANNING_ABSENCE_DUPLICATE_DATE",
        });
      }
      absenceKeys.add(key);
    });

    if (new Set(value.chantierOrder).size !== value.chantierOrder.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chantierOrder"],
        message: "PLANNING_CHANTIER_ORDER_DUPLICATE",
      });
    }

    if (new Set(value.provisionalOrder).size !== value.provisionalOrder.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["provisionalOrder"],
        message: "PLANNING_PROVISIONAL_ORDER_DUPLICATE",
      });
    }
  });

export type PlanningMacroAllocation = z.infer<typeof planningMacroAllocationSchema>;
export type PlanningProvisionalAllocation = z.infer<typeof planningProvisionalAllocationSchema>;
export type PlanningPayload = z.infer<typeof planningPayloadSchema>;

export type GrandPlanningActivityRow = {
  activity: PlanningActivity;
  label: string;
  plannedHours: number;
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
    chantierOrder: [],
    provisionalOrder: [],
    peopleCapacity: [],
    absences: [],
  };
}

export function parsePlanningPayload(value: unknown): PlanningPayload {
  if (value == null) return createInitialPlanningPayload();
  return planningPayloadSchema.parse(value);
}

export function allocationKey(
  chantierId: string,
  activity: PlanningActivity,
  week: string,
): string {
  return `${chantierId}:${activity}:${week}`;
}

export function provisionalAllocationKey(
  caseId: string,
  activity: PlanningActivity,
  week: string,
): string {
  return `${caseId}:${activity}:${week}`;
}

export function plannedHoursForActivity(
  chantier: Pick<ChantierRecord, "plannedHours">,
  activity: PlanningActivity,
): number {
  if (activity === "BE") return chantier.plannedHours.be;
  if (activity === "WORKSHOP") return chantier.plannedHours.workshop;
  return chantier.plannedHours.install;
}

export function weeksInIsoYear(year: number): number {
  const date = new Date(Date.UTC(year, 11, 28));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

export function isoWeekIdForDate(input: Date): string {
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function buildChantierPlanningCloseWarning(
  chantier: Pick<ChantierRecord, "id" | "plannedHours">,
  planningPayload: PlanningPayload,
  now: Date = new Date(),
): ChantierPlanningCloseWarning {
  const currentWeek = isoWeekIdForDate(now);
  const matching = planningPayload.macroAllocations.filter(
    (allocation) => allocation.chantierId === chantier.id,
  );

  const futureAllocatedHours = matching
    .filter((allocation) => allocation.week >= currentWeek)
    .reduce((sum, allocation) => sum + allocation.hours, 0);

  const allocatedByActivity = new Map<PlanningActivity, number>();
  for (const allocation of matching) {
    allocatedByActivity.set(
      allocation.activity,
      (allocatedByActivity.get(allocation.activity) ?? 0) + allocation.hours,
    );
  }

  const activities: PlanningActivity[] = ["BE", "WORKSHOP", "INSTALL"];
  const remainingToAllocateHours = activities.reduce((sum, activity) => {
    const plannedHours = plannedHoursForActivity(chantier, activity);
    const allocatedHours = allocatedByActivity.get(activity) ?? 0;
    return sum + Math.max(0, plannedHours - allocatedHours);
  }, 0);

  return {
    futureAllocatedHours,
    remainingToAllocateHours,
    hasRemainingCharge: futureAllocatedHours > 0 || remainingToAllocateHours > 0,
  };
}

export function planningYearWeekIds(year: number): string[] {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new Error("PLANNING_YEAR_INVALID");
  }
  return Array.from({ length: weeksInIsoYear(year) }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return `${year}-W${number}`;
  });
}

function orderActiveChantiers(
  chantiers: ChantierRecord[],
  chantierOrder: string[],
): ChantierRecord[] {
  const active = chantiers.filter((chantier) => chantier.status === "ACTIVE");
  const rank = new Map(chantierOrder.map((id, index) => [id, index]));
  return active
    .map((chantier, inputIndex) => ({ chantier, inputIndex }))
    .sort((left, right) => {
      const leftRank = rank.get(left.chantier.id);
      const rightRank = rank.get(right.chantier.id);
      if (leftRank != null && rightRank != null) return leftRank - rightRank;
      if (leftRank != null) return -1;
      if (rightRank != null) return 1;
      return left.inputIndex - right.inputIndex;
    })
    .map(({ chantier }) => chantier);
}

export function buildFirmGrandPlanningRows(
  chantiersPayload: ChantiersPayload,
  planningPayload: PlanningPayload,
  year: number,
): GrandPlanningChantierRow[] {
  const weeks = new Set(planningYearWeekIds(year));
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
            .filter((allocation) => weeks.has(allocation.week))
            .map((allocation) => [allocation.week, allocation.hours]),
        );
        const allocatedHours = matching.reduce((sum, allocation) => sum + allocation.hours, 0);
        const plannedHours = plannedHoursForActivity(chantier, activity);
        return {
          activity,
          label: PLANNING_ACTIVITY_LABELS[activity],
          plannedHours,
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
  year: number,
): GrandPlanningProvisionRow[] {
  const weeks = new Set(planningYearWeekIds(year));
  const activities: PlanningActivity[] = ["BE", "WORKSHOP", "INSTALL"];

  const rank = new Map(planningPayload.provisionalOrder.map((id, index) => [id, index]));

  return commercialPayload.cases
    .filter(isCommercialActive)
    .map((item, inputIndex) => ({
      inputIndex,
      row: {
        caseId: item.id,
        name: item.name,
        status: item.status,
        statusLabel: COMMERCIAL_STATUS_LABELS[item.status],
        expectedConfirmationDate: item.expectedConfirmationDate,
        activities: activities.map((activity) => {
          const matching = planningPayload.provisionalAllocations.filter(
            (allocation) => allocation.caseId === item.id && allocation.activity === activity,
          );
          const weeklyHours = Object.fromEntries(
            matching
              .filter((allocation) => weeks.has(allocation.week))
              .map((allocation) => [allocation.week, allocation.hours]),
          );
          const allocatedHours = matching.reduce((sum, allocation) => sum + allocation.hours, 0);
          const provisionHours = provisionHoursForActivity(item.provisionHours, activity);
          return {
            activity,
            label: PLANNING_ACTIVITY_LABELS[activity],
            provisionHours,
            allocatedHours,
            remainingHours: provisionHours - allocatedHours,
            weeklyHours,
          };
        }),
      },
    }))
    .filter(({ row }) =>
      row.activities.some(
        (activity) => activity.provisionHours !== 0 || activity.allocatedHours !== 0,
      ),
    )
    .sort((left, right) => {
      const leftRank = rank.get(left.row.caseId);
      const rightRank = rank.get(right.row.caseId);
      if (leftRank != null && rightRank != null) return leftRank - rightRank;
      if (leftRank != null) return -1;
      if (rightRank != null) return 1;
      return left.inputIndex - right.inputIndex;
    })
    .map(({ row }) => row);
}

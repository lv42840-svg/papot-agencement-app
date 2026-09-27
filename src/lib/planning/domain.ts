import { z } from "zod";
import type { ChantierRecord, ChantiersPayload } from "@/lib/chantiers/domain";

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

export const planningPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    macroAllocations: z.array(planningMacroAllocationSchema),
    chantierOrder: z.array(z.string().uuid()),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.macroAllocations.forEach((allocation, index) => {
      const key = allocationKey(
        allocation.chantierId,
        allocation.activity,
        allocation.week,
      );
      if (seen.has(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["macroAllocations", index],
          message: "PLANNING_ALLOCATION_DUPLICATE",
        });
      }
      seen.add(key);
    });

    if (new Set(value.chantierOrder).size !== value.chantierOrder.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chantierOrder"],
        message: "PLANNING_CHANTIER_ORDER_DUPLICATE",
      });
    }
  });

export type PlanningMacroAllocation = z.infer<
  typeof planningMacroAllocationSchema
>;
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

export function createInitialPlanningPayload(): PlanningPayload {
  return {
    schemaVersion: 1,
    macroAllocations: [],
    chantierOrder: [],
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
  return Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
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

  return orderActiveChantiers(
    chantiersPayload.chantiers,
    planningPayload.chantierOrder,
  ).map((chantier) => ({
    chantierId: chantier.id,
    name: chantier.name,
    reference: chantier.reference,
    plannedInstallDate: chantier.plannedInstallDate,
    activities: activities.map((activity) => {
      const matching = planningPayload.macroAllocations.filter(
        (allocation) =>
          allocation.chantierId === chantier.id && allocation.activity === activity,
      );
      const weeklyHours = Object.fromEntries(
        matching
          .filter((allocation) => weeks.has(allocation.week))
          .map((allocation) => [allocation.week, allocation.hours]),
      );
      const allocatedHours = matching.reduce(
        (sum, allocation) => sum + allocation.hours,
        0,
      );
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
  }));
}

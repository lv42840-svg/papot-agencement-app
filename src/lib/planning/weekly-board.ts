import { z } from "zod";
import type { PlanningDailyActivity, PlanningPayload } from "./domain";
import { planningDailyActivitySchema } from "./domain";
import { parsePlanningPayload } from "./domain";
import { isoWeekDates } from "./capacity";
import { isoWeekKey } from "./time-markers";

export const weeklyBoardWeekSchema = z
  .string()
  .regex(/^(?:20\d\d|2100)-W(?:0[1-9]|[1-4]\d|5[0-3])$/, "PLANNING_WEEK_INVALID")
  .refine((semaine) => {
    const firstDate = isoWeekDates(semaine)[0];
    return (
      isoWeekKey(
        new Date(firstDate.getUTCFullYear(), firstDate.getUTCMonth(), firstDate.getUTCDate(), 12),
      ) === semaine
    );
  }, "PLANNING_WEEK_INVALID");

export const weeklyBoardAssignmentSchema = z.object({
  action: z.literal("setDailyAssignment"),
  week: weeklyBoardWeekSchema,
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "PLANNING_DAY_INVALID"),
  label: z.string().trim().max(160),
});

export type WeeklyBoardAssignmentInput = z.infer<typeof weeklyBoardAssignmentSchema>;

export function workingDaysOfWeek(semaine: string): string[] {
  weeklyBoardWeekSchema.parse(semaine);
  return isoWeekDates(semaine)
    .slice(0, 5)
    .map((date) => date.toISOString().slice(0, 10));
}

export function applyDailyAssignment(
  source: PlanningPayload,
  saisie: WeeklyBoardAssignmentInput,
  activePersonIds: ReadonlySet<string>,
  activeChantiers: readonly { id: string; name: string }[],
): PlanningPayload {
  weeklyBoardAssignmentSchema.parse(saisie);
  if (!activePersonIds.has(saisie.userId)) throw new Error("PLANNING_USER_NOT_ACTIVE");
  if (!workingDaysOfWeek(saisie.week).includes(saisie.date)) {
    throw new Error("PLANNING_DAY_OUTSIDE_WEEK");
  }
  const contenu = structuredClone(parsePlanningPayload(source));
  const chantier = activeChantiers.find(
    (site) =>
      site.name.trim().toLocaleLowerCase("fr-FR") ===
      saisie.label.trim().toLocaleLowerCase("fr-FR"),
  );
  contenu.dailyAssignments = contenu.dailyAssignments.filter(
    (ligneTableau) => ligneTableau.userId !== saisie.userId || ligneTableau.date !== saisie.date,
  );
  if (saisie.label.trim()) {
    contenu.dailyAssignments.push({
      userId: saisie.userId,
      date: saisie.date,
      id: crypto.randomUUID(),
      activity: "NOTE",
      chantierId: chantier?.id ?? null,
      label: chantier?.name ?? saisie.label.trim(),
    });
  }
  return parsePlanningPayload(contenu);
}

export const weeklyBoardEntrySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("saveDailyEntry"),
    week: weeklyBoardWeekSchema,
    userId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    id: z.string().uuid().optional(),
    legacy: z.boolean().optional(),
    label: z.string().trim().min(1).max(160),
    activity: planningDailyActivitySchema,
  }),
  z.object({
    action: z.literal("deleteDailyEntry"),
    week: weeklyBoardWeekSchema,
    userId: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    id: z.string().uuid().optional(),
    legacy: z.boolean().optional(),
  }),
]);

export type WeeklyBoardEntryInput = z.infer<typeof weeklyBoardEntrySchema>;

export const weeklyBoardPasteSchema = z.object({
  action: z.literal("pasteDailyEntries"),
  week: weeklyBoardWeekSchema,
  userId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(160),
        activity: planningDailyActivitySchema,
      }),
    )
    .min(1)
    .max(20),
});
export type WeeklyBoardPasteInput = z.infer<typeof weeklyBoardPasteSchema>;

export function applyWeeklyBoardPaste(
  source: PlanningPayload,
  saisie: WeeklyBoardPasteInput,
  activePersonIds: ReadonlySet<string>,
  sites: readonly { id: string; name: string }[],
): PlanningPayload {
  weeklyBoardPasteSchema.parse(saisie);
  if (!activePersonIds.has(saisie.userId)) throw new Error("PLANNING_USER_NOT_ACTIVE");
  if (!workingDaysOfWeek(saisie.week).includes(saisie.date)) {
    throw new Error("PLANNING_DAY_OUTSIDE_WEEK");
  }
  const contenu = structuredClone(parsePlanningPayload(source));
  const existing = contenu.dailyAssignments.filter(
    (ligneTableau) => ligneTableau.userId === saisie.userId && ligneTableau.date === saisie.date,
  ).length;
  if (existing + saisie.entries.length > 20) throw new Error("PLANNING_DAILY_LIMIT");
  for (const entree of saisie.entries) {
    const site = sites.find(
      (candidat) =>
        candidat.name.trim().toLocaleLowerCase("fr-FR") ===
        entree.label.trim().toLocaleLowerCase("fr-FR"),
    );
    contenu.dailyAssignments.push({
      id: crypto.randomUUID(),
      userId: saisie.userId,
      date: saisie.date,
      chantierId: site?.id ?? null,
      label: site?.name ?? entree.label.trim(),
      activity: entree.activity,
    });
  }
  return parsePlanningPayload(contenu);
}

export function applyWeeklyBoardEntry(
  source: PlanningPayload,
  saisie: WeeklyBoardEntryInput,
  activePersonIds: ReadonlySet<string>,
  activeChantiers: readonly { id: string; name: string }[],
): PlanningPayload {
  weeklyBoardEntrySchema.parse(saisie);
  if (!activePersonIds.has(saisie.userId)) throw new Error("PLANNING_USER_NOT_ACTIVE");
  if (!workingDaysOfWeek(saisie.week).includes(saisie.date)) {
    throw new Error("PLANNING_DAY_OUTSIDE_WEEK");
  }
  if (saisie.id && saisie.legacy) throw new Error("PLANNING_DAILY_TARGET_INVALID");

  const contenu = structuredClone(parsePlanningPayload(source));
  const courant = contenu.dailyAssignments;
  const indice = saisie.id
    ? courant.findIndex((ligneTableau) => ligneTableau.id === saisie.id)
    : saisie.legacy
      ? courant.findIndex(
          (ligneTableau) =>
            !ligneTableau.id &&
            ligneTableau.userId === saisie.userId &&
            ligneTableau.date === saisie.date,
        )
      : -1;
  if ((saisie.id || saisie.legacy) && indice < 0) throw new Error("PLANNING_DAILY_NOT_FOUND");
  if (
    indice >= 0 &&
    (courant[indice].userId !== saisie.userId || courant[indice].date !== saisie.date)
  )
    throw new Error("PLANNING_DAILY_TARGET_INVALID");

  if (saisie.action === "deleteDailyEntry") {
    if (indice < 0) throw new Error("PLANNING_DAILY_NOT_FOUND");
    courant.splice(indice, 1);
    return parsePlanningPayload(contenu);
  }

  const normalized = saisie.label.trim();
  const chantier = activeChantiers.find(
    (site) => site.name.trim().toLocaleLowerCase("fr-FR") === normalized.toLocaleLowerCase("fr-FR"),
  );
  const newEntry = {
    id: saisie.id ?? crypto.randomUUID(),
    userId: saisie.userId,
    date: saisie.date,
    chantierId: chantier?.id ?? null,
    label: chantier?.name ?? normalized,
    activity: saisie.activity as PlanningDailyActivity,
  };

  if (indice >= 0) courant[indice] = newEntry;
  else {
    if (
      courant.filter(
        (ligneTableau) =>
          ligneTableau.userId === saisie.userId && ligneTableau.date === saisie.date,
      ).length >= 20
    ) {
      throw new Error("PLANNING_DAILY_LIMIT");
    }
    courant.push(newEntry);
  }
  return parsePlanningPayload(contenu);
}

export type WeeklyBoardChantierLine = {
  id: string;
  name: string;
  category: "firm" | "provisional";
  be: number;
  workshop: number;
  install: number;
  total: number;
};

export function weeklyChantierHours(
  lignesTableau: readonly {
    activities: readonly {
      activity: "BE" | "WORKSHOP" | "INSTALL";
      weeklyHours: Record<string, number>;
    }[];
  }[],
  semaine: string,
  category: "firm" | "provisional",
  nameAndId: (indice: number) => { id: string; name: string },
): WeeklyBoardChantierLine[] {
  return lignesTableau
    .map((ligneTableau, indice) => {
      const heures = weekActivityHours([ligneTableau], semaine);
      const identity = nameAndId(indice);
      return { ...identity, category, ...heures };
    })
    .filter((ligne) => ligne.total !== 0);
}

export type WeeklyBoardActivitySummary = {
  be: number;
  workshop: number;
  install: number;
  total: number;
};

export function weekActivityHours(
  lignesTableau: readonly {
    activities: readonly {
      activity: "BE" | "WORKSHOP" | "INSTALL";
      weeklyHours: Record<string, number>;
    }[];
  }[],
  semaine: string,
): WeeklyBoardActivitySummary {
  const resultat = { be: 0, workshop: 0, install: 0, total: 0 };
  for (const ligneTableau of lignesTableau) {
    for (const activity of ligneTableau.activities) {
      const heures = activity.weeklyHours[semaine] ?? 0;
      if (activity.activity === "BE") resultat.be += heures;
      if (activity.activity === "WORKSHOP") resultat.workshop += heures;
      if (activity.activity === "INSTALL") resultat.install += heures;
      resultat.total += heures;
    }
  }
  return resultat;
}

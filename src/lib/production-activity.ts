import { z } from "zod";

export const productionActivitySchema = z.enum(["BE", "ATELIER", "POSE"]);

export type ProductionActivity = z.infer<typeof productionActivitySchema>;

export function productionActivityLabel(activity: ProductionActivity): string {
  if (activity === "BE") return "BE";
  if (activity === "ATELIER") return "Atelier";
  return "Pose";
}

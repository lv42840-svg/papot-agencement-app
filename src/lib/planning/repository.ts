import type { PlanningPayload } from "./domain";

export type PlanningMutationTransform = (
  donnees: PlanningPayload,
) => PlanningPayload | Promise<PlanningPayload>;

export interface PlanningRepository {
  load(): Promise<PlanningPayload>;
  mutate(transformation: PlanningMutationTransform): Promise<PlanningPayload>;
}

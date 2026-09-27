import type { PlanningPayload } from "./domain";

export type PlanningMutationTransform = (
  payload: PlanningPayload,
) => PlanningPayload | Promise<PlanningPayload>;

export interface PlanningRepository {
  load(): Promise<PlanningPayload>;
  mutate(transform: PlanningMutationTransform): Promise<PlanningPayload>;
}

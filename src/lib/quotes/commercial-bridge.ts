import type { CommercialPayload } from "../commercial/domain";
import {
  applyCommercialMutation,
  commercialMutationSchema,
  type CommercialActor,
} from "../commercial/mutations";

export function startQuoteCommercialWorkflow(
  source: CommercialPayload,
  caseId: string,
  quoteOwnerName: string,
  quoteDueDate: string,
  actor: CommercialActor,
  now: Date = new Date(),
) {
  return applyCommercialMutation(
    source,
    commercialMutationSchema.parse({
      action: "setStatus",
      caseId,
      status: "CHIFFRAGE",
      quoteOwnerName,
      quoteDueDate,
    }),
    actor,
    now,
  );
}

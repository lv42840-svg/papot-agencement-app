import type { CommercialPayload } from "../commercial/domain";
import {
  applyCommercialMutation,
  commercialMutationSchema,
  type CommercialActor,
} from "../commercial/mutations";

export function startQuoteCommercialWorkflow(
  source: CommercialPayload,
  idAffaire: string,
  quoteOwnerName: string,
  quoteDueDate: string,
  auteur: CommercialActor,
  maintenant: Date = new Date(),
) {
  return applyCommercialMutation(
    source,
    commercialMutationSchema.parse({
      action: "setStatus",
      caseId: idAffaire,
      status: "CHIFFRAGE",
      quoteOwnerName,
      quoteDueDate,
    }),
    auteur,
    maintenant,
  );
}

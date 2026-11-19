import type { ClientsMutation } from "./mutations";
import type { ClientsMutationOptions } from "./repository";

/**
 * Explicitly allow only unlinked, lightweight CRM prospect records.
 * This policy does not enable normal customer creation while Pennylane is authoritative.
 */
export function isAllowedCommercialProvisionalCreate(
  input: ClientsMutation,
  options?: ClientsMutationOptions,
): boolean {
  return (
    options?.source === "commercialProvisional" &&
    input.action === "create" &&
    !!input.clientId &&
    (input.type === "AUTRE" || input.type === "ENTREPRISE") &&
    !!input.companyName.trim() &&
    !input.firstName &&
    !input.lastName &&
    !input.phone &&
    !input.email &&
    !input.paymentTerms &&
    !input.vatNumber &&
    input.contacts.length === 0 &&
    (!input.siret || (input.type === "ENTREPRISE" && /^\d{14}$/.test(input.siret)))
  );
}

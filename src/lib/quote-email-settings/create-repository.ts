import "server-only";
import { isLocalStorageMode, mutateLocalSnapshot, readLocalSnapshot } from "../local-db/runtime";
import { parseQuoteEmailSettings } from "./domain";
import type { QuoteEmailSettingsRepository } from "./repository";
import { createPostgresQuoteEmailSettingsRepository } from "./postgres-repository";

export function createQuoteEmailSettingsRepository(): QuoteEmailSettingsRepository {
  if (!isLocalStorageMode()) {
    return createPostgresQuoteEmailSettingsRepository();
  }
  return {
    async load() {
      return readLocalSnapshot("quote-email-settings", parseQuoteEmailSettings).payload;
    },
    async replace(parametres) {
      const donnees = parseQuoteEmailSettings(parametres);
      return mutateLocalSnapshot("quote-email-settings", parseQuoteEmailSettings, () => ({
        payload: donnees,
        result: donnees,
      }));
    },
  };
}

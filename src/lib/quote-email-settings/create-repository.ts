import "server-only";
import { isLocalStorageMode, readLocalSnapshot, mutateLocalSnapshot } from "../local-db/runtime";
import { parseQuoteEmailSettings } from "./domain";
import type { QuoteEmailSettingsRepository } from "./repository";
import { createPostgresQuoteEmailSettingsRepository } from "./postgres-repository";
export function createQuoteEmailSettingsRepository(): QuoteEmailSettingsRepository {
  if (!isLocalStorageMode()) return createPostgresQuoteEmailSettingsRepository();
  return {
    async load() {
      return readLocalSnapshot("quote-email-settings", parseQuoteEmailSettings).payload;
    },
    async replace(settings) {
      const payload = parseQuoteEmailSettings(settings);
      return mutateLocalSnapshot("quote-email-settings", parseQuoteEmailSettings, () => ({
        payload,
        result: payload,
      }));
    },
  };
}

import "server-only";

import { createPostgresQuoteEmailSettingsRepository } from "./postgres-repository";

export function createQuoteEmailSettingsRepository() {
  return createPostgresQuoteEmailSettingsRepository();
}

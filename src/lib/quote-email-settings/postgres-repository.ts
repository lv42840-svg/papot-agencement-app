import "server-only";

import type { Pool } from "pg";
import { getServerDbPool } from "@/lib/server-db/pool";
import { withServerDbTransaction } from "@/lib/server-db/transaction";
import { parseQuoteEmailSettings, type QuoteEmailSettings } from "./domain";
import type { QuoteEmailSettingsRepository } from "./repository";

type Row = { payload: unknown };

export function createPostgresQuoteEmailSettingsRepository(
  pool: Pool = getServerDbPool(),
): QuoteEmailSettingsRepository {
  return {
    async load() {
      const result = await pool.query<Row>(
        "SELECT payload FROM papot_quote_email_settings WHERE scope = 'global'",
      );
      const row = result.rows[0];
      if (!row) throw new Error("QUOTE_EMAIL_SETTINGS_STORAGE_NOT_INITIALIZED");
      return parseQuoteEmailSettings(row.payload);
    },

    async replace(settings: QuoteEmailSettings) {
      const parsed = parseQuoteEmailSettings(settings);
      return withServerDbTransaction(async (client) => {
        const result = await client.query<Row>(
          `
            UPDATE papot_quote_email_settings
            SET version = version + 1,
                payload = $1,
                updated_at = NOW()
            WHERE scope = 'global'
            RETURNING payload
          `,
          [parsed],
        );
        const row = result.rows[0];
        if (!row) throw new Error("QUOTE_EMAIL_SETTINGS_STORAGE_NOT_INITIALIZED");
        return parseQuoteEmailSettings(row.payload);
      }, pool);
    },
  };
}

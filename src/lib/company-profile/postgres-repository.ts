import "server-only";

import type { Pool } from "pg";
import { getServerDbPool } from "../server-db/pool";
import { withServerDbTransaction } from "../server-db/transaction";
import { parseCompanyProfile, type CompanyProfile } from "./domain";
import type { CompanyProfileRepository } from "./repository";

type CompanyProfileRow = {
  version: number;
  payload: unknown;
};

export function createPostgresCompanyProfileRepository(
  pool: Pool = getServerDbPool(),
): CompanyProfileRepository {
  return {
    async load() {
      const result = await pool.query<CompanyProfileRow>(
        "SELECT version, payload FROM papot_company_profile WHERE scope = 'global'",
      );
      const row = result.rows[0];
      if (!row) throw new Error("COMPANY_PROFILE_STORAGE_NOT_INITIALIZED");
      return parseCompanyProfile(row.payload);
    },

    async loadSnapshot() {
      const result = await pool.query<CompanyProfileRow>(
        "SELECT version, payload FROM papot_company_profile WHERE scope = 'global'",
      );
      const row = result.rows[0];
      if (!row) throw new Error("COMPANY_PROFILE_STORAGE_NOT_INITIALIZED");
      return { version: row.version, profile: parseCompanyProfile(row.payload) };
    },

    async replace(profile: CompanyProfile) {
      const parsed = parseCompanyProfile(profile);
      return withServerDbTransaction(async (client) => {
        const result = await client.query<CompanyProfileRow>(
          `
            UPDATE papot_company_profile
            SET version = version + 1,
                payload = $1,
                updated_at = NOW()
            WHERE scope = 'global'
            RETURNING version, payload
          `,
          [parsed],
        );
        const row = result.rows[0];
        if (!row) throw new Error("COMPANY_PROFILE_STORAGE_NOT_INITIALIZED");
        return parseCompanyProfile(row.payload);
      }, pool);
    },

    async replaceIfVersion(profile: CompanyProfile, expectedVersion: number) {
      const parsed = parseCompanyProfile(profile);
      return withServerDbTransaction(async (client) => {
        const result = await client.query<CompanyProfileRow>(
          `
            UPDATE papot_company_profile
            SET version = version + 1,
                payload = $1,
                updated_at = NOW()
            WHERE scope = 'global'
              AND version = $2
            RETURNING version, payload
          `,
          [parsed, expectedVersion],
        );
        const row = result.rows[0];
        if (!row) throw new Error("COMPANY_PROFILE_VERSION_CONFLICT");
        return {
          version: row.version,
          profile: parseCompanyProfile(row.payload),
        };
      }, pool);
    },
  };
}

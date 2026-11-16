import { getPennylaneConfig, PENNYLANE_RESOURCES, type PennylaneResource } from "./config";
import {
  listPennylaneResource,
  verifyPennylaneCompany,
  type PennylaneFetcher,
  type PennylaneItem,
} from "./client";
import { publishPennylaneSnapshots } from "./store";
import { readPennylaneStoredConfig } from "./connection";

export type PennylaneSyncResult = {
  companyName: string;
  counts: Record<PennylaneResource, number>;
};

/** Calls only GET endpoints. No sync runs until explicitly invoked after enablement. */
export async function preparePennylaneSnapshot(
  env: Record<string, string | undefined> = process.env,
  fetcher: PennylaneFetcher = fetch,
): Promise<{ companyName: string; records: Record<PennylaneResource, PennylaneItem[]> }> {
  const config = getPennylaneConfig(env);
  const companyName = await verifyPennylaneCompany(config, fetcher);
  const records = {} as Record<PennylaneResource, PennylaneItem[]>;
  // Fail closed: a single failed resource prevents publication of any partial snapshot.
  for (const resource of PENNYLANE_RESOURCES) {
    records[resource] = await listPennylaneResource(resource, config, fetcher);
  }
  return { companyName, records };
}

export async function synchronizePennylane(): Promise<PennylaneSyncResult> {
  // Production imports use only the encrypted token saved by an administrator.
  // The legacy environment-token interface is retained for mock-only unit tests.
  const stored = await readPennylaneStoredConfig();
  const { companyName, records } = await preparePennylaneSnapshot({
    PAPOT_PENNYLANE_ENABLED: process.env.PAPOT_PENNYLANE_ENABLED,
    PAPOT_PENNYLANE_API_TOKEN: stored.token,
    PAPOT_PENNYLANE_EXPECTED_COMPANY: stored.expectedCompany,
  });
  await publishPennylaneSnapshots(companyName, records);
  return {
    companyName,
    counts: Object.fromEntries(
      PENNYLANE_RESOURCES.map((resource) => [resource, records[resource].length]),
    ) as Record<PennylaneResource, number>,
  };
}

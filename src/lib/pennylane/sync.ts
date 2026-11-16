import { getPennylaneConfig, PENNYLANE_RESOURCES, type PennylaneResource } from "./config";
import {
  listPennylaneResource,
  verifyPennylaneCompany,
  type PennylaneFetcher,
  type PennylaneItem,
} from "./client";
import { publishPennylaneSnapshots } from "./store";

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
  const { companyName, records } = await preparePennylaneSnapshot();
  await publishPennylaneSnapshots(companyName, records);
  return {
    companyName,
    counts: Object.fromEntries(
      PENNYLANE_RESOURCES.map((resource) => [resource, records[resource].length]),
    ) as Record<PennylaneResource, number>,
  };
}

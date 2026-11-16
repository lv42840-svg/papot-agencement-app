export const PENNYLANE_RESOURCES = [
  "suppliers",
  "supplier_invoices",
  "customers",
  "customer_invoices",
] as const;

export type PennylaneResource = (typeof PENNYLANE_RESOURCES)[number];

export type PennylaneConfig = {
  token: string;
  expectedCompany: string;
};

export function getPennylaneConfig(env: Record<string, string | undefined> = process.env): PennylaneConfig {
  if (env.PAPOT_PENNYLANE_ENABLED !== "true") {
    throw new Error("PENNYLANE_DISABLED");
  }
  const token = env.PAPOT_PENNYLANE_API_TOKEN?.trim();
  const expectedCompany = env.PAPOT_PENNYLANE_EXPECTED_COMPANY?.trim();
  if (!token || !expectedCompany) {
    throw new Error("PENNYLANE_NOT_CONFIGURED");
  }
  return { token, expectedCompany };
}

export function pennylaneEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PAPOT_PENNYLANE_ENABLED === "true";
}

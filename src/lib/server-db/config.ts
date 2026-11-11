export type ServerDbConfig = {
  connectionString: string;
  applicationName: string;
  maxConnections: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
};

type ServerDbEnv = Record<string, string | undefined>;

const DEFAULT_APPLICATION_NAME = "papot-agencement";

export function getServerDbConfig(
  environnement: ServerDbEnv = process.env,
): ServerDbConfig {
  const chaineConnexion = environnement.PAPOT_DATABASE_URL?.trim();

  if (!chaineConnexion) {
    throw new Error(
      "PAPOT_DATABASE_URL is required before using the central PostgreSQL database.",
    );
  }

  let urlAnalysee: URL;
  try {
    urlAnalysee = new URL(chaineConnexion);
  } catch {
    throw new Error(
      "PAPOT_DATABASE_URL must be a valid PostgreSQL URL.",
    );
  }

  if (
    urlAnalysee.protocol !== "postgresql:" &&
    urlAnalysee.protocol !== "postgres:"
  ) {
    throw new Error(
      "PAPOT_DATABASE_URL must use the postgresql:// or postgres:// protocol.",
    );
  }

  return {
    connectionString: chaineConnexion,
    applicationName:
      environnement.PAPOT_DATABASE_APPLICATION_NAME?.trim() ||
      DEFAULT_APPLICATION_NAME,
    maxConnections: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  };
}

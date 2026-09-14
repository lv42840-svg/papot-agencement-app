export type ServerDbConfig = {
  connectionString: string;
  applicationName: string;
  maxConnections: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
};

type ServerDbEnv = {
  PAPOT_DATABASE_URL?: string;
};

const DEFAULT_APPLICATION_NAME = "papot-agencement";

export function getServerDbConfig(
  env: ServerDbEnv = process.env,
): ServerDbConfig {
  const connectionString = env.PAPOT_DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error(
      "PAPOT_DATABASE_URL is required before using the central PostgreSQL database.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(connectionString);
  } catch {
    throw new Error("PAPOT_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (parsedUrl.protocol !== "postgresql:" && parsedUrl.protocol !== "postgres:") {
    throw new Error("PAPOT_DATABASE_URL must use the postgresql:// or postgres:// protocol.");
  }

  return {
    connectionString,
    applicationName: DEFAULT_APPLICATION_NAME,
    maxConnections: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  };
}

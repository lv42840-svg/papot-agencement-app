import "server-only";

import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

declare global {
  // eslint-disable-next-line no-var
  var __papotPool: Pool | undefined;
}

export const db =
  global.__papotPool ??
  new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== "production") {
  global.__papotPool = db;
}

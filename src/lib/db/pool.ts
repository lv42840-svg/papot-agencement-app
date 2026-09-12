import "server-only";

import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __papotPool: Pool | undefined;
}

export const db =
  global.__papotPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

if (process.env.NODE_ENV !== "production") {
  global.__papotPool = db;
}

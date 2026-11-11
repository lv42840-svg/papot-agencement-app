import "server-only";
import {
  isLocalStorageMode,
  withLocalDatabaseWrite,
} from "../local-db/runtime";
import { runServerDbMigrations } from "./migrations";
import { withServerDbTransaction } from "./transaction";

/** Initialize before acquiring business locks. Nested repositories reuse the transaction. */
export async function withBusinessTransaction<T>(
  travail: () => Promise<T>,
): Promise<T> {
  if (isLocalStorageMode()) {
    return withLocalDatabaseWrite(travail);
  }
  await runServerDbMigrations();
  return withServerDbTransaction(travail);
}

import type { PoolClient } from "pg";
export async function lockAuthMutation(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [7_332_170_416_238_507]);
}

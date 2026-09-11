import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString });

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const dir = path.join(process.cwd(), "db", "migrations");
  const files = (await readdir(dir)).filter((file: string) => file.endsWith(".sql")).sort();

  for (const filename of files) {
    const exists = await pool.query("SELECT 1 FROM schema_migration WHERE filename = $1", [filename]);
    if (exists.rowCount) continue;

    const sql = await readFile(path.join(dir, filename), "utf8");
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migration(filename) VALUES ($1) ON CONFLICT DO NOTHING", [filename]);
    console.log(`Applied ${filename}`);
  }
}

main().finally(() => pool.end());

import { NextResponse } from "next/server";

import {
  getServerDbPool,
  runServerDbMigrations,
} from "@/lib/server-db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const pool = getServerDbPool();
    await runServerDbMigrations(pool);
    await pool.query("SELECT 1");

    return NextResponse.json(
      { ok: true, service: "papot-agencement-web" },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: false, service: "papot-agencement-web" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

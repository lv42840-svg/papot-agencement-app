import { NextResponse } from "next/server";
import { pennylaneEnabled } from "@/lib/pennylane/config";
import { authorizedScheduledPennylaneRequest } from "@/lib/pennylane/scheduled-sync-auth";
import { synchronizePennylane } from "@/lib/pennylane/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });

/** Invoked only by the host systemd timer using a separate secret. Never public. */
export async function POST(request: Request) {
  if (
    !authorizedScheduledPennylaneRequest(
      request.headers.get("authorization"),
      process.env.PAPOT_PENNYLANE_SYNC_SECRET,
    )
  ) {
    return json({ error: "SYNC_UNAUTHORIZED" }, 401);
  }
  if (!pennylaneEnabled()) return json({ error: "PENNYLANE_DISABLED" }, 503);
  try {
    const result = await synchronizePennylane("PAPOT · synchronisation programmée");
    return json({
      ok: true,
      counts: result.counts,
      generalExpensesAssigned: result.generalExpenses.assigned,
    });
  } catch (error) {
    // Do not log or return upstream invoice data, tokens or exception messages.
    const code = error instanceof Error ? error.message : "";
    if (code === "PENNYLANE_SYNC_IN_PROGRESS") {
      return json({ error: "PENNYLANE_SYNC_IN_PROGRESS" }, 409);
    }
    return json({ error: "PENNYLANE_SCHEDULED_SYNC_FAILED" }, 503);
  }
}

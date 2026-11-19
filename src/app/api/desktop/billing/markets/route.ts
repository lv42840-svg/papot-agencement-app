import { NextResponse } from "next/server";

import { createBillingRepository } from "@/lib/billing/repository";
import { loadBillingSources } from "@/lib/billing/sources";
import { summarizeChantierBillingMarkets } from "@/lib/billing/chantier-market";
import { createChantiersRepository } from "@/lib/chantiers/create-repository";
import {
  desktopRequestErrorStatus,
  requireModuleRequestContext,
} from "@/lib/desktop/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Consultation uniquement : aucune création de facture, ni émission Pennylane. */
export async function GET() {
  try {
    await requireModuleRequestContext("billing", "READ");
    const [payload, sources, chantiers] = await Promise.all([
      createBillingRepository().load(),
      loadBillingSources(),
      createChantiersRepository().load(),
    ]);
    const markets = summarizeChantierBillingMarkets(
      chantiers.chantiers,
      sources,
      payload.drafts,
    );
    return NextResponse.json(
      { markets },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "BILLING_MARKETS_LOAD_FAILED";
    return NextResponse.json(
      { error: code },
      {
        status: desktopRequestErrorStatus(code) ?? 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

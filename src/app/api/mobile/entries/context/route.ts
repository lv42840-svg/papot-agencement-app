import { NextResponse } from "next/server";
import { requireModuleRequestContext } from "@/lib/auth/module-request-context";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { clientDisplayName } from "@/lib/clients/domain";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { isCommercialClosed } from "@/lib/commercial/domain";
import { createEntriesRepository } from "@/lib/entries/create-repository";
import { activeTags } from "@/lib/entries/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireModuleRequestContext("capture", "READ");
    const [clientsPayload, commercialPayload, entriesPayload] = await Promise.all([
      createClientsRepository().then((repository) => repository.load()),
      createCommercialRepository().load(),
      createEntriesRepository().then((repository) => repository.load()),
    ]);

    const clients = clientsPayload.clients
      .filter((client) => !client.isArchived)
      .map((client) => ({
        id: client.id,
        name: clientDisplayName(client),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr-FR", { sensitivity: "base" }));

    const cases = commercialPayload.cases
      .filter((item) => !isCommercialClosed(item))
      .map((item) => ({
        id: item.id,
        name: item.name,
        clientId: item.clientId ?? null,
        clientName: item.clientName ?? "",
        status: item.status,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr-FR", { sensitivity: "base" }));

    return NextResponse.json(
      { clients, cases, tags: activeTags(entriesPayload) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "MOBILE_ENTRY_CONTEXT_FAILED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}
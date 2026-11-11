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
      .filter((element) => !isCommercialClosed(element))
      .map((element) => ({
        id: element.id,
        name: element.name,
        clientId: element.clientId ?? null,
        clientName: element.clientName ?? "",
        status: element.status,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "fr-FR", { sensitivity: "base" }));

    return NextResponse.json(
      { clients, cases, tags: activeTags(entriesPayload) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erreur) {
    const code = erreur instanceof Error ? erreur.message : "MOBILE_ENTRY_CONTEXT_FAILED";
    return NextResponse.json({ error: code }, { status: 400 });
  }
}

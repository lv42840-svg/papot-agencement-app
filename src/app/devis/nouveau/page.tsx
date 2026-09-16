import { DesktopAppShell } from "@/components/desktop-app-shell";
import { QuoteCreateWorkspace } from "@/components/quote-create-workspace";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { clientDisplayName } from "@/lib/clients/domain";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { commercialParisDateKey, isCommercialClosed } from "@/lib/commercial/domain";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";

export const dynamic = "force-dynamic";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ affaire?: string }>;
}) {
  const { affaire: requestedAffairId } = await searchParams;
  const context = await requireDesktopRequestContext("quotes", "READ");
  const commercialRepository = createCommercialRepository(context);
  const clientsRepository = await createClientsRepository(context);
  const [commercial, clients] = await Promise.all([
    commercialRepository.load(),
    clientsRepository.load(),
  ]);
  const clientsById = new Map(clients.clients.map((client) => [client.id, client]));
  const affairs = commercial.cases.flatMap((affair) => {
    if (isCommercialClosed(affair) || !affair.clientId) return [];
    const client = clientsById.get(affair.clientId);
    if (!client || client.isArchived) return [];
    return [
      {
        id: affair.id,
        name: affair.name,
        siteLabel: affair.siteLabel ?? "",
        clientName: clientDisplayName(client),
        paymentTerms: client.paymentTerms,
      },
    ];
  });
  const initialAffairId = affairs.some((affair) => affair.id === requestedAffairId)
    ? requestedAffairId
    : undefined;
  const paymentTermOptions = Array.from(
    new Set(
      clients.clients
        .map((client) => client.paymentTerms.trim())
        .filter((paymentTerms) => paymentTerms.length > 0),
    ),
  );

  return (
    <DesktopAppShell>
      <QuoteCreateWorkspace
        affairs={affairs}
        canWrite={context.moduleAccess.canWrite}
        today={commercialParisDateKey()}
        initialAffairId={initialAffairId}
        paymentTermOptions={paymentTermOptions}
      />
    </DesktopAppShell>
  );
}

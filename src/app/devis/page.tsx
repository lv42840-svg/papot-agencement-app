import { DesktopAppShell } from "@/components/desktop-app-shell";
import { QuoteModuleNav } from "@/components/quote-module-nav";
import { QuotesWorkspace } from "@/components/quotes-workspace";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { clientDisplayName } from "@/lib/clients/domain";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { isCommercialClosed } from "@/lib/commercial/domain";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";

export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  const context = await requireDesktopRequestContext("quotes", "READ");
  const commercialRepository = createCommercialRepository(context);
  const clientsRepository = await createClientsRepository(context);
  const quotesRepository = createQuotesRepository();
  const [quotes, commercial, clients] = await Promise.all([
    quotesRepository.load(),
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
        commercialStatus: affair.status,
        retainedQuoteIds: [...affair.retainedQuoteIds],
      },
    ];
  });

  return (
    <DesktopAppShell>
      <QuoteModuleNav />
      <QuotesWorkspace
        initialPayload={quotes}
        affairs={affairs}
        canWrite={context.moduleAccess.canWrite}
      />
    </DesktopAppShell>
  );
}

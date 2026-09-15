import { notFound } from "next/navigation";
import { DesktopAppShell } from "@/components/desktop-app-shell";
import { QuoteDirectEditor } from "@/components/quote-direct-editor";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { clientDisplayName } from "@/lib/clients/domain";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";

export const dynamic = "force-dynamic";

export default async function QuotePage({ params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;
  const context = await requireDesktopRequestContext("quotes", "READ");
  const commercialRepository = createCommercialRepository(context);
  const clientsRepository = await createClientsRepository(context);
  const [payload, commercial, clients] = await Promise.all([
    createQuotesRepository().load(),
    commercialRepository.load(),
    clientsRepository.load(),
  ]);

  const quote = payload.quotes.find((candidate) => candidate.id === quoteId);
  if (!quote) notFound();

  const affair = commercial.cases.find((candidate) => candidate.id === quote.commercialCaseId);
  const client = clients.clients.find((candidate) => candidate.id === quote.model.clientId);
  const affairName = affair
    ? `${affair.name}${affair.siteLabel ? ` · ${affair.siteLabel}` : ""}`
    : "Affaire introuvable";
  const clientName = client ? clientDisplayName(client) : "Client introuvable";

  return (
    <DesktopAppShell>
      <QuoteDirectEditor
        initialPayload={payload}
        quoteId={quoteId}
        canWrite={context.moduleAccess.canWrite}
        clientName={clientName}
        affairName={affairName}
      />
    </DesktopAppShell>
  );
}

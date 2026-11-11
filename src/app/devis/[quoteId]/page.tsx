import { notFound } from "next/navigation";
import { DesktopAppShell } from "@/components/desktop-app-shell";
import { QuoteDirectEditor } from "@/components/quote-direct-editor";
import { createClientsRepository } from "@/lib/clients/create-repository";
import { clientDisplayName } from "@/lib/clients/domain";
import { createCommercialRepository } from "@/lib/commercial/create-repository";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";
import { createQuoteEmailSettingsRepository } from "@/lib/quote-email-settings/create-repository";
import { createQuotesRepository } from "@/lib/quotes/create-repository";
import { quoteContractSelectionState } from "@/lib/quotes/retention";

export const dynamic = "force-dynamic";

export default async function QuotePage({
  params: parametres,
}: {
  params: Promise<{ quoteId: string }>;
}) {
  const { quoteId: idDevis } = await parametres;
  const contexte = await requireModuleRequestContext("quotes", "READ");
  const commercialRepository = createCommercialRepository();
  const clientsRepository = await createClientsRepository();
  const [contenu, commercial, clients, emailSettings] = await Promise.all([
    createQuotesRepository().load(),
    commercialRepository.load(),
    clientsRepository.load(),
    createQuoteEmailSettingsRepository().load(),
  ]);

  const quote = contenu.quotes.find((candidat) => candidat.id === idDevis);
  if (!quote) notFound();

  const affair = commercial.cases.find((candidat) => candidat.id === quote.commercialCaseId);
  const client = clients.clients.find((candidat) => candidat.id === quote.model.clientId);
  const affairName = affair
    ? `${affair.name}${affair.siteLabel ? ` · ${affair.siteLabel}` : ""}`
    : "Affaire introuvable";
  const clientName = client ? clientDisplayName(client) : "Client introuvable";
  const primaryContact =
    client?.contacts.find((contact) => contact.id === affair?.primaryContactId) ??
    client?.contacts.find((contact) => contact.isPrimary) ??
    null;
  const recipientEmail =
    affair?.contactEmail?.trim() || primaryContact?.email.trim() || client?.email.trim() || "";
  const recipientName =
    affair?.contactName?.trim() ||
    [primaryContact?.firstName, primaryContact?.lastName].filter(Boolean).join(" ").trim();
  const contractState = quoteContractSelectionState(quote, affair);
  const paymentTermOptions = Array.from(
    new Set(
      [quote.model.paymentTerms, ...clients.clients.map((candidat) => candidat.paymentTerms)]
        .map((valeur) => valeur.trim())
        .filter((valeur) => valeur.length > 0),
    ),
  );

  return (
    <DesktopAppShell>
      <QuoteDirectEditor
        initialPayload={contenu}
        quoteId={idDevis}
        canWrite={contexte.moduleAccess.canWrite}
        clientName={clientName}
        affairName={affairName}
        recipientEmail={recipientEmail}
        recipientName={recipientName}
        emailSettings={emailSettings}
        paymentTermOptions={paymentTermOptions}
        contractState={contractState}
      />
    </DesktopAppShell>
  );
}

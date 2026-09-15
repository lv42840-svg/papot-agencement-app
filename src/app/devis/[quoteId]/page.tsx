import { notFound } from "next/navigation";
import { DesktopAppShell } from "@/components/desktop-app-shell";
import { QuoteDirectEditor } from "@/components/quote-direct-editor";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";
import { createQuotesRepository } from "@/lib/quotes/create-repository";

export const dynamic = "force-dynamic";

export default async function QuotePage({ params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;
  const context = await requireDesktopRequestContext("quotes", "READ");
  const payload = await createQuotesRepository().load();
  if (!payload.quotes.some((quote) => quote.id === quoteId)) notFound();

  return (
    <DesktopAppShell>
      <QuoteDirectEditor
        initialPayload={payload}
        quoteId={quoteId}
        canWrite={context.moduleAccess.canWrite}
      />
    </DesktopAppShell>
  );
}

import { DesktopAppShell } from "@/components/desktop-app-shell";
import { QuoteModuleNav } from "@/components/quote-module-nav";
import { QuotesWorkspace } from "@/components/quotes-workspace";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";

export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  await requireDesktopRequestContext("quotes", "READ");

  return (
    <DesktopAppShell>
      <QuoteModuleNav />
      <QuotesWorkspace />
    </DesktopAppShell>
  );
}

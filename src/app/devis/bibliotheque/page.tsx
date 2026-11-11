import { DesktopAppShell } from "@/components/desktop-app-shell";
import { LibraryWorkspace } from "@/components/library-workspace";
import { QuoteModuleNav } from "@/components/quote-module-nav";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";
import { createLibraryRepository } from "@/lib/library/create-repository";

export const dynamic = "force-dynamic";

export default async function QuoteLibraryPage() {
  const contexte = await requireModuleRequestContext("quotes", "READ");
  const snapshot = await createLibraryRepository(contexte).load();

  return (
    <DesktopAppShell>
      <QuoteModuleNav />
      <LibraryWorkspace initialSnapshot={snapshot} canWrite={contexte.moduleAccess.canWrite} />
    </DesktopAppShell>
  );
}

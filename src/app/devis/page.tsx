import { DesktopAppShell } from "@/components/desktop-app-shell";
import { QuoteWorkspace } from "@/components/quote-workspace";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";
import { NextcloudLibraryStore } from "@/lib/library/storage";

export const dynamic = "force-dynamic";

export default async function QuotePage() {
  const context = await requireDesktopRequestContext("quotes", "READ");
  const library = await new NextcloudLibraryStore(context.desktop.states).get();

  return (
    <DesktopAppShell>
      <QuoteWorkspace initialLibrary={library.payload} canWrite={context.moduleAccess.canWrite} />
    </DesktopAppShell>
  );
}

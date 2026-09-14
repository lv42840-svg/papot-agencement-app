import { DesktopAppShell } from "@/components/desktop-app-shell";
import { LibraryWorkspace } from "@/components/library-workspace";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";
import { NextcloudLibraryStore } from "@/lib/library/storage";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const context = await requireDesktopRequestContext("quotes", "READ");
  const snapshot = await new NextcloudLibraryStore(context.desktop.states).get();

  return (
    <DesktopAppShell>
      <LibraryWorkspace initialSnapshot={snapshot} canWrite={context.moduleAccess.canWrite} />
    </DesktopAppShell>
  );
}

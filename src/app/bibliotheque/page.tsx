import { DesktopAppShell } from "@/components/desktop-app-shell";
import { LibraryWorkspace } from "@/components/library-workspace";
import { requireDesktopRequestContext } from "@/lib/desktop/request-context";
import { createLibraryRepository } from "@/lib/library/create-repository";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const context = await requireDesktopRequestContext("quotes", "READ");
  const snapshot = await createLibraryRepository(context).load();

  return (
    <DesktopAppShell>
      <LibraryWorkspace initialSnapshot={snapshot} canWrite={context.moduleAccess.canWrite} />
    </DesktopAppShell>
  );
}

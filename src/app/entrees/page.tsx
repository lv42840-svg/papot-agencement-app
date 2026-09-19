import { DesktopAppShell } from "@/components/desktop-app-shell";
import { EntriesWorkspace } from "@/components/entries-workspace";

export const dynamic = "force-dynamic";

export default function EntriesPage() {
  return (
    <DesktopAppShell>
      <EntriesWorkspace />
    </DesktopAppShell>
  );
}

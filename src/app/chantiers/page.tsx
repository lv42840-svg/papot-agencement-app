import { ChantiersWorkspace } from "@/components/chantiers-workspace";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

export default function ChantiersPage() {
  return (
    <DesktopAppShell>
      <ChantiersWorkspace />
    </DesktopAppShell>
  );
}

import { ChantiersWorkspaceObat } from "@/components/chantiers-workspace-obat";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

export default function ChantiersPage() {
  return (
    <DesktopAppShell>
      <ChantiersWorkspaceObat />
    </DesktopAppShell>
  );
}

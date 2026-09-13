import { CommercialWorkspace } from "@/components/commercial-workspace";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

export default function CommercialPage() {
  return (
    <DesktopAppShell>
      <CommercialWorkspace />
    </DesktopAppShell>
  );
}

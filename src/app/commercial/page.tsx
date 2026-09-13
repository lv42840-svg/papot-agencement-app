import { CommercialFocusRelease } from "@/components/commercial-focus-release";
import { CommercialWorkspaceV2 } from "@/components/commercial-workspace-v2";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

export default function CommercialPage() {
  return (
    <DesktopAppShell>
      <CommercialFocusRelease />
      <CommercialWorkspaceV2 />
    </DesktopAppShell>
  );
}

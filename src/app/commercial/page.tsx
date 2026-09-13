import { CommercialWorkspace } from "@/components/commercial-workspace";
import { CommercialFocusRelease } from "@/components/commercial-focus-release";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

export default function CommercialPage() {
  return (
    <DesktopAppShell>
      <CommercialFocusRelease />
      <CommercialWorkspace />
    </DesktopAppShell>
  );
}

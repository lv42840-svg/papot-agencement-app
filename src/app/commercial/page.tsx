import { CommercialFocusRelease } from "@/components/commercial-focus-release";
import { CommercialObatImport } from "@/components/commercial-obat-import";
import { CommercialWorkspace } from "@/components/commercial-workspace";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

export default function CommercialPage() {
  return (
    <DesktopAppShell>
      <CommercialFocusRelease />
      <CommercialObatImport />
      <CommercialWorkspace />
    </DesktopAppShell>
  );
}

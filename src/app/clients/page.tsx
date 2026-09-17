import { ClientVatDefaultsPanel } from "@/components/client-vat-defaults-panel";
import { ClientsWorkspace } from "@/components/clients-workspace";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

export default function ClientsPage() {
  return (
    <DesktopAppShell>
      <ClientsWorkspace />
      <ClientVatDefaultsPanel />
    </DesktopAppShell>
  );
}

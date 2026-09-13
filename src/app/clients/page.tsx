import { ClientsWorkspace } from "@/components/clients-workspace";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

export default function ClientsPage() {
  return (
    <DesktopAppShell>
      <ClientsWorkspace />
    </DesktopAppShell>
  );
}

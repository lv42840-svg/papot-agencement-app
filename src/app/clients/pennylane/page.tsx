import { DesktopAppShell } from "@/components/desktop-app-shell";
import { PennylaneClientsWorkspace } from "@/components/pennylane-clients-workspace";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";

export const dynamic = "force-dynamic";

export default async function PennylaneClientsPage() {
  await requireModuleRequestContext("clients", "READ");
  return (
    <DesktopAppShell>
      <PennylaneClientsWorkspace />
    </DesktopAppShell>
  );
}

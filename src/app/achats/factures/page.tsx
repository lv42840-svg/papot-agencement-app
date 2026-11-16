import { DesktopAppShell } from "@/components/desktop-app-shell";
import { PurchaseInvoicesWorkspace } from "@/components/purchase-invoices-workspace";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";

export const dynamic = "force-dynamic";

export default async function PurchaseInvoicesPage() {
  await requireModuleRequestContext("purchases", "READ");
  return (
    <DesktopAppShell>
      <PurchaseInvoicesWorkspace />
    </DesktopAppShell>
  );
}

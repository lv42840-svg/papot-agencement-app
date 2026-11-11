import { DesktopAppShell } from "@/components/desktop-app-shell";
import { PurchaseOrderEditWorkspace } from "@/components/purchase-order-edit-workspace";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";

export const dynamic = "force-dynamic";

export default async function EditPurchaseOrderPage({
  params: parametres,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requireModuleRequestContext("purchases", "READ");
  const { orderId: idCommande } = await parametres;
  return (
    <DesktopAppShell>
      <PurchaseOrderEditWorkspace orderId={idCommande} />
    </DesktopAppShell>
  );
}

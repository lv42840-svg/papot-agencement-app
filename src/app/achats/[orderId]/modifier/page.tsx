import { DesktopAppShell } from "@/components/desktop-app-shell";
import { PurchaseOrderEditWorkspace } from "@/components/purchase-order-edit-workspace";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";

export const dynamic = "force-dynamic";

export default async function EditPurchaseOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  await requireModuleRequestContext("purchases", "READ");
  const { orderId } = await params;
  return (
    <DesktopAppShell>
      <PurchaseOrderEditWorkspace orderId={orderId} />
    </DesktopAppShell>
  );
}

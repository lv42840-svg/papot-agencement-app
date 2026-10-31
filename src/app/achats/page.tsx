import { DesktopAppShell } from "@/components/desktop-app-shell";
import { PurchaseOrdersWorkspace } from "@/components/purchase-orders-workspace";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";

export const dynamic = "force-dynamic";

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ chantierId?: string }>;
}) {
  await requireModuleRequestContext("purchases", "READ");
  const params = await searchParams;
  return (
    <DesktopAppShell>
      <PurchaseOrdersWorkspace chantierId={params.chantierId} />
    </DesktopAppShell>
  );
}

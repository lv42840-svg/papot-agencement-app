import { DesktopAppShell } from "@/components/desktop-app-shell";
import { PurchaseInvoicesWorkspace } from "@/components/purchase-invoices-workspace";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";

export const dynamic = "force-dynamic";

export default async function PurchaseInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireModuleRequestContext("purchases", "READ");
  const params = await searchParams;
  const initialTab =
    params.tab === "pending" ? "PENDING" : params.tab === "approved" ? "APPROVED" : "ALL";
  return (
    <DesktopAppShell>
      <PurchaseInvoicesWorkspace initialTab={initialTab} />
    </DesktopAppShell>
  );
}

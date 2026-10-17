import { DesktopAppShell } from "@/components/desktop-app-shell";
import { BillingWorkspace } from "@/components/billing-workspace";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";
export const dynamic = "force-dynamic";
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ quoteId?: string; chantierId?: string }>;
}) {
  await requireModuleRequestContext("billing", "READ");
  const params = await searchParams;
  return (
    <DesktopAppShell>
      <BillingWorkspace quoteId={params.quoteId} chantierId={params.chantierId} />
    </DesktopAppShell>
  );
}

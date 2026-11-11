import { DesktopAppShell } from "@/components/desktop-app-shell";
import { BillingWorkspace } from "@/components/billing-workspace";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";
export const dynamic = "force-dynamic";
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ quoteId?: string; chantierId?: string; tab?: string }>;
}) {
  await requireModuleRequestContext("billing", "READ");
  const parametres = await searchParams;
  return (
    <DesktopAppShell>
      <BillingWorkspace
        quoteId={parametres.quoteId}
        chantierId={parametres.chantierId}
        initialTab={parametres.tab}
      />
    </DesktopAppShell>
  );
}

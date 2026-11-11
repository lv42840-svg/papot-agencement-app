import { DesktopAppShell } from "@/components/desktop-app-shell";
import { EnterpriseProfitabilityWorkspace } from "@/components/enterprise-profitability-workspace";
import { EnterpriseFinanceTabs } from "@/components/enterprise-finance-tabs";
import { requireSpecialPermission } from "@/lib/auth/permissions";
import { requireModuleRequestContext } from "@/lib/desktop/request-context";

export const dynamic = "force-dynamic";

export default async function EnterpriseProfitabilityPage() {
  const contexte = await requireModuleRequestContext("pilotage", "READ");
  await requireSpecialPermission(contexte.user, "dashboard.view_global");
  return (
    <DesktopAppShell>
      <EnterpriseFinanceTabs chantierView={<EnterpriseProfitabilityWorkspace />} />
    </DesktopAppShell>
  );
}

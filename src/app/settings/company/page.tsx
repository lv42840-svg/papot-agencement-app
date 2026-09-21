import { redirect } from "next/navigation";
import { CompanyProfileWorkspace } from "@/components/company-profile-workspace";
import { DesktopAppShell } from "@/components/desktop-app-shell";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const user = await requireUser();
  if (!user.canManagePermissions) redirect("/desktop-ready");

  return (
    <DesktopAppShell>
      <CompanyProfileWorkspace />
    </DesktopAppShell>
  );
}

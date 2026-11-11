import { redirect } from "next/navigation";
import { DesktopAppShell } from "@/components/desktop-app-shell";
import { SettingsSectionNav } from "@/components/settings-section-nav";
import { UserAdminWorkspace } from "@/components/user-admin-workspace";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function UsersSettingsPage() {
  const utilisateur = await requireUser();
  if (!utilisateur.canManagePermissions) redirect("/desktop-ready");

  return (
    <DesktopAppShell>
      <SettingsSectionNav active="users" />
      <UserAdminWorkspace />
    </DesktopAppShell>
  );
}

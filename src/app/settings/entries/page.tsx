import { redirect } from "next/navigation";
import { DesktopAppShell } from "@/components/desktop-app-shell";
import { EntriesSettingsWorkspace } from "@/components/entries-settings-workspace";
import { SettingsSectionNav } from "@/components/settings-section-nav";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function EntriesSettingsPage() {
  const user = await requireUser();
  if (!user.canManagePermissions) redirect("/desktop-ready");

  return (
    <DesktopAppShell>
      <SettingsSectionNav active="entries" />
      <EntriesSettingsWorkspace />
    </DesktopAppShell>
  );
}

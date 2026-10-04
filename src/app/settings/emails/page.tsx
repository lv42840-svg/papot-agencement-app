import { redirect } from "next/navigation";
import { DesktopAppShell } from "@/components/desktop-app-shell";
import { QuoteEmailSettingsWorkspace } from "@/components/quote-email-settings-workspace";
import { SettingsSectionNav } from "@/components/settings-section-nav";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage() {
  const user = await requireUser();
  if (!user.canManagePermissions) redirect("/desktop-ready");

  return (
    <DesktopAppShell>
      <SettingsSectionNav active="emails" />
      <QuoteEmailSettingsWorkspace />
    </DesktopAppShell>
  );
}

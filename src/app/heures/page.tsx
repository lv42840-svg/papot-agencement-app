import { DesktopAppShell } from "@/components/desktop-app-shell";
import { ActualHoursWorkspace } from "@/components/actual-hours-workspace";
import { HeuresTabs } from "@/components/heures-tabs";

export default function HeuresPage() {
  return (
    <DesktopAppShell>
      <HeuresTabs hours={<ActualHoursWorkspace />} />
    </DesktopAppShell>
  );
}

import { DesktopAppShell } from "@/components/desktop-app-shell";
import { QuotesWorkspace } from "@/components/quotes-workspace";

export const dynamic = "force-dynamic";

export default function QuotesPage() {
  return (
    <DesktopAppShell>
      <QuotesWorkspace />
    </DesktopAppShell>
  );
}

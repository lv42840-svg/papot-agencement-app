import { ChantierWorkspace } from "@/components/chantier-workspace";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

export default async function ChantierPage({
  params,
}: {
  params: Promise<{ chantierId: string }>;
}) {
  const { chantierId } = await params;
  return (
    <DesktopAppShell>
      <ChantierWorkspace chantierId={chantierId} />
    </DesktopAppShell>
  );
}

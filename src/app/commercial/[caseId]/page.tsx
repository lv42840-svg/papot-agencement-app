import { CommercialWorkspaceV2 } from "@/components/commercial-workspace-v2";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

export default async function CommercialAffairPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;

  return (
    <DesktopAppShell>
      <CommercialWorkspaceV2 affairId={caseId} />
    </DesktopAppShell>
  );
}

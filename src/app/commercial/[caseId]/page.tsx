import { CommercialWorkspaceV2 } from "@/components/commercial-workspace-v2";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export const dynamic = "force-dynamic";

export default async function CommercialAffairPage({
  params: parametres,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId: idAffaire } = await parametres;

  return (
    <DesktopAppShell>
      <CommercialWorkspaceV2 affairId={idAffaire} />
    </DesktopAppShell>
  );
}

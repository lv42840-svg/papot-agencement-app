import { ChantierEditor } from "@/components/chantier-editor";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export default async function ChantierPage({
  params,
}: {
  params: Promise<{ chantierId: string }>;
}) {
  const { chantierId } = await params;
  return (
    <DesktopAppShell>
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Chantier partagé</p>
          <h1>Fiche chantier</h1>
        </div>
      </div>
      <ChantierEditor chantierId={chantierId} />
    </DesktopAppShell>
  );
}

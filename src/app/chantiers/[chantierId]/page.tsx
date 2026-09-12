import { ChantierEditor } from "@/components/chantier-editor";

export default async function ChantierPage({
  params,
}: {
  params: Promise<{ chantierId: string }>;
}) {
  const { chantierId } = await params;
  return (
    <main className="content" style={{ marginLeft: 0 }}>
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Chantier partagé</p>
          <h1>Fiche chantier</h1>
        </div>
      </div>
      <ChantierEditor chantierId={chantierId} />
    </main>
  );
}

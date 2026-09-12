export const dynamic = "force-static";

export default function DesktopReadyPage() {
  return (
    <main className="loginPage">
      <section className="loginCard" style={{ width: "min(680px, 100%)" }}>
        <div className="brand brandCompact">
          <span className="brandName">PAPOT</span>
          <span className="brandSubtitle">AGENCEMENT</span>
        </div>
        <div>
          <p className="eyebrow">Poste configuré</p>
          <h1>PAPOT est prêt sur ce poste</h1>
          <p className="muted">
            La configuration locale et l’accès Nextcloud sécurisé seront réutilisés aux prochains
            démarrages. Le raccordement aux écrans métier est la prochaine étape.
          </p>
        </div>
      </section>
    </main>
  );
}

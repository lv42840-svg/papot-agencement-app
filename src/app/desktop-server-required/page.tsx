export const dynamic = "force-static";

export default function DesktopServerRequiredPage() {
  return (
    <main className="loginPage">
      <section className="loginCard" style={{ width: "min(680px, 100%)" }}>
        <div className="brand brandCompact">
          <span className="brandName">PAPOT</span>
          <span className="brandSubtitle">AGENCEMENT</span>
        </div>

        <div>
          <p className="eyebrow">Installation Windows réussie</p>
          <h1>Serveur PAPOT non configuré ou indisponible</h1>
          <p className="muted">
            L’application est bien installée sur ce PC. La base PostgreSQL centrale n’est pas encore
            configurée, ou elle n’est pas joignable. PAPOT bloque volontairement l’accès aux données
            métier au lieu d’afficher une erreur 500.
          </p>
          <p className="muted">
            Pour notre phase de développement actuelle, tu n’as rien à régler sur ce PC. La
            configuration définitive du serveur sera faite plus tard avec l’informaticien.
          </p>
        </div>
      </section>
    </main>
  );
}

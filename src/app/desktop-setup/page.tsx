export const dynamic = "force-static";

export default function DesktopSetupPage() {
  return (
    <main className="loginPage">
      <section className="loginCard" style={{ width: "min(680px, 100%)" }}>
        <div className="brand brandCompact">
          <span className="brandName">PAPOT</span>
          <span className="brandSubtitle">AGENCEMENT</span>
        </div>

        <div>
          <p className="eyebrow">Première installation</p>
          <h1>Configurer ce poste PAPOT</h1>
          <p className="muted">
            Ces informations seront demandées une seule fois sur ce PC. Le mot de passe Nextcloud
            sera ensuite stocké dans le coffre sécurisé de Windows, jamais dans le fichier de
            configuration PAPOT.
          </p>
        </div>

        <form className="loginForm">
          <label>
            Chemin du dossier partagé de l’entreprise
            <input name="sharedDataPath" placeholder="\\\\SERVEUR\\PAPOT" autoComplete="off" />
          </label>

          <label>
            Adresse Nextcloud
            <input
              name="nextcloudBaseUrl"
              type="url"
              defaultValue="https://cloud.ideo-solutions.com"
              autoComplete="off"
            />
          </label>

          <label>
            Compte technique Nextcloud
            <input name="nextcloudLogin" placeholder="Papot_Appli" autoComplete="username" />
          </label>

          <label>
            Mot de passe d’application Nextcloud
            <input
              name="nextcloudAppPassword"
              type="password"
              autoComplete="new-password"
              placeholder="Saisi une seule fois"
            />
          </label>

          <label>
            Nom de ce poste
            <input name="deviceLabel" placeholder="PC Lucien" autoComplete="off" />
          </label>

          <label>
            Utilisateur PAPOT
            <input name="papotUserDisplayName" placeholder="Lucien" autoComplete="off" />
          </label>

          <button className="primaryButton" type="button" disabled>
            Tester et enregistrer
          </button>

          <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
            L’écran est prêt. Le branchement au coffre Windows, aux tests Nextcloud et au dossier
            partagé arrive à l’étape suivante.
          </p>
        </form>
      </section>
    </main>
  );
}

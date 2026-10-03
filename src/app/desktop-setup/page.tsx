import { DesktopSetupForm } from "@/components/desktop-setup-form";

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
            PAPOT vérifie le dossier partagé et Nextcloud avant d’enregistrer ce poste. Le mot de
            passe d’application Nextcloud est chiffré par le coffre sécurisé de Windows et n’est
            jamais écrit en clair dans la configuration.
          </p>
        </div>

        <DesktopSetupForm />
      </section>
    </main>
  );
}

import { Brand } from "@/components/brand";
import { SetupPasswordForm } from "@/components/setup-password-form";

export default async function SetupPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;

  return (
    <main className="loginPage">
      <section className="loginCard">
        <Brand />
        <div>
          <h1>Définir mon mot de passe</h1>
          <p className="muted">
            Choisissez votre mot de passe personnel. L’administrateur ne pourra pas le voir.
          </p>
        </div>
        {token ? <SetupPasswordForm token={token} /> : <p className="formError">Lien invalide.</p>}
      </section>
    </main>
  );
}

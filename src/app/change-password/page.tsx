import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { ChangePasswordForm } from "@/components/change-password-form";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.mustChangePassword) redirect("/");

  return (
    <main className="loginPage">
      <section className="loginCard">
        <Brand />
        <div>
          <h1>Nouveau mot de passe</h1>
          <p className="muted">
            Un administrateur a demandé la réinitialisation de votre mot de passe. Choisissez-en un
            nouveau pour continuer.
          </p>
        </div>
        <ChangePasswordForm />
      </section>
    </main>
  );
}

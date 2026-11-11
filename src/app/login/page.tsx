import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth/session";

export default async function LoginPage() {
  const utilisateur = await getCurrentUser();
  if (utilisateur) redirect("/");

  return (
    <main className="loginPage">
      <section className="loginCard">
        <Brand />
        <div>
          <h1>Connexion</h1>
          <p className="muted">Accédez à l’espace PAPOT AGENCEMENT.</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}

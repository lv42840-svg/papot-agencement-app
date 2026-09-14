import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { FirstAdminForm } from "@/components/first-admin-form";
import { authHasUsers } from "@/lib/auth/store";
import { hasDesktopDatabaseConfig } from "@/lib/desktop/database-config";

export const dynamic = "force-dynamic";

export default async function FirstAdminPage() {
  if (!hasDesktopDatabaseConfig()) redirect("/desktop-server-required");
  if (await authHasUsers()) redirect("/login");

  return (
    <main className="loginPage">
      <section className="loginCard">
        <Brand />
        <div>
          <h1>Premier administrateur</h1>
          <p className="muted">
            Créez le premier compte PAPOT AGENCEMENT. Les utilisateurs suivants seront créés depuis
            l’administration.
          </p>
        </div>
        <FirstAdminForm />
      </section>
    </main>
  );
}

import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth/session";

export default async function TasksPage() {
  const user = await requireUser();
  return (
    <AppShell user={user}>
      <section className="panel"><p className="eyebrow">Mes tâches</p><h1>Le socle est prêt</h1><p className="muted">Le parcours détaillé « Mes tâches » sera branché dans le lot suivant. Aucun comportement métier fictif n’est simulé ici.</p></section>
    </AppShell>
  );
}

import Link from "next/link";
import { Clock3, PlusCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { listToQualify } from "@/lib/capture/repository";
import { requireUser } from "@/lib/auth/session";

const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

export default async function HomePage() {
  const user = await requireUser();
  const captures = await listToQualify();

  return (
    <AppShell user={user}>
      <div className="pageHeader">
        <div><p className="eyebrow">Accueil</p><h1>Bonjour {user.displayName}</h1></div>
        <Link className="primaryButton desktopAction" href="/capture"><PlusCircle size={18} /> Nouvelle capture</Link>
      </div>

      <section className="panel">
        <div className="panelHeader">
          <div><h2>À qualifier</h2><p className="muted">Captures brutes en attente de traitement.</p></div>
          <span className="countBadge">{captures.length}</span>
        </div>

        {captures.length === 0 ? (
          <div className="emptyState"><Clock3 size={30} /><p>Aucune capture à qualifier.</p><Link href="/capture">Créer une première piste</Link></div>
        ) : (
          <div className="responsiveList">
            <div className="tableHead"><span>Piste</span><span>Responsable</span><span>Auteur</span><span>Créée</span><span>Priorité</span></div>
            {captures.map((capture) => (
              <article className="listRow" key={capture.id}>
                <strong>{capture.title}</strong>
                <span data-label="Responsable">{capture.responsibleName}</span>
                <span data-label="Auteur">{capture.creatorName}</span>
                <span data-label="Créée">{dateTime.format(new Date(capture.createdAt))}</span>
                <span data-label="Priorité"><span className={capture.priority === "URGENT" ? "statusBadge warning" : "statusBadge"}>{capture.priority === "URGENT" ? "Urgent" : "Normale"}</span></span>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

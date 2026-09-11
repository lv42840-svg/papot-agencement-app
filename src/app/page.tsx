import Link from "next/link";
import { Clock3, PlusCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { hasModuleAccess } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { listToQualify } from "@/lib/capture/repository";

const dateTime = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
});

export default async function HomePage() {
  const user = await requireUser();
  const canReadCapture = await hasModuleAccess(user.id, "capture", "READ");
  const captures = canReadCapture ? await listToQualify() : [];

  return (
    <AppShell user={user}>
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Accueil</p>
          <h1>Bonjour {user.displayName}</h1>
        </div>
        {canReadCapture && (
          <Link className="primaryButton desktopAction" href="/capture">
            <PlusCircle size={18} /> Nouvelle capture
          </Link>
        )}
      </div>

      {canReadCapture ? (
        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>À qualifier</h2>
              <p className="muted">Captures brutes en attente de traitement.</p>
            </div>
            <span className="countBadge">{captures.length}</span>
          </div>

          {captures.length === 0 ? (
            <div className="emptyState">
              <Clock3 size={30} />
              <p>Aucune capture à qualifier.</p>
              <Link href="/capture">Créer une première piste</Link>
            </div>
          ) : (
            <div className="responsiveList">
              <div className="tableHead">
                <span>Piste</span>
                <span>Responsable</span>
                <span>Auteur</span>
                <span>Créée</span>
                <span>Priorité</span>
              </div>
              {captures.map((capture) => (
                <article className="listRow" key={capture.id}>
                  <strong>{capture.title}</strong>
                  <span data-label="Responsable">{capture.responsibleName}</span>
                  <span data-label="Auteur">{capture.creatorName}</span>
                  <span data-label="Créée">{dateTime.format(new Date(capture.createdAt))}</span>
                  <span data-label="Priorité">
                    <span
                      className={
                        capture.priority === "URGENT" ? "statusBadge warning" : "statusBadge"
                      }
                    >
                      {capture.priority === "URGENT" ? "Urgent" : "Normale"}
                    </span>
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="panel">
          <h2>Accueil</h2>
          <p className="muted">Aucun module n’est actuellement disponible pour votre compte.</p>
        </section>
      )}
    </AppShell>
  );
}

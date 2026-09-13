import Link from "next/link";
import { BriefcaseBusiness, Clock3, FileText, FolderOpen, ListTodo, Plus } from "lucide-react";
import { DesktopAppShell } from "@/components/desktop-app-shell";
import { DashboardTasksPanel } from "@/components/tasks-workspace";

export const dynamic = "force-dynamic";

export default function DesktopReadyPage() {
  return (
    <DesktopAppShell>
      <div className="dashboardHeading">
        <div>
          <h1>Bonjour 👋</h1>
        </div>
        <Link className="primaryButton" href="/entrees">
          <Plus size={18} /> Nouvelle entrée
        </Link>
      </div>

      <section className="dashboardStats" aria-label="Indicateurs principaux">
        <article className="dashboardStat dashboardStatPurple">
          <span className="dashboardStatIcon">
            <BriefcaseBusiness size={20} />
          </span>
          <div>
            <strong>0</strong>
            <span>Nouvelles pistes</span>
            <small>à traiter</small>
          </div>
        </article>
        <article className="dashboardStat dashboardStatGold">
          <span className="dashboardStatIcon">
            <FileText size={20} />
          </span>
          <div>
            <strong>0</strong>
            <span>Devis en attente</span>
            <small>de relance</small>
          </div>
        </article>
        <article className="dashboardStat dashboardStatGreen">
          <span className="dashboardStatIcon">
            <FolderOpen size={20} />
          </span>
          <div>
            <strong>0</strong>
            <span>Chantiers en cours</span>
            <small>cette semaine</small>
          </div>
        </article>
        <article className="dashboardStat dashboardStatBlue">
          <span className="dashboardStatIcon">
            <Clock3 size={20} />
          </span>
          <div>
            <strong>—</strong>
            <span>Heures saisies</span>
            <small>cette semaine</small>
          </div>
        </article>
      </section>

      <section className="dashboardGrid">
        <article className="dashboardPanel">
          <div className="dashboardPanelHeader">
            <div>
              <h2>Grand planning</h2>
              <p>Semaine de travail partagée</p>
            </div>
            <Link href="/planning/2026-S38">Ouvrir</Link>
          </div>
          <div className="dashboardEmpty">
            <CalendarPreview />
            <p>Le vrai planning sera construit ici à partir des chantiers.</p>
          </div>
        </article>

        <DashboardTasksPanel />

        <article className="dashboardPanel dashboardQuickPanel">
          <div className="dashboardPanelHeader">
            <div>
              <h2>Accès rapides</h2>
              <p>Écrans actuellement raccordés</p>
            </div>
          </div>
          <div className="dashboardQuickActions">
            <Link className="secondaryButton" href="/entrees">
              <Plus size={17} /> Nouvelle entrée
            </Link>
            <Link className="secondaryButton" href="/tasks">
              <ListTodo size={17} /> Mes tâches
            </Link>
            <Link className="secondaryButton" href="/chantiers/chantier-test-verrou">
              <FolderOpen size={17} /> Fiche chantier
            </Link>
            <Link className="secondaryButton" href="/planning/2026-S38">
              <Clock3 size={17} /> Planning partagé
            </Link>
          </div>
        </article>
      </section>
    </DesktopAppShell>
  );
}

function CalendarPreview() {
  return (
    <div className="calendarPreview" aria-hidden="true">
      {["Lun", "Mar", "Mer", "Jeu", "Ven"].map((day, index) => (
        <span className={index === 2 ? "calendarToday" : ""} key={day}>
          {day}
        </span>
      ))}
    </div>
  );
}

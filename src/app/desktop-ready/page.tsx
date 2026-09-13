import Link from "next/link";
import { BriefcaseBusiness, Clock3, FolderOpen, ListTodo, Plus } from "lucide-react";
import { DashboardChantierStat } from "@/components/dashboard-chantier-stat";
import { DashboardCommercialStats } from "@/components/dashboard-commercial-stats";
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
        <DashboardCommercialStats />
        <DashboardChantierStat />
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
            <Link className="secondaryButton" href="/commercial">
              <BriefcaseBusiness size={17} /> Commercial
            </Link>
            <Link className="secondaryButton" href="/chantiers">
              <FolderOpen size={17} /> Chantiers
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

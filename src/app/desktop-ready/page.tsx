import Link from "next/link";
import { redirect } from "next/navigation";
import { BriefcaseBusiness, Camera, Clock3, FolderOpen, Inbox, ListTodo } from "lucide-react";
import { DashboardChantierStat } from "@/components/dashboard-chantier-stat";
import { DashboardSoldMarginStat } from "@/components/dashboard-sold-margin-stat";
import { DashboardCommercialStats } from "@/components/dashboard-commercial-stats";
import { DashboardWeeklyPlanning } from "@/components/dashboard-weekly-planning";
import { DesktopAppShell } from "@/components/desktop-app-shell";
import { DashboardTasksPanel } from "@/components/tasks-workspace";
import { authHasUsers } from "@/lib/auth/store";
import { currentDashboardPlanningWeek } from "@/lib/planning/dashboard-week";

export const dynamic = "force-dynamic";

export default async function DesktopReadyPage() {
  if (!(await authHasUsers())) redirect("/first-admin");
  const currentWeek = currentDashboardPlanningWeek();

  return (
    <DesktopAppShell>
      <div className="dashboardHeading">
        <div>
          <h1>Bonjour 👋</h1>
        </div>
        <div className="buttonRow">
          <Link className="secondaryButton" href="/entrees">
            <Inbox size={18} /> Entrées
          </Link>
          <Link className="primaryButton" href="/capture">
            <Camera size={18} /> Capture
          </Link>
        </div>
      </div>

      <section className="dashboardStats" aria-label="Indicateurs principaux">
        <DashboardCommercialStats />
        <DashboardChantierStat />
        <DashboardSoldMarginStat />
      </section>

      <section className="dashboardGrid">
        <DashboardWeeklyPlanning initialWeek={currentWeek} />

        <DashboardTasksPanel />

        <article className="dashboardPanel dashboardQuickPanel">
          <div className="dashboardPanelHeader">
            <div>
              <h2>Accès rapides</h2>
              <p>Écrans actuellement raccordés</p>
            </div>
          </div>
          <div className="dashboardQuickActions">
            <Link className="secondaryButton" href="/capture">
              <Camera size={17} /> Capture
            </Link>
            <Link className="secondaryButton" href="/entrees">
              <Inbox size={17} /> Entrées
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
            <Link className="secondaryButton" href={`/planning/${currentWeek}`}>
              <Clock3 size={17} /> Planning partagé
            </Link>
          </div>
        </article>
      </section>
    </DesktopAppShell>
  );
}

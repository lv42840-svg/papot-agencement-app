import { DesktopAppShell } from "@/components/desktop-app-shell";
import { GrandPlanningWorkspace } from "@/components/grand-planning-workspace";
import { requireUser } from "@/lib/auth/session";

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; tab?: string }>;
}) {
  const [parametres, utilisateur] = await Promise.all([searchParams, requireUser()]);
  const parsedYear = Number(parametres.year);
  const annee =
    Number.isInteger(parsedYear) && parsedYear >= 2020 && parsedYear <= 2100
      ? parsedYear
      : new Date().getFullYear();

  return (
    <DesktopAppShell>
      <GrandPlanningWorkspace
        initialPotentialCollapsed={utilisateur.planningPotentialCollapsed}
        initialYear={annee}
        initialTab={parametres.tab === "personnel" ? "personnel" : "planning"}
      />
    </DesktopAppShell>
  );
}

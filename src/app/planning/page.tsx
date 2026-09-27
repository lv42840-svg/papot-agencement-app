import { DesktopAppShell } from "@/components/desktop-app-shell";
import { GrandPlanningWorkspace } from "@/components/grand-planning-workspace";
import { requireUser } from "@/lib/auth/session";

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const [params, user] = await Promise.all([searchParams, requireUser()]);
  const parsedYear = Number(params.year);
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2020 && parsedYear <= 2100
      ? parsedYear
      : new Date().getFullYear();

  return (
    <DesktopAppShell>
      <GrandPlanningWorkspace
        initialPotentialCollapsed={user.planningPotentialCollapsed}
        initialYear={year}
      />
    </DesktopAppShell>
  );
}

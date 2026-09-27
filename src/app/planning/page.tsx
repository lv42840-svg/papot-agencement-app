import { DesktopAppShell } from "@/components/desktop-app-shell";
import { GrandPlanningWorkspace } from "@/components/grand-planning-workspace";

export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const params = await searchParams;
  const parsedYear = Number(params.year);
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2020 && parsedYear <= 2100
      ? parsedYear
      : new Date().getFullYear();

  return (
    <DesktopAppShell>
      <GrandPlanningWorkspace initialYear={year} />
    </DesktopAppShell>
  );
}

import { redirect } from "next/navigation";
import { DesktopAppShell } from "@/components/desktop-app-shell";
import { WeeklyTeamBoard } from "@/components/weekly-team-board";
import { requireUser } from "@/lib/auth/session";
import { weeklyBoardWeekSchema } from "@/lib/planning/weekly-board";
import { isoWeekKey } from "@/lib/planning/time-markers";

export default async function PlanningWeekPage({
  params,
}: {
  params: Promise<{ weekId: string }>;
}) {
  const [{ weekId }] = await Promise.all([params, requireUser()]);
  const parsed = weeklyBoardWeekSchema.safeParse(weekId);
  if (!parsed.success) redirect(`/planning/${isoWeekKey(new Date())}`);
  return (
    <DesktopAppShell>
      <WeeklyTeamBoard week={parsed.data} />
    </DesktopAppShell>
  );
}

import { PlanningWeekEditor } from "@/components/planning-week-editor";
import { DesktopAppShell } from "@/components/desktop-app-shell";

export default async function PlanningWeekPage({
  params,
}: {
  params: Promise<{ weekId: string }>;
}) {
  const { weekId } = await params;
  return (
    <DesktopAppShell>
      <div className="pageHeader">
        <div>
          <p className="eyebrow">Planning partagé</p>
          <h1>Grand planning hebdomadaire</h1>
        </div>
      </div>
      <PlanningWeekEditor weekId={weekId} />
    </DesktopAppShell>
  );
}
